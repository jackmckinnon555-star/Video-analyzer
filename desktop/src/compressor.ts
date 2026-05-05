import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import ffmpegPath from "ffmpeg-static";
import ffprobeStaticImport from "ffprobe-static";
import {
  AUDIO_BITRATE_LADDER_KBPS,
  MIN_VIDEO_BITRATE_KBPS,
  TARGET_BYTES,
  UPLOAD_CAP_BYTES,
  VIDEO_MAX_WIDTH,
  type JobProgress,
  type PartPlan,
  type ProbeResult,
} from "./ipc.js";

/** When a source's duration exceeds this, we split into segments. Picked so
 *  that each segment fits comfortably at 16 kbps audio-only (7.3 hr ceiling)
 *  with margin — better quality than forcing the whole file to 8 kbps. */
const SEGMENT_SECONDS = 6 * 60 * 60; // 6 hours
/** Lower bound for triggering segmentation: just past the 8 kbps ceiling. */
const SPLIT_THRESHOLD_SECONDS = 14 * 60 * 60; // 14 hr

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

const UPLOAD_MAX_ATTEMPTS = 3;
const UPLOAD_RETRY_DELAYS_MS = [1_000, 4_000, 16_000];

export interface ProgressSink {
  (p: JobProgress): void;
}

/** Pick the smallest audio bitrate from the ladder that fits under the cap for `duration`. */
function pickAudioBitrate(durationSeconds: number, capBytes = UPLOAD_CAP_BYTES): number | null {
  for (const kbps of AUDIO_BITRATE_LADDER_KBPS) {
    const bytes = (kbps * 1000 * durationSeconds) / 8;
    if (bytes <= capBytes) return kbps;
  }
  // Even 8 kbps can't fit — caller should split into parts instead.
  return null;
}

/** Compute a multi-part plan if the source is too long for the audio-only ladder. */
function planParts(durationSeconds: number): PartPlan | null {
  if (durationSeconds <= SPLIT_THRESHOLD_SECONDS) return null;
  const totalParts = Math.ceil(durationSeconds / SEGMENT_SECONDS);
  return { totalParts, segmentSeconds: SEGMENT_SECONDS };
}

/** Fast metadata probe via ffprobe. Reads only container headers (with a roomy analyzeduration). */
export async function probe(filepath: string): Promise<ProbeResult> {
  if (!fs.existsSync(filepath)) throw new Error(`File not found: ${filepath}`);
  const stat = await fs.promises.stat(filepath);
  const meta = await runFfprobeMeta(filepath);
  if (!meta.durationSeconds || meta.durationSeconds <= 0) {
    throw new Error("Couldn't read video duration. The file may be corrupted or not a media file.");
  }
  const duration = meta.durationSeconds;

  // Very long source → plan to split into ~6 hr segments. Each segment then
  // probes/compresses normally on its own.
  const partPlan = planParts(duration);
  if (partPlan) {
    // For multi-part, the per-part bitrate decision happens after the split.
    // We still report a placeholder mode/bitrate so the renderer can describe
    // the upcoming work.
    const segmentDuration = partPlan.segmentSeconds;
    const segmentAudioKbps = pickAudioBitrate(segmentDuration) ?? AUDIO_BITRATE_LADDER_KBPS[0];
    return {
      filename: path.basename(filepath),
      filepath,
      sizeBytes: stat.size,
      durationSeconds: duration,
      mode: "audio-only",
      audioKbps: segmentAudioKbps,
      videoKbps: undefined,
      hasAudio: meta.hasAudio,
      targetSizeBytes: TARGET_BYTES,
      // Per-part realtime factor × number of parts, plus stream-copy split
      // overhead (~1 min per part).
      estimatedSeconds: Math.ceil((duration / 4) + partPlan.totalParts * 60),
      partPlan,
    };
  }

  const audioKbps = pickAudioBitrate(duration);
  if (audioKbps == null) {
    // Should be unreachable thanks to planParts, but defend against future
    // changes to the constants.
    throw new Error(
      `This file is too long to fit under 50 MB even as compressed audio (~${humanDuration(duration)}). Trim it first.`,
    );
  }

  // Decide video vs audio-only based on bitrate budget at the chosen audio rate.
  const totalBudgetBits = TARGET_BYTES * 8;
  const audioBudgetBits = audioKbps * 1000 * duration;
  const videoBudgetBits = totalBudgetBits - audioBudgetBits;
  const videoKbps = Math.max(0, Math.floor(videoBudgetBits / duration / 1000));
  const audioOnly = videoKbps < MIN_VIDEO_BITRATE_KBPS;

  // If the input has no video stream at all, force audio-only.
  const mode: "video" | "audio-only" = !meta.hasVideo ? "audio-only" : (audioOnly ? "audio-only" : "video");

  const realtimeFactor = mode === "audio-only" ? 4 : 3;
  return {
    filename: path.basename(filepath),
    filepath,
    sizeBytes: stat.size,
    durationSeconds: duration,
    mode,
    audioKbps,
    videoKbps: mode === "video" ? videoKbps : undefined,
    hasAudio: meta.hasAudio,
    targetSizeBytes: TARGET_BYTES,
    estimatedSeconds: Math.max(5, Math.ceil(duration / realtimeFactor)),
  };
}

interface FfprobeMeta {
  durationSeconds: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

function runFfprobeMeta(filepath: string): Promise<FfprobeMeta> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFPROBE, [
      "-v", "error",
      // Roomy analyzeduration handles MOVs with moov-at-end / unusual codecs.
      "-analyzeduration", "100M",
      "-probesize", "100M",
      "-show_entries", "format=duration:stream=codec_type",
      "-of", "default=noprint_wrappers=1",
      filepath,
    ]);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d: Buffer) => (out += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (err += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}: ${err.slice(0, 300)}`));
      const durMatch = out.match(/duration=([\d.]+)/);
      const duration = durMatch && durMatch[1] ? Number(durMatch[1]) : NaN;
      const codecTypes = [...out.matchAll(/codec_type=(\w+)/g)].map((m) => m[1]);
      resolve({
        durationSeconds: isFinite(duration) ? duration : 0,
        hasVideo: codecTypes.includes("video"),
        hasAudio: codecTypes.includes("audio"),
      });
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
 *
 * The compression step is wrapped so that if the output overshoots the upload
 * cap (rare — happens with extreme content where the bitrate estimate was off),
 * we step the audio bitrate down one rung and retry once.
 */
export async function compressAndUpload(
  filepath: string,
  baseUrl: string,
  password: string,
  onProgress: ProgressSink,
  ctx: RunContext,
): Promise<{ videoId: string; resultUrl: string }> {
  const initialInfo = await probe(filepath);

  // Multi-part path: source is too long for the audio-only ladder. Split via
  // ffmpeg stream-copy into ~6 hr segments, then run the normal single-file
  // compress/upload on each.
  if (initialInfo.partPlan) {
    return compressAndUploadParts(initialInfo, baseUrl, password, onProgress, ctx);
  }

  onProgress({
    phase: "probing",
    progress: 1,
    overallProgress: 0.02,
    mode: initialInfo.mode,
    message: `${humanDuration(initialInfo.durationSeconds)} source · ${initialInfo.mode === "audio-only" ? `audio @ ${initialInfo.audioKbps} kbps` : `video @ ~${initialInfo.videoKbps} kbps`}`,
  });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tra-uploader-"));

  try {
    const { videoId } = await compressAndUploadOne(initialInfo, tmpDir, baseUrl, password, onProgress, ctx, {
      compressStart: 0.05,
      compressEnd: 0.80,
      uploadStart: 0.82,
      uploadEnd: 0.96,
    });

    // ─── Finalize ────────────────────────────────────────────────────
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
      body: JSON.stringify({ videoId }),
    });

    const resultUrl = `${baseUrl}/video/${videoId}`;
    onProgress({ phase: "done", progress: 1, overallProgress: 1, message: "Done" });
    return { videoId, resultUrl };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

interface ProgressBudget {
  /** 0..1 overall progress where the compress phase starts. */
  compressStart: number;
  /** 0..1 overall progress where the compress phase ends. */
  compressEnd: number;
  uploadStart: number;
  uploadEnd: number;
}

/**
 * Compress + presign + upload a single file. Returns the videoId. Does NOT
 * call /api/finalize-upload — the caller decides when to finalize (and
 * whether to bundle multiple parts via the childIds field).
 */
async function compressAndUploadOne(
  inputInfo: ProbeResult,
  tmpDir: string,
  baseUrl: string,
  password: string,
  onProgress: ProgressSink,
  ctx: RunContext,
  budget: ProgressBudget,
): Promise<{ videoId: string }> {
  // ─── Compress (with one bitrate-step-down retry if oversized) ────
  const compressSpan = budget.compressEnd - budget.compressStart;
  const { outPath, info: finalInfo } = await compressWithFit(
    inputInfo,
    tmpDir,
    (p) => {
      // p is the inner phase progress (0..1 within compress); map to overall budget.
      const remapped: JobProgress = {
        ...p,
        overallProgress: budget.compressStart + (p.progress ?? 0) * compressSpan,
      };
      onProgress(remapped);
    },
    ctx,
  );

  if (ctx.canceled) throw new Error("canceled");

  const outSize = fs.statSync(outPath).size;
  const outName = path.basename(outPath);
  const contentType = finalInfo.mode === "audio-only" ? "audio/mp4" : "video/mp4";

  // Pre-validate the compressed file (defense vs. silent ffmpeg failures).
  const outMeta = await runFfprobeMeta(outPath).catch((err) => {
    throw new Error(
      `Compressed output is malformed (ffprobe couldn't read it): ${err instanceof Error ? err.message : err}. Try a different source file.`,
    );
  });
  if (!outMeta.durationSeconds || outMeta.durationSeconds <= 0) {
    throw new Error(
      "Compressed output has no readable duration. The encode may have failed silently — try a different source file.",
    );
  }
  if (finalInfo.hasAudio && !outMeta.hasAudio) {
    throw new Error(
      "Compressed output lost its audio track. Source codec may be unusual — try converting to MP4 first with HandBrake.",
    );
  }

  // ─── Late-presign so the signed-URL token is fresh ───────────────
  onProgress({
    phase: "uploading",
    progress: 0,
    overallProgress: budget.uploadStart,
    message: "Reserving upload slot…",
  });
  const presign = await fetchJson<{ videoId: string; signedUrl: string }>(
    `${baseUrl}/api/presign-upload`,
    {
      method: "POST",
      headers: {
        "X-Site-Password": password,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filename: outName, contentType, sizeBytes: outSize }),
    },
  );

  if (ctx.canceled) throw new Error("canceled");

  // ─── PUT to signed URL with retry ────────────────────────────────
  const uploadSpan = budget.uploadEnd - budget.uploadStart;
  await streamedPutWithRetry(
    presign.signedUrl,
    outPath,
    outSize,
    contentType,
    (p, attempt) => {
      onProgress({
        phase: "uploading",
        progress: p,
        overallProgress: budget.uploadStart + p * uploadSpan,
        message:
          attempt > 1
            ? `Uploading… ${Math.round(p * 100)}% (retry ${attempt}/${UPLOAD_MAX_ATTEMPTS})`
            : `Uploading… ${Math.round(p * 100)}%`,
        attempt,
        maxAttempts: UPLOAD_MAX_ATTEMPTS,
      });
    },
    ctx,
  );

  if (ctx.canceled) throw new Error("canceled");
  return { videoId: presign.videoId };
}

/**
 * Multi-part orchestrator. Stream-copies the source into N segments, then
 * runs the per-file compress/upload on each. After all parts have uploaded,
 * fires a single /api/finalize-upload call with childIds linking parts 2..N
 * to part 1 (the parent). The worker then sees the parent and gathers all
 * siblings as one logical job.
 */
async function compressAndUploadParts(
  initialInfo: ProbeResult,
  baseUrl: string,
  password: string,
  onProgress: ProgressSink,
  ctx: RunContext,
): Promise<{ videoId: string; resultUrl: string }> {
  const plan = initialInfo.partPlan!;
  const N = plan.totalParts;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tra-uploader-parts-"));

  onProgress({
    phase: "probing",
    progress: 1,
    overallProgress: 0.02,
    mode: "audio-only",
    message: `${humanDuration(initialInfo.durationSeconds)} source · splitting into ${N} parts`,
  });

  try {
    // Each part gets an equal slice of the [0.05, 0.97] progress range
    // (post-probe to pre-finalize). Split that equally across parts, with
    // ~10% of the per-part budget for the stream-copy split itself.
    const partsTotalSpan = 0.92; // 0.97 - 0.05
    const partSpan = partsTotalSpan / N;

    const childIds: string[] = [];
    let parentVideoId = "";

    for (let i = 0; i < N; i++) {
      if (ctx.canceled) throw new Error("canceled");
      const partNumber = i + 1;
      const partBase = 0.05 + i * partSpan;
      const partStartSec = i * plan.segmentSeconds;
      const partDurSec = Math.min(plan.segmentSeconds, initialInfo.durationSeconds - partStartSec);

      // ─── Stream-copy split (fast — seconds even for huge files) ─
      onProgress({
        phase: "compressing",
        progress: 0,
        overallProgress: partBase,
        message: `Part ${partNumber} of ${N}: extracting segment…`,
      });
      const splitPath = path.join(tmpDir, `part-${partNumber}.mkv`);
      await runStreamCopySplit(initialInfo.filepath, partStartSec, partDurSec, splitPath, ctx);
      if (ctx.canceled) throw new Error("canceled");

      // Probe the split segment to get its true duration + audio/video flags.
      const splitMeta = await runFfprobeMeta(splitPath);
      if (!splitMeta.durationSeconds || splitMeta.durationSeconds <= 0) {
        throw new Error(`Part ${partNumber} extraction produced an unreadable file.`);
      }
      const segDur = splitMeta.durationSeconds;
      const audioKbps = pickAudioBitrate(segDur) ?? AUDIO_BITRATE_LADDER_KBPS[0]!;
      const totalBudgetBits = TARGET_BYTES * 8;
      const audioBudgetBits = audioKbps * 1000 * segDur;
      const videoBudgetBits = totalBudgetBits - audioBudgetBits;
      const videoKbps = Math.max(0, Math.floor(videoBudgetBits / segDur / 1000));
      const audioOnly = videoKbps < MIN_VIDEO_BITRATE_KBPS;
      const segMode: "video" | "audio-only" = !splitMeta.hasVideo
        ? "audio-only"
        : audioOnly
          ? "audio-only"
          : "video";
      const segInfo: ProbeResult = {
        filename: `${path.basename(initialInfo.filename, path.extname(initialInfo.filename))}-part${partNumber}of${N}${path.extname(splitPath)}`,
        filepath: splitPath,
        sizeBytes: fs.statSync(splitPath).size,
        durationSeconds: segDur,
        mode: segMode,
        audioKbps,
        videoKbps: segMode === "video" ? videoKbps : undefined,
        hasAudio: splitMeta.hasAudio,
        targetSizeBytes: TARGET_BYTES,
        estimatedSeconds: Math.max(5, Math.ceil(segDur / (segMode === "audio-only" ? 4 : 3))),
      };

      // Map the per-part progress into the global budget. Reserve the first
      // 10% of the part's span for the split (already done), 70% for compress,
      // 20% for upload.
      const compressStart = partBase + partSpan * 0.1;
      const compressEnd = partBase + partSpan * 0.8;
      const uploadStart = partBase + partSpan * 0.8;
      const uploadEnd = partBase + partSpan;

      const partTmpDir = fs.mkdtempSync(path.join(tmpDir, `compress-${partNumber}-`));
      // Wrap the inner emitter so the user sees "Part 2 of 3 · compressing…" labels.
      const innerProgress: ProgressSink = (p) => {
        const labelPrefix = `Part ${partNumber} of ${N}: `;
        onProgress({
          ...p,
          message: p.message ? labelPrefix + p.message : labelPrefix,
        });
      };
      const { videoId } = await compressAndUploadOne(
        segInfo,
        partTmpDir,
        baseUrl,
        password,
        innerProgress,
        ctx,
        { compressStart, compressEnd, uploadStart, uploadEnd },
      );

      if (i === 0) {
        parentVideoId = videoId;
      } else {
        childIds.push(videoId);
      }

      // Free the split file as soon as we're done uploading it.
      try {
        fs.unlinkSync(splitPath);
      } catch {
        /* ignore */
      }
    }

    if (ctx.canceled) throw new Error("canceled");

    // ─── Finalize (single call, links children to parent) ───────────
    onProgress({
      phase: "finalizing",
      progress: 0,
      overallProgress: 0.97,
      message: `Queuing ${N}-part upload for processing…`,
    });
    await fetchJson(`${baseUrl}/api/finalize-upload`, {
      method: "POST",
      headers: {
        "X-Site-Password": password,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ videoId: parentVideoId, childIds }),
    });

    const resultUrl = `${baseUrl}/video/${parentVideoId}`;
    onProgress({ phase: "done", progress: 1, overallProgress: 1, message: `Done · ${N} parts` });
    return { videoId: parentVideoId, resultUrl };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Stream-copy a slice of the source: fast, lossless, no re-encoding.
 * Output container is .mkv because Matroska tolerates arbitrary stream
 * cuts (mid-GOP) better than MP4 — the next compress pass will re-encode
 * anyway, so container choice doesn't matter for downstream quality.
 */
function runStreamCopySplit(
  inputPath: string,
  startSec: number,
  durSec: number,
  outPath: string,
  ctx: RunContext,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-nostats",
      "-loglevel",
      "error",
      "-analyzeduration",
      "100M",
      "-probesize",
      "100M",
      "-y",
      "-ss",
      String(startSec),
      "-i",
      inputPath,
      "-t",
      String(durSec),
      "-c",
      "copy",
      "-map",
      "0:v:0?",
      "-map",
      "0:a:0?",
      outPath,
    ];
    const proc = spawn(FFMPEG, args);
    ctx.ffmpegProc = proc;
    let errBuf = "";
    proc.stderr.on("data", (d: Buffer) => {
      errBuf += d.toString();
      if (errBuf.length > 50_000) errBuf = errBuf.slice(-10_000);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      ctx.ffmpegProc = null;
      if (ctx.canceled) return reject(new Error("canceled"));
      if (code === 0) return resolve();
      reject(mapFfmpegError(code ?? -1, errBuf));
    });
  });
}

/**
 * Run the compress and verify the output size. If it overshoots the cap,
 * step the audio-bitrate ladder down one rung and try once more.
 */
async function compressWithFit(
  initialInfo: ProbeResult,
  tmpDir: string,
  onProgress: ProgressSink,
  ctx: RunContext,
): Promise<{ outPath: string; info: ProbeResult }> {
  let info = initialInfo;
  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const outExt = info.mode === "audio-only" ? ".m4a" : ".mp4";
    const baseName =
      path.basename(info.filename, path.extname(info.filename)) +
      "-compressed" +
      outExt;
    const outPath = path.join(tmpDir, attempt === 1 ? baseName : `retry-${attempt}-${baseName}`);

    const passLabel = MAX_ATTEMPTS > 1 && attempt > 1 ? ` · pass ${attempt}/${MAX_ATTEMPTS}` : "";
    await runCompress(
      info,
      outPath,
      (p, etaSeconds) => {
        onProgress({
          phase: "compressing",
          progress: p,
          overallProgress: 0.05 + p * 0.75,
          mode: info.mode,
          etaSeconds,
          message: `${Math.round(p * 100)}% · ${info.mode === "audio-only" ? `audio @ ${info.audioKbps} kbps` : "video"}${passLabel}`,
        });
      },
      ctx,
    );

    if (ctx.canceled) throw new Error("canceled");
    const size = fs.statSync(outPath).size;
    if (size <= UPLOAD_CAP_BYTES) return { outPath, info };

    // Oversize. If we still have a lower rung on the ladder, retry there.
    const currentIdx = AUDIO_BITRATE_LADDER_KBPS.indexOf(
      info.audioKbps as (typeof AUDIO_BITRATE_LADDER_KBPS)[number],
    );
    const next = AUDIO_BITRATE_LADDER_KBPS[currentIdx + 1];
    if (currentIdx === -1 || next == null || attempt === MAX_ATTEMPTS) {
      throw new Error(
        `Compressed file is ${(size / 1024 / 1024).toFixed(1)} MB — still above the 50 MB upload cap even at the lowest bitrate. Try trimming the source.`,
      );
    }
    onProgress({
      phase: "compressing",
      progress: 0,
      overallProgress: 0.05,
      message: `Output overshot — retrying pass 2/2 at ${next} kbps audio`,
    });
    info = { ...info, mode: "audio-only", audioKbps: next, videoKbps: undefined };
    try {
      fs.unlinkSync(outPath);
    } catch {
      /* ignore */
    }
  }
  // Unreachable: the loop always returns or throws.
  throw new Error("compressWithFit: unreachable");
}

function runCompress(
  info: ProbeResult,
  outPath: string,
  onProgress: (pct: number, etaSeconds: number | null) => void,
  ctx: RunContext,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const audioOnly = info.mode === "audio-only";
    const audioKbps = info.audioKbps;
    const videoKbps = info.videoKbps ?? Math.max(
      MIN_VIDEO_BITRATE_KBPS,
      Math.floor(
        (TARGET_BYTES * 8 - audioKbps * 1000 * info.durationSeconds) /
          info.durationSeconds /
          1000,
      ),
    );

    // Common args. -analyzeduration / -probesize for tricky containers.
    const inputArgs = [
      "-hide_banner", "-nostats", "-loglevel", "info",
      "-analyzeduration", "100M",
      "-probesize", "100M",
      "-y",
      "-i", info.filepath,
    ];

    // Map streams optionally — `?` makes the stream optional so we don't
    // crash on a video that has no audio (or vice versa).
    const audioMap = info.hasAudio ? ["-map", "0:a:0?"] : [];

    const args = audioOnly
      ? [
          ...inputArgs,
          "-vn",
          ...(info.hasAudio ? ["-map", "0:a:0?"] : []),
          "-c:a", "aac", "-b:a", `${audioKbps}k`, "-ac", "1",
          "-movflags", "+faststart",
          "-progress", "pipe:2",
          outPath,
        ]
      : [
          ...inputArgs,
          "-map", "0:v:0?",
          ...audioMap,
          "-c:v", "libx264", "-preset", "ultrafast",
          "-b:v", `${videoKbps}k`,
          "-maxrate", `${videoKbps}k`,
          "-bufsize", `${videoKbps * 2}k`,
          "-vf", `scale='min(${VIDEO_MAX_WIDTH},iw)':'-2'`,
          ...(info.hasAudio
            ? ["-c:a", "aac", "-b:a", `${audioKbps}k`, "-ac", "1"]
            : []),
          "-movflags", "+faststart",
          "-progress", "pipe:2",
          outPath,
        ];

    if (audioOnly && !info.hasAudio) {
      return reject(
        new Error(
          "This file has no audio track. Transcription needs audio — try a different recording.",
        ),
      );
    }

    const proc = spawn(FFMPEG, args);
    ctx.ffmpegProc = proc;
    const startedAt = Date.now();
    let errBuf = "";

    proc.stderr.on("data", (d: Buffer) => {
      const chunk = d.toString();
      errBuf += chunk;
      if (errBuf.length > 100_000) errBuf = errBuf.slice(-20_000);
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
      reject(mapFfmpegError(code ?? -1, errBuf));
    });
  });
}

/**
 * Translate an ffmpeg failure into a user-friendly Error. Falls back to the
 * raw stderr tail for unrecognized cases.
 */
function mapFfmpegError(code: number, stderr: string): Error {
  const lower = stderr.toLowerCase();
  if (lower.includes("invalid data found") || lower.includes("invalid argument")) {
    return new Error(
      "This file looks corrupted or in an unsupported format. Try playing it in VLC first to confirm it works.",
    );
  }
  if (lower.includes("no such file") || lower.includes("could not open file")) {
    return new Error(
      "Couldn't read the file. It may have been moved, deleted, or be locked by another program.",
    );
  }
  if (lower.includes("permission denied")) {
    return new Error(
      "We don't have permission to read this file. Check it's not in a protected folder or open elsewhere.",
    );
  }
  if (lower.includes("unknown decoder") || lower.includes("decoder not found")) {
    return new Error(
      "This file uses a codec ffmpeg doesn't recognize. Try converting to MP4 first with HandBrake (free).",
    );
  }
  if (lower.includes("no audio") || lower.includes("output file does not contain any stream")) {
    return new Error(
      "Couldn't find a usable audio or video stream in this file.",
    );
  }
  return new Error(`ffmpeg exited ${code}: ${stderr.slice(-400).trim()}`);
}

async function streamedPutWithRetry(
  url: string,
  filepath: string,
  totalSize: number,
  contentType: string,
  onProgress: (pct: number, attempt: number) => void,
  ctx: RunContext,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt++) {
    if (ctx.canceled) throw new Error("canceled");
    try {
      await streamedPut(
        url,
        filepath,
        totalSize,
        contentType,
        (p) => onProgress(p, attempt),
        ctx.abortController.signal,
      );
      return;
    } catch (err) {
      lastErr = err;
      if (ctx.canceled) throw err;
      const retriable = isRetriableUploadError(err);
      if (!retriable || attempt === UPLOAD_MAX_ATTEMPTS) throw err;
      const delay = UPLOAD_RETRY_DELAYS_MS[attempt - 1] ?? 16_000;
      await sleep(delay, ctx.abortController.signal);
    }
  }
  throw lastErr ?? new Error("Upload failed after retries");
}

function isRetriableUploadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  // Network-level errors fetch surfaces as Error with these codes/strings.
  if (/ETIMEDOUT|ECONNRESET|EPIPE|ENETUNREACH|EAI_AGAIN|fetch failed|socket hang up/i.test(msg)) {
    return true;
  }
  // 5xx and 408 from Supabase: retry. 4xx (other than 408): bail — token's bad.
  const statusMatch = msg.match(/Upload failed (\d+)/);
  if (statusMatch && statusMatch[1]) {
    const status = Number(statusMatch[1]);
    return status === 408 || (status >= 500 && status < 600);
  }
  return false;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("canceled"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("canceled"));
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
  try {
    ctx.abortController.abort();
  } catch {
    /* ignore */
  }
  if (ctx.ffmpegProc && !ctx.ffmpegProc.killed) {
    try {
      ctx.ffmpegProc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      if (ctx.ffmpegProc && !ctx.ffmpegProc.killed) {
        try {
          ctx.ffmpegProc.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
    }, 2000);
  }
}
