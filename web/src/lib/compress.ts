// Note: @ffmpeg/ffmpeg is dynamically imported inside loadFFmpeg() so its
// dependency graph never lands in the initial bundle — only users who upload
// a file >45 MB pay the download cost. @ffmpeg/util is tiny and stays eager.
import type { FFmpeg } from "@ffmpeg/ffmpeg";

// Supabase free tier caps uploads at 50 MB. Target 47 MB to leave safety margin
// for container overhead.
export const COMPRESS_TARGET_BYTES = 47 * 1024 * 1024;
export const UPLOAD_CAP_BYTES = 50 * 1024 * 1024;

// Only compress files larger than this. Below the target, just upload as-is.
export const COMPRESS_THRESHOLD_BYTES = 45 * 1024 * 1024;

// Hard input cap. ffmpeg.wasm has to buffer the whole file in browser RAM;
// beyond this, tabs reliably OOM or silently hang.
export const INPUT_HARD_CAP_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
export const INPUT_SOFT_WARN_BYTES = 500 * 1024 * 1024;     // 500 MB

const AUDIO_BITRATE_KBPS = 32;
const MIN_VIDEO_BITRATE_KBPS = 100;
// Self-hosted at /public/ffmpeg/ — same-origin.
const CORE_JS = "/ffmpeg/ffmpeg-core.js";
const CORE_WASM = "/ffmpeg/ffmpeg-core.wasm";
const CLASS_WORKER_JS = "/ffmpeg/worker.js";

// Abort compression if ffmpeg.wasm doesn't report forward progress within this
// window — catches silent stalls.
const PROGRESS_WATCHDOG_MS = 120_000; // 2 minutes
// Abort the buffer-into-memory step after this long (huge files on slow
// machines can take 30-60s legitimately; beyond 5 min something is wrong).
const BUFFER_WATCHDOG_MS = 5 * 60_000;

export type CompressPhase =
  | "idle"
  | "loading"    // fetching ffmpeg.wasm core
  | "reading"    // reading video metadata (duration probe)
  | "buffering"  // reading the whole file into JS memory + writing into ffmpeg FS
  | "compressing"
  | "finalizing" // ffmpeg done, reading output back out
  | "done"
  | "failed";

export interface CompressProgress {
  phase: CompressPhase;
  progress: number; // 0..1 within current phase
  overallProgress: number; // 0..1 across all phases
  mode?: "video" | "audio-only";
  targetBitrateKbps?: number;
  durationSeconds?: number;
  /** Rough seconds remaining, or null if we can't estimate yet. */
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

export function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const d = el.duration;
      URL.revokeObjectURL(url);
      if (!isFinite(d) || d <= 0) return reject(new Error("Could not read video duration"));
      resolve(d);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load video for metadata probe — unsupported format?"));
    };
    el.src = url;
  });
}

/** Read a File/Blob into a Uint8Array with a timeout. Raises a clear error on hang. */
async function readFileWithTimeout(file: File, onHeartbeat?: () => void): Promise<Uint8Array> {
  const start = performance.now();
  // Heartbeat every 500ms so the UI knows we haven't frozen.
  const hb = onHeartbeat
    ? setInterval(() => {
        if (performance.now() - start > BUFFER_WATCHDOG_MS) return;
        onHeartbeat();
      }, 500)
    : null;
  try {
    const timeoutPromise = new Promise<never>((_, rej) => {
      setTimeout(
        () =>
          rej(
            new Error(
              `Timed out buffering ${(file.size / 1024 / 1024).toFixed(0)} MB into memory after 5 min. Try a smaller file or pre-compress externally.`,
            ),
          ),
        BUFFER_WATCHDOG_MS,
      );
    });
    const buf = await Promise.race([file.arrayBuffer(), timeoutPromise]);
    return new Uint8Array(buf);
  } finally {
    if (hb) clearInterval(hb);
  }
}

export async function compressForUpload(
  file: File,
  onProgress: (p: CompressProgress) => void,
): Promise<File> {
  if (file.size > INPUT_HARD_CAP_BYTES) {
    throw new Error(
      `File is ${(file.size / 1024 / 1024 / 1024).toFixed(2)} GB — the in-browser compressor can't safely handle files over 2 GB. ` +
        `Pre-compress locally first (takes 30-90 s for a 3-hour video): download the script at /compress-tool/`,
    );
  }

  try {
    // Phase 1: load ffmpeg.wasm core (~30 MB, cached after first time)
    onProgress({
      phase: "loading",
      progress: 0,
      overallProgress: 0,
      message: "Loading in-browser compressor (~30 MB, first time only)",
    });
    const ffmpeg = await loadFFmpeg();
    onProgress({ phase: "loading", progress: 1, overallProgress: 0.05 });

    // Phase 2: probe metadata
    onProgress({
      phase: "reading",
      progress: 0,
      overallProgress: 0.07,
      message: "Reading video metadata",
    });
    const durationSeconds = await getVideoDuration(file);

    // Decide mode (video vs audio-only) up front.
    const totalBudgetBits = COMPRESS_TARGET_BYTES * 8;
    const audioBudgetBits = AUDIO_BITRATE_KBPS * 1000 * durationSeconds;
    const videoBudgetBits = totalBudgetBits - audioBudgetBits;
    const videoBitrateKbps = Math.max(0, Math.floor(videoBudgetBits / durationSeconds / 1000));
    const audioOnly = videoBitrateKbps < MIN_VIDEO_BITRATE_KBPS;

    const sizeMB = file.size / 1024 / 1024;
    const heavyFile = file.size > INPUT_SOFT_WARN_BYTES;

    // Phase 3: buffer the file into memory
    const bufferStart = performance.now();
    onProgress({
      phase: "buffering",
      progress: 0,
      overallProgress: 0.1,
      durationSeconds,
      message: heavyFile
        ? `Loading ${sizeMB.toFixed(0)} MB into memory — this can take 30-60s for large files`
        : `Loading ${sizeMB.toFixed(0)} MB into memory`,
    });
    const fileBytes = await readFileWithTimeout(file, () => {
      const elapsed = (performance.now() - bufferStart) / 1000;
      onProgress({
        phase: "buffering",
        progress: Math.min(0.9, elapsed / 30), // visual creep up to 90% over 30s
        overallProgress: 0.1 + Math.min(0.05, elapsed / 30 / 20),
        durationSeconds,
        message: `Buffering ${sizeMB.toFixed(0)} MB (${Math.round(elapsed)}s elapsed)`,
      });
    });

    const inputName = "input.bin";
    const outputName = audioOnly ? "output.m4a" : "output.mp4";
    await ffmpeg.writeFile(inputName, fileBytes);

    // Phase 4: ffmpeg transcode with watchdog
    const realtimeFactor = audioOnly ? 1.5 : 0.25;
    let lastProgressAt = performance.now();
    const compressStartedAt = performance.now();
    let progressPct = 0;

    const handleProgress = ({ progress }: { progress: number }) => {
      const p = Math.min(1, Math.max(0, progress));
      progressPct = p;
      lastProgressAt = performance.now();
      let etaSeconds: number | null = null;
      if (p > 0.05) {
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

    // Watchdog: if no progress for PROGRESS_WATCHDOG_MS, abort with a clear error.
    let watchdogAborted = false;
    const watchdog = setInterval(() => {
      if (performance.now() - lastProgressAt > PROGRESS_WATCHDOG_MS) {
        watchdogAborted = true;
        ffmpeg.terminate();
        clearInterval(watchdog);
      }
    }, 5000);

    const args = audioOnly
      ? [
          "-i", inputName,
          "-vn",
          "-c:a", "aac",
          "-b:a", `${AUDIO_BITRATE_KBPS}k`,
          "-ac", "1",
          "-movflags", "+faststart",
          outputName,
        ]
      : [
          "-i", inputName,
          "-c:v", "libx264",
          "-preset", "ultrafast",
          "-b:v", `${videoBitrateKbps}k`,
          "-maxrate", `${videoBitrateKbps}k`,
          "-bufsize", `${videoBitrateKbps * 2}k`,
          "-vf", "scale='min(640,iw)':'-2'",
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
        // ffmpeg.wasm got reset; invalidate singleton so next try re-loads.
        _ffmpeg = null;
        _loadPromise = null;
        throw new Error(
          `Compression stalled for over 2 min at ${Math.round(progressPct * 100)}%. The file may be too large or in an unsupported format. Try a shorter clip or pre-compress externally.`,
        );
      }
      throw err;
    } finally {
      clearInterval(watchdog);
      ffmpeg.off?.("progress", handleProgress);
    }

    // Phase 5: read output back out
    onProgress({
      phase: "finalizing",
      progress: 0,
      overallProgress: 0.96,
      mode: audioOnly ? "audio-only" : "video",
      durationSeconds,
      message: "Reading compressed output",
    });
    const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});

    if (data.byteLength > UPLOAD_CAP_BYTES) {
      throw new Error(
        `Compressed file is ${(data.byteLength / 1024 / 1024).toFixed(1)} MB — still above the 50 MB upload cap. Try trimming the video or uploading a shorter clip.`,
      );
    }

    const mime = audioOnly ? "audio/mp4" : "video/mp4";
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const outName = audioOnly ? `${baseName}.m4a` : `${baseName}.mp4`;
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
