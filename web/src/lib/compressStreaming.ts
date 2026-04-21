// Streaming compressor backed by @ffmpeg/ffmpeg's WORKERFS mount. Lets the
// wasm worker read the input File lazily via Blob.slice() / FileReaderSync,
// so multi-GB inputs don't buffer into a JS ArrayBuffer. Browser RAM stays
// at ffmpeg's internal decode-buffer size (~100 MB peak) regardless of
// input file size.
//
// IMPORTANT: all duration/metadata detection happens INSIDE the ffmpeg
// worker via a fast probe pass. The main thread never calls
// HTMLVideoElement to read metadata — that freezes the tab on multi-GB
// files with moov-at-end MP4s or exotic containers.
import type { FFmpeg } from "@ffmpeg/ffmpeg";

export const STREAM_TARGET_BYTES = 47 * 1024 * 1024;
export const STREAM_UPLOAD_CAP_BYTES = 50 * 1024 * 1024;
const AUDIO_BITRATE_KBPS = 32;
const MIN_VIDEO_BITRATE_KBPS = 100;
const VIDEO_MAX_WIDTH = 640;
const PROGRESS_WATCHDOG_MS = 180_000; // 3 min — generous for single-threaded multi-GB runs
const MOUNT_POINT = "/mnt";
const HEARTBEAT_THROTTLE_MS = 300;

const CORE_JS = "/ffmpeg/ffmpeg-core.js";
const CORE_WASM = "/ffmpeg/ffmpeg-core.wasm";
const CLASS_WORKER_JS = "/ffmpeg/worker.js";

export type StreamPhase =
  | "idle"
  | "loading"
  | "mounting"
  | "analyzing"
  | "compressing"
  | "finalizing"
  | "done"
  | "failed"
  | "canceled";

export interface StreamProgress {
  phase: StreamPhase;
  progress: number;
  overallProgress: number;
  mode?: "video" | "audio-only";
  targetBitrateKbps?: number;
  durationSeconds?: number;
  etaSeconds?: number | null;
  /** Short human-readable line — latest ffmpeg log message during analysis. */
  message?: string;
}

export class CompressionCanceledError extends Error {
  constructor() {
    super("canceled");
    this.name = "CompressionCanceledError";
  }
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

function parseDurationFromLog(line: string): number | null {
  // ffmpeg stderr: "  Duration: 00:45:23.12, start: 0.000000, bitrate: 1234 kb/s"
  const m = line.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  const s = parseFloat(m[3]!);
  if (!isFinite(h + mm + s)) return null;
  return h * 3600 + mm * 60 + s;
}

export async function compressStreaming(
  file: File,
  onProgress: (p: StreamProgress) => void,
  options: { signal?: AbortSignal } = {},
): Promise<File> {
  const signal = options.signal;
  const throwIfAborted = () => {
    if (signal?.aborted) throw new CompressionCanceledError();
  };

  // Shared state mutated by the log handler.
  let probedDuration = 0;
  let lastHeartbeatAt = 0;
  let lastLogLine = "";
  let currentPhase: StreamPhase = "loading";
  let currentOverall = 0;

  const emitHeartbeat = () => {
    const now = performance.now();
    if (now - lastHeartbeatAt < HEARTBEAT_THROTTLE_MS) return;
    lastHeartbeatAt = now;
    onProgress({
      phase: currentPhase,
      progress: 0,
      overallProgress: currentOverall,
      message: lastLogLine.slice(0, 120),
      durationSeconds: probedDuration || undefined,
    });
  };

  const logHandler = ({ message }: { type?: string; message: string }) => {
    if (!message) return;
    lastLogLine = message;
    if (!probedDuration) {
      const d = parseDurationFromLog(message);
      if (d) probedDuration = d;
    }
    emitHeartbeat();
  };

  let ffmpeg: FFmpeg | null = null;

  try {
    throwIfAborted();

    // ── 1. Load ffmpeg.wasm ────────────────────────────────────────────
    currentPhase = "loading";
    currentOverall = 0;
    onProgress({
      phase: "loading",
      progress: 0,
      overallProgress: 0,
      message: "Getting the compressor ready…",
    });
    ffmpeg = await loadFFmpeg();
    ffmpeg.on("log", logHandler);
    currentOverall = 0.05;
    onProgress({ phase: "loading", progress: 1, overallProgress: 0.05 });

    // ── 2. Mount the file ──────────────────────────────────────────────
    throwIfAborted();
    currentPhase = "mounting";
    currentOverall = 0.08;
    onProgress({
      phase: "mounting",
      progress: 0,
      overallProgress: 0.08,
      message: "Getting your file ready…",
    });

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

    const safeName = file.name.replace(/[^\w.\-]+/g, "_") || "input.bin";
    const mountedPath = `${MOUNT_POINT}/${safeName}`;

    const mountOk = await ffmpeg.mount(
      "WORKERFS" as unknown as Parameters<typeof ffmpeg.mount>[0],
      { blobs: [{ name: safeName, data: file }] } as unknown as Parameters<typeof ffmpeg.mount>[1],
      MOUNT_POINT,
    );
    if (!mountOk) {
      throw new Error(
        "Couldn't prepare the file for compression. Your browser may not support this feature.",
      );
    }

    // ── 3. Probe pass: let ffmpeg read the container header and print
    //       Duration. Fast (1-5 s) for typical containers because WORKERFS
    //       only reads the chunks ffmpeg actually requests.
    throwIfAborted();
    currentPhase = "analyzing";
    currentOverall = 0.1;
    onProgress({
      phase: "analyzing",
      progress: 0,
      overallProgress: 0.1,
      message: "Checking your video…",
    });
    try {
      await ffmpeg.exec([
        "-hide_banner",
        "-analyzeduration", "10M",
        "-probesize", "10M",
        "-i", mountedPath,
        "-t", "0.1",
        "-f", "null",
        "-",
      ]);
    } catch {
      // ffmpeg may exit non-zero on `-f null -` for some containers. If we
      // captured a duration from the log, that's all we need — keep going.
      if (!probedDuration) {
        throw new Error(
          "Couldn't read this video's duration. The file may be corrupted or in a format the compressor doesn't recognize — try converting it to MP4 first.",
        );
      }
    }

    if (!probedDuration) {
      throw new Error(
        "This video's duration couldn't be determined. Try converting the file to MP4 (e.g. with HandBrake) first.",
      );
    }

    // ── 4. Compute bitrate budget from the probed duration ────────────
    const totalBudgetBits = STREAM_TARGET_BYTES * 8;
    const audioBudgetBits = AUDIO_BITRATE_KBPS * 1000 * probedDuration;
    const videoBudgetBits = totalBudgetBits - audioBudgetBits;
    const videoBitrateKbps = Math.max(0, Math.floor(videoBudgetBits / probedDuration / 1000));
    const audioOnly = videoBitrateKbps < MIN_VIDEO_BITRATE_KBPS;
    const realtimeFactor = audioOnly ? 1.5 : 0.25;

    // ── 5. Main compress ──────────────────────────────────────────────
    throwIfAborted();
    const outputName = audioOnly ? "/out.m4a" : "/out.mp4";
    const compressStartedAt = performance.now();
    let lastProgressAt = performance.now();
    let progressPct = 0;

    currentPhase = "compressing";
    const progressHandler = ({ progress }: { progress: number }) => {
      const p = Math.min(1, Math.max(0, progress));
      progressPct = p;
      lastProgressAt = performance.now();
      let etaSeconds: number | null = null;
      if (p > 0.02) {
        const elapsed = (performance.now() - compressStartedAt) / 1000;
        etaSeconds = Math.max(1, Math.round((elapsed / p) * (1 - p)));
      } else if (probedDuration > 0) {
        etaSeconds = Math.max(1, Math.round(probedDuration / realtimeFactor));
      }
      currentOverall = 0.15 + p * 0.8;
      onProgress({
        phase: "compressing",
        progress: p,
        overallProgress: currentOverall,
        mode: audioOnly ? "audio-only" : "video",
        targetBitrateKbps: audioOnly ? AUDIO_BITRATE_KBPS : videoBitrateKbps + AUDIO_BITRATE_KBPS,
        durationSeconds: probedDuration,
        etaSeconds,
      });
    };
    ffmpeg.on("progress", progressHandler);

    let watchdogAborted = false;
    let userCanceled = false;
    const watchdog = setInterval(() => {
      if (signal?.aborted && !userCanceled) {
        userCanceled = true;
        try { ffmpeg!.terminate(); } catch { /* already dead */ }
        clearInterval(watchdog);
        return;
      }
      if (performance.now() - lastProgressAt > PROGRESS_WATCHDOG_MS) {
        watchdogAborted = true;
        try { ffmpeg!.terminate(); } catch { /* already dead */ }
        clearInterval(watchdog);
      }
    }, 2000);

    const args = audioOnly
      ? [
          "-hide_banner",
          "-analyzeduration", "10M",
          "-probesize", "10M",
          "-i", mountedPath,
          "-vn",
          "-c:a", "aac",
          "-b:a", `${AUDIO_BITRATE_KBPS}k`,
          "-ac", "1",
          "-movflags", "+faststart",
          outputName,
        ]
      : [
          "-hide_banner",
          "-analyzeduration", "10M",
          "-probesize", "10M",
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

    currentOverall = 0.15;
    onProgress({
      phase: "compressing",
      progress: 0,
      overallProgress: 0.15,
      mode: audioOnly ? "audio-only" : "video",
      targetBitrateKbps: audioOnly ? AUDIO_BITRATE_KBPS : videoBitrateKbps + AUDIO_BITRATE_KBPS,
      durationSeconds: probedDuration,
    });

    try {
      await ffmpeg.exec(args);
    } catch (err) {
      if (userCanceled) {
        _ffmpeg = null;
        _loadPromise = null;
        throw new CompressionCanceledError();
      }
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
      ffmpeg.off?.("progress", progressHandler);
    }

    throwIfAborted();

    // ── 6. Read output, cleanup ──────────────────────────────────────
    currentPhase = "finalizing";
    currentOverall = 0.96;
    onProgress({
      phase: "finalizing",
      progress: 0,
      overallProgress: 0.96,
      mode: audioOnly ? "audio-only" : "video",
      durationSeconds: probedDuration,
      message: "Packaging the result…",
    });
    const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
    await ffmpeg.deleteFile(outputName).catch(() => {});
    await ffmpeg.unmount(MOUNT_POINT).catch(() => {});

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
      durationSeconds: probedDuration,
    });
    return outFile;
  } catch (err) {
    if (err instanceof CompressionCanceledError) {
      onProgress({
        phase: "canceled",
        progress: 0,
        overallProgress: 0,
        message: "Canceled",
      });
      throw err;
    }
    onProgress({
      phase: "failed",
      progress: 0,
      overallProgress: 0,
      message: err instanceof Error ? err.message : "Compression failed",
    });
    throw err;
  } finally {
    // Always detach the log listener so it doesn't leak across runs.
    try { ffmpeg?.off?.("log", logHandler); } catch { /* ignore */ }
    try { await ffmpeg?.unmount(MOUNT_POINT); } catch { /* ignore */ }
  }
}
