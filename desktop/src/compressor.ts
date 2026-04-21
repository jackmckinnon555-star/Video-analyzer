import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import ffmpegPath from "ffmpeg-static";
import ffprobeStaticImport from "ffprobe-static";
import {
  AUDIO_BITRATE_KBPS,
  MIN_VIDEO_BITRATE_KBPS,
  TARGET_BYTES,
  UPLOAD_CAP_BYTES,
  VIDEO_MAX_WIDTH,
  type JobProgress,
  type ProbeResult,
} from "./ipc.js";

// ffmpeg-static / ffprobe-static ship compiled binaries but their paths point
// into node_modules, which moves inside the asar archive when packaged. We
// asarUnpack them (see electron-builder.yml) and rewrite the path to point
// at the unpacked location when running from the packaged app.
function resolveBinary(p: string | null): string {
  if (!p) throw new Error("Bundled ffmpeg binary is missing");
  return p.replace("app.asar", "app.asar.unpacked");
}

const FFMPEG = resolveBinary(ffmpegPath as unknown as string | null);
const FFPROBE = resolveBinary((ffprobeStaticImport as { path: string }).path);

export interface ProgressSink {
  (p: JobProgress): void;
}

/** Fast metadata probe via ffprobe. Reads only container headers. */
export async function probe(filepath: string): Promise<ProbeResult> {
  if (!fs.existsSync(filepath)) throw new Error(`File not found: ${filepath}`);
  const stat = await fs.promises.stat(filepath);
  const duration = await runFfprobeDuration(filepath);
  if (!duration || duration <= 0) {
    throw new Error("Couldn't read video duration. The file may be corrupted.");
  }
  const totalBudgetBits = TARGET_BYTES * 8;
  const audioBudgetBits = AUDIO_BITRATE_KBPS * 1000 * duration;
  const videoBudgetBits = totalBudgetBits - audioBudgetBits;
  const videoKbps = Math.max(0, Math.floor(videoBudgetBits / duration / 1000));
  const audioOnly = videoKbps < MIN_VIDEO_BITRATE_KBPS;
  const realtimeFactor = audioOnly ? 4 : 3; // native ffmpeg multi-core
  return {
    filename: path.basename(filepath),
    filepath,
    sizeBytes: stat.size,
    durationSeconds: duration,
    mode: audioOnly ? "audio-only" : "video",
    targetSizeBytes: TARGET_BYTES,
    estimatedSeconds: Math.max(5, Math.ceil(duration / realtimeFactor)),
  };
}

function runFfprobeDuration(filepath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFPROBE, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filepath,
    ]);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d: Buffer) => (out += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (err += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}: ${err.slice(0, 300)}`));
      const n = Number(out.trim());
      if (!isFinite(n)) return reject(new Error("ffprobe returned non-numeric duration"));
      resolve(n);
    });
  });
}

export interface RunContext {
  ffmpegProc: ChildProcess | null;
  abortController: AbortController;
  canceled: boolean;
}

/**
 * Compress + upload + finalize. Emits progress through the `onProgress` sink.
 * Returns the video id on success; throws on failure.
 */
export async function compressAndUpload(
  filepath: string,
  baseUrl: string,
  password: string,
  onProgress: ProgressSink,
  ctx: RunContext,
): Promise<{ videoId: string; resultUrl: string }> {
  const info = await probe(filepath);
  onProgress({
    phase: "probing",
    progress: 1,
    overallProgress: 0.02,
    mode: info.mode,
    message: `${Math.round(info.durationSeconds / 60)} min source`,
  });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tra-uploader-"));
  const outExt = info.mode === "audio-only" ? ".m4a" : ".mp4";
  const outName = path.basename(info.filename, path.extname(info.filename)) + "-compressed" + outExt;
  const outPath = path.join(tmpDir, outName);

  try {
    // ─── Compress ────────────────────────────────────────────────────
    await runCompress(info, outPath, (p, etaSeconds) => {
      onProgress({
        phase: "compressing",
        progress: p,
        overallProgress: 0.05 + p * 0.75,
        mode: info.mode,
        etaSeconds,
        message: `${Math.round(p * 100)}% · ${humanDuration(info.durationSeconds)} of ${info.mode === "audio-only" ? "audio" : "video"}`,
      });
    }, ctx);

    if (ctx.canceled) throw new Error("canceled");

    const outSize = fs.statSync(outPath).size;
    if (outSize > UPLOAD_CAP_BYTES) {
      throw new Error(
        `Compressed file is ${(outSize / 1024 / 1024).toFixed(1)} MB — still above the 50 MB upload cap. Try a shorter clip.`,
      );
    }

    // ─── Presign ────────────────────────────────────────────────────
    onProgress({
      phase: "uploading",
      progress: 0,
      overallProgress: 0.82,
      message: "Reserving upload slot…",
    });
    const contentType = info.mode === "audio-only" ? "audio/mp4" : "video/mp4";
    const presign = await fetchJson<{
      videoId: string;
      signedUrl: string;
    }>(`${baseUrl}/api/presign-upload`, {
      method: "POST",
      headers: {
        "X-Site-Password": password,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filename: outName,
        contentType,
        sizeBytes: outSize,
      }),
    });

    if (ctx.canceled) throw new Error("canceled");

    // ─── PUT to signed URL ─────────────────────────────────────────
    await streamedPut(presign.signedUrl, outPath, outSize, contentType, (p) => {
      onProgress({
        phase: "uploading",
        progress: p,
        overallProgress: 0.82 + p * 0.14,
        message: `Uploading… ${Math.round(p * 100)}%`,
      });
    }, ctx.abortController.signal);

    if (ctx.canceled) throw new Error("canceled");

    // ─── Finalize ──────────────────────────────────────────────────
    onProgress({
      phase: "finalizing",
      progress: 0,
      overallProgress: 0.97,
      message: "Queuing for processing…",
    });
    await fetchJson(`${baseUrl}/api/finalize-upload`, {
      method: "POST",
      headers: {
        "X-Site-Password": password,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ videoId: presign.videoId }),
    });

    const resultUrl = `${baseUrl}/video/${presign.videoId}`;
    onProgress({
      phase: "done",
      progress: 1,
      overallProgress: 1,
      message: "Done",
    });
    return { videoId: presign.videoId, resultUrl };
  } finally {
    // Clean up the compressed temp file and its dir.
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function runCompress(
  info: ProbeResult,
  outPath: string,
  onProgress: (pct: number, etaSeconds: number | null) => void,
  ctx: RunContext,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const audioOnly = info.mode === "audio-only";
    const videoBitrateKbps = Math.max(
      0,
      Math.floor(
        (TARGET_BYTES * 8 - AUDIO_BITRATE_KBPS * 1000 * info.durationSeconds) /
          info.durationSeconds /
          1000,
      ),
    );
    const args = audioOnly
      ? [
          "-hide_banner", "-nostats", "-loglevel", "info",
          "-y", "-i", info.filepath,
          "-vn",
          "-c:a", "aac", "-b:a", `${AUDIO_BITRATE_KBPS}k`, "-ac", "1",
          "-movflags", "+faststart",
          "-progress", "pipe:2",
          outPath,
        ]
      : [
          "-hide_banner", "-nostats", "-loglevel", "info",
          "-y", "-i", info.filepath,
          "-c:v", "libx264", "-preset", "ultrafast",
          "-b:v", `${videoBitrateKbps}k`,
          "-maxrate", `${videoBitrateKbps}k`,
          "-bufsize", `${videoBitrateKbps * 2}k`,
          "-vf", `scale='min(${VIDEO_MAX_WIDTH},iw)':'-2'`,
          "-c:a", "aac", "-b:a", `${AUDIO_BITRATE_KBPS}k`, "-ac", "1",
          "-movflags", "+faststart",
          "-progress", "pipe:2",
          outPath,
        ];

    const proc = spawn(FFMPEG, args);
    ctx.ffmpegProc = proc;
    const startedAt = Date.now();
    let errBuf = "";

    proc.stderr.on("data", (d: Buffer) => {
      const chunk = d.toString();
      errBuf += chunk;
      // Cap the buffer so we don't blow memory on long runs.
      if (errBuf.length > 100_000) errBuf = errBuf.slice(-20_000);
      // `-progress pipe:2` emits lines like `out_time_ms=12345678\n` on stderr
      // along with normal stderr. Parse out_time_ms.
      const matches = chunk.match(/out_time_ms=(\d+)/g);
      if (matches && matches.length > 0) {
        const lastMatch = matches[matches.length - 1]!;
        const usMatch = lastMatch.match(/out_time_ms=(\d+)/);
        if (usMatch && usMatch[1]) {
          const outTimeUs = Number(usMatch[1]);
          const outTimeSec = outTimeUs / 1_000_000;
          const pct = Math.max(0, Math.min(1, outTimeSec / info.durationSeconds));
          const elapsed = (Date.now() - startedAt) / 1000;
          const eta = pct > 0.02 ? Math.round((elapsed / pct) * (1 - pct)) : null;
          onProgress(pct, eta);
        }
      }
    });

    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      ctx.ffmpegProc = null;
      if (ctx.canceled) return reject(new Error("canceled"));
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg exited ${code}: ${errBuf.slice(-400)}`));
    });
  });
}

async function streamedPut(
  url: string,
  filepath: string,
  totalSize: number,
  contentType: string,
  onProgress: (pct: number) => void,
  signal: AbortSignal,
): Promise<void> {
  // Wrap the file read stream with a counting transform for upload progress.
  const fileStream = fs.createReadStream(filepath);
  let uploaded = 0;
  fileStream.on("data", (chunk: Buffer | string) => {
    uploaded += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
    onProgress(Math.min(1, uploaded / totalSize));
  });

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(totalSize),
    },
    body: Readable.toWeb(fileStream) as unknown as BodyInit,
    signal,
    // @ts-expect-error Node fetch requires duplex for streaming bodies
    duplex: "half",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Upload failed ${res.status}: ${body.slice(0, 200)}`);
  }
}

async function fetchJson<T = unknown>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    // Surface specific codes with friendly hints.
    if (res.status === 401) throw new Error("Invalid site password.");
    throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Server returned non-JSON: ${text.slice(0, 200)}`);
  }
}

function humanDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${h} hr` : `${h}h ${mm}m`;
}

export function cancelRun(ctx: RunContext): void {
  ctx.canceled = true;
  try { ctx.abortController.abort(); } catch { /* ignore */ }
  if (ctx.ffmpegProc && !ctx.ffmpegProc.killed) {
    try { ctx.ffmpegProc.kill("SIGTERM"); } catch { /* ignore */ }
    // Windows: SIGTERM is emulated; kill forcefully after 2s if still alive.
    setTimeout(() => {
      if (ctx.ffmpegProc && !ctx.ffmpegProc.killed) {
        try { ctx.ffmpegProc.kill("SIGKILL"); } catch { /* ignore */ }
      }
    }, 2000);
  }
}
