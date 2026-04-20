// Streaming compressor backed by @ffmpeg/ffmpeg's WORKERFS mount. Lets the
// wasm worker read the input File lazily via Blob.slice() / FileReaderSync,
// so multi-GB inputs don't buffer into a JS ArrayBuffer. Browser RAM stays
// at ffmpeg's internal decode-buffer size (~100 MB peak) regardless of
// input file size.
import type { FFmpeg } from "@ffmpeg/ffmpeg";

export const STREAM_TARGET_BYTES = 47 * 1024 * 1024;
export const STREAM_UPLOAD_CAP_BYTES = 50 * 1024 * 1024;
const AUDIO_BITRATE_KBPS = 32;
const MIN_VIDEO_BITRATE_KBPS = 100;
const VIDEO_MAX_WIDTH = 640;
const PROGRESS_WATCHDOG_MS = 180_000; // 3 min — generous for single-threaded multi-GB runs
const MOUNT_POINT = "/mnt";

const CORE_JS = "/ffmpeg/ffmpeg-core.js";
const CORE_WASM = "/ffmpeg/ffmpeg-core.wasm";
const CLASS_WORKER_JS = "/ffmpeg/worker.js";

export type StreamPhase =
  | "idle"
  | "loading"
  | "reading"
  | "mounting"
  | "compressing"
  | "finalizing"
  | "done"
  | "failed";

export interface StreamProgress {
  phase: StreamPhase;
  progress: number;
  overallProgress: number;
  mode?: "video" | "audio-only";
  targetBitrateKbps?: number;
  durationSeconds?: number;
  etaSeconds?: number | null;
  message?: string;
}

let _ffmpeg: FFmpeg | null = null;
let _loadPromise: Promise<FFmpeg> | null = null;

async function loadFFmpeg(): Promise<FFmpeg> {
  if (_ffmpeg) return _ffmpeg;
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    const { FFmpeg: FFmpegCtor } = await import("@ffmpeg/ffmpeg");
    const ffmpeg = new FFmpegCtor();
    await ffmpeg.load({
      coreURL: CORE_JS,
      wasmURL: CORE_WASM,
      classWorkerURL: CLASS_WORKER_JS,
    });
    _ffmpeg = ffmpeg;
    return ffmpeg;
  })();
  return _loadPromise;
}

function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const d = el.duration;
      URL.revokeObjectURL(url);
      if (!isFinite(d) || d <= 0) return reject(new Error("Could not read video duration — unsupported format?"));
      resolve(d);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read video metadata — the file may be DRM'd or in a browser-incompatible container."));
    };
    el.src = url;
  });
}

export async function compressStreaming(
  file: File,
  onProgress: (p: StreamProgress) => void,
): Promise<File> {
  try {
    onProgress({
      phase: "loading",
      progress: 0,
      overallProgress: 0,
      message: "Loading in-browser compressor (~30 MB, first time only)",
    });
    const ffmpeg = await loadFFmpeg();
    onProgress({ phase: "loading", progress: 1, overallProgress: 0.05 });

    onProgress({
      phase: "reading",
      progress: 0,
      overallProgress: 0.07,
      message: "Reading video metadata",
    });
    const durationSeconds = await getVideoDuration(file);

    const totalBudgetBits = STREAM_TARGET_BYTES * 8;
    const audioBudgetBits = AUDIO_BITRATE_KBPS * 1000 * durationSeconds;
    const videoBudgetBits = totalBudgetBits - audioBudgetBits;
    const videoBitrateKbps = Math.max(0, Math.floor(videoBudgetBits / durationSeconds / 1000));
    const audioOnly = videoBitrateKbps < MIN_VIDEO_BITRATE_KBPS;

    onProgress({
      phase: "mounting",
      progress: 0,
      overallProgress: 0.1,
      message: "Mounting file (streaming from disk, no buffering)",
      durationSeconds,
    });

    // Clean up any stale mount from a prior run. `unmount` throws if the
    // mount point doesn't exist; swallow that.
    try {
      await ffmpeg.unmount(MOUNT_POINT);
    } catch {
      /* no prior mount */
    }
    try {
      await ffmpeg.createDir(MOUNT_POINT);
    } catch {
      /* already exists */
    }

    // Sanitize name — ffmpeg choke on odd characters in path.
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const mountedPath = `${MOUNT_POINT}/${safeName}`;

    // Supply the file under the sanitized name by using the `blobs` option
    // which lets us override the filename.
    // Type cast: @ffmpeg/ffmpeg's TS types for `mount` are a bit loose.
    const mountOk = await ffmpeg.mount(
      "WORKERFS" as unknown as Parameters<typeof ffmpeg.mount>[0],
      { blobs: [{ name: safeName, data: file }] } as unknown as Parameters<typeof ffmpeg.mount>[1],
      MOUNT_POINT,
    );
    if (!mountOk) {
      throw new Error(
        "WORKERFS mount failed. Your browser may not support streaming File access from a Web Worker.",
      );
    }

    const outputName = audioOnly ? "/out.m4a" : "/out.mp4";
    const realtimeFactor = audioOnly ? 1.5 : 0.25;
    let lastProgressAt = performance.now();
    const compressStartedAt = performance.now();
    let progressPct = 0;

    const handleProgress = ({ progress }: { progress: number }) => {
      const p = Math.min(1, Math.max(0, progress));
      progressPct = p;
      lastProgressAt = performance.now();
      let etaSeconds: number | null = null;
      if (p > 0.02) {
        const elapsed = (performance.now() - compressStartedAt) / 1000;
        etaSeconds = Math.max(1, Math.round((elapsed / p) * (1 - p)));
      } else if (durationSeconds > 0) {
        etaSeconds = Math.max(1, Math.round(durationSeconds / realtimeFactor));
      }
      onProgress({
        phase: "compressing",
        progress: p,
        overallProgress: 0.15 + p * 0.8,
        mode: audioOnly ? "audio-only" : "video",
        targetBitrateKbps: audioOnly ? AUDIO_BITRATE_KBPS : videoBitrateKbps + AUDIO_BITRATE_KBPS,
        durationSeconds,
        etaSeconds,
      });
    };
    ffmpeg.on("progress", handleProgress);

    let watchdogAborted = false;
    const watchdog = setInterval(() => {
      if (performance.now() - lastProgressAt > PROGRESS_WATCHDOG_MS) {
        watchdogAborted = true;
        try { ffmpeg.terminate(); } catch { /* already dead */ }
        clearInterval(watchdog);
      }
    }, 5000);

    const args = audioOnly
      ? [
          "-i", mountedPath,
          "-vn",
          "-c:a", "aac",
          "-b:a", `${AUDIO_BITRATE_KBPS}k`,
          "-ac", "1",
          "-movflags", "+faststart",
          outputName,
        ]
      : [
          "-i", mountedPath,
          "-c:v", "libx264",
          "-preset", "ultrafast",
          "-b:v", `${videoBitrateKbps}k`,
          "-maxrate", `${videoBitrateKbps}k`,
          "-bufsize", `${videoBitrateKbps * 2}k`,
          "-vf", `scale='min(${VIDEO_MAX_WIDTH},iw)':'-2'`,
          "-c:a", "aac",
          "-b:a", `${AUDIO_BITRATE_KBPS}k`,
          "-ac", "1",
          "-movflags", "+faststart",
          outputName,
        ];

    onProgress({
      phase: "compressing",
      progress: 0,
      overallProgress: 0.15,
      mode: audioOnly ? "audio-only" : "video",
      targetBitrateKbps: audioOnly ? AUDIO_BITRATE_KBPS : videoBitrateKbps + AUDIO_BITRATE_KBPS,
      durationSeconds,
    });

    try {
      await ffmpeg.exec(args);
    } catch (err) {
      if (watchdogAborted) {
        _ffmpeg = null;
        _loadPromise = null;
        throw new Error(
          `Compression stalled for 3 min at ${Math.round(progressPct * 100)}%. The file may be corrupted or in an unusual codec.`,
        );
      }
      throw err;
    } finally {
      clearInterval(watchdog);
      ffmpeg.off?.("progress", handleProgress);
      await ffmpeg.unmount(MOUNT_POINT).catch(() => {});
    }

    onProgress({
      phase: "finalizing",
      progress: 0,
      overallProgress: 0.96,
      mode: audioOnly ? "audio-only" : "video",
      durationSeconds,
      message: "Reading compressed output",
    });
    const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
    await ffmpeg.deleteFile(outputName).catch(() => {});

    if (data.byteLength > STREAM_UPLOAD_CAP_BYTES) {
      throw new Error(
        `Compressed file is ${(data.byteLength / 1024 / 1024).toFixed(1)} MB — still above the 50 MB upload cap. Try a shorter clip.`,
      );
    }

    const mime = audioOnly ? "audio/mp4" : "video/mp4";
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const outName = audioOnly ? `${baseName}-compressed.m4a` : `${baseName}-compressed.mp4`;
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(data);
    const outFile = new File([bytes], outName, { type: mime });

    onProgress({
      phase: "done",
      progress: 1,
      overallProgress: 1,
      mode: audioOnly ? "audio-only" : "video",
      durationSeconds,
    });
    return outFile;
  } catch (err) {
    onProgress({
      phase: "failed",
      progress: 0,
      overallProgress: 0,
      message: err instanceof Error ? err.message : "Compression failed",
    });
    throw err;
  }
}
