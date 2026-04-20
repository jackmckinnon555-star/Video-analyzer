// Note: @ffmpeg/ffmpeg is dynamically imported inside loadFFmpeg() so its
// dependency graph never lands in the initial bundle — only users who upload
// a file >45 MB pay the download cost. @ffmpeg/util is tiny and stays eager.
import { fetchFile } from "@ffmpeg/util";
import type { FFmpeg } from "@ffmpeg/ffmpeg";

// Supabase free tier caps uploads at 50 MB. Target 47 MB to leave safety margin
// for container overhead.
export const COMPRESS_TARGET_BYTES = 47 * 1024 * 1024;
export const UPLOAD_CAP_BYTES = 50 * 1024 * 1024;

// Only compress files larger than this. Below the target, just upload as-is.
export const COMPRESS_THRESHOLD_BYTES = 45 * 1024 * 1024;

const AUDIO_BITRATE_KBPS = 32;
const MIN_VIDEO_BITRATE_KBPS = 100;
// Self-hosted at /public/ffmpeg/ — same-origin. Copied from node_modules by
// the prebuild step. Avoids cross-origin Worker construction and importScripts
// CORS issues that hit every CDN-based approach in @ffmpeg/ffmpeg@0.12.15.
const CORE_JS = "/ffmpeg/ffmpeg-core.js";
const CORE_WASM = "/ffmpeg/ffmpeg-core.wasm";
const CLASS_WORKER_JS = "/ffmpeg/worker.js";

export type CompressPhase =
  | "idle"
  | "loading"
  | "reading"
  | "compressing"
  | "done"
  | "failed";

export interface CompressProgress {
  phase: CompressPhase;
  progress: number; // 0..1 within current phase
  overallProgress: number; // 0..1 across loading + compressing
  mode?: "video" | "audio-only";
  targetBitrateKbps?: number;
  durationSeconds?: number;
  /** Rough seconds remaining, or null if we can't estimate yet. */
  etaSeconds?: number | null;
  message?: string;
}

let _ffmpeg: FFmpeg | null = null;
let _loadPromise: Promise<FFmpeg> | null = null;

async function loadFFmpeg(onLoad?: () => void): Promise<FFmpeg> {
  if (_ffmpeg) return _ffmpeg;
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    const { FFmpeg: FFmpegCtor } = await import("@ffmpeg/ffmpeg");
    const ffmpeg = new FFmpegCtor();
    // Use same-origin URLs for both the core and the SDK's wrapper worker.
    // The SDK spawns `new Worker(classWorkerURL, { type: 'module' })`, which
    // requires same-origin — blob URLs for the module worker hang in some
    // browsers. Plain absolute paths under /ffmpeg/ are bulletproof.
    await ffmpeg.load({
      coreURL: CORE_JS,
      wasmURL: CORE_WASM,
      classWorkerURL: CLASS_WORKER_JS,
    });
    _ffmpeg = ffmpeg;
    onLoad?.();
    return ffmpeg;
  })();
  return _loadPromise;
}

/**
 * Read the raw duration from video metadata without touching ffmpeg.
 * Fast and cheap — avoids a full decode just to get a number.
 */
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
      reject(new Error("Could not load video for metadata probe"));
    };
    el.src = url;
  });
}

/**
 * Compress a video file in the browser to fit under UPLOAD_CAP_BYTES.
 * Uses ffmpeg.wasm single-threaded (no SharedArrayBuffer / COOP headers required).
 *
 * Strategy:
 * - Compute target video bitrate from budget and duration.
 * - If it falls below MIN_VIDEO_BITRATE_KBPS, fall back to audio-only extraction
 *   (preserves transcript + analysis quality; sacrifices visual playback).
 */
export async function compressForUpload(
  file: File,
  onProgress: (p: CompressProgress) => void,
): Promise<File> {
  try {
    onProgress({
      phase: "loading",
      progress: 0,
      overallProgress: 0,
      message: "Loading in-browser compressor (~30 MB, first time only)",
    });
    const ffmpeg = await loadFFmpeg(() =>
      onProgress({ phase: "loading", progress: 1, overallProgress: 0.1 }),
    );

    onProgress({ phase: "reading", progress: 0, overallProgress: 0.12, message: "Reading video metadata" });
    const durationSeconds = await getVideoDuration(file);

    const totalBudgetBits = COMPRESS_TARGET_BYTES * 8;
    const audioBudgetBits = AUDIO_BITRATE_KBPS * 1000 * durationSeconds;
    const videoBudgetBits = totalBudgetBits - audioBudgetBits;
    const videoBitrateKbps = Math.max(0, Math.floor(videoBudgetBits / durationSeconds / 1000));
    const audioOnly = videoBitrateKbps < MIN_VIDEO_BITRATE_KBPS;

    const inputName = "input.bin";
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    const outputName = audioOnly ? "output.m4a" : "output.mp4";

    // Rough ETA baseline: ultrafast libx264 runs at ~0.2-0.35x realtime in-browser.
    // Audio-only is ~4x faster (no video encode).
    const realtimeFactor = audioOnly ? 1.2 : 0.25;
    const compressStartedAt = performance.now();
    ffmpeg.on("progress", ({ progress }) => {
      const p = Math.min(1, progress);
      // Prefer elapsed-based ETA once we have ≥5% progress; fall back to the
      // duration × factor heuristic otherwise.
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
    });

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

    await ffmpeg.exec(args);
    const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});

    if (data.byteLength > UPLOAD_CAP_BYTES) {
      throw new Error(
        `Compressed file is ${(data.byteLength / 1024 / 1024).toFixed(1)} MB — still above the 50 MB upload cap. ` +
          `Try trimming the video or uploading a shorter clip.`,
      );
    }

    const mime = audioOnly ? "audio/mp4" : "video/mp4";
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const outName = audioOnly ? `${baseName}.m4a` : `${baseName}.mp4`;
    // Copy into a plain Uint8Array with a fresh ArrayBuffer to satisfy File's BlobPart typing.
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
