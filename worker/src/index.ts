import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { env } from "./lib/env.js";
import { log } from "./lib/log.js";
import { probeDurationSeconds } from "./lib/ffmpeg.js";
import { downloadVideo } from "./pipeline/download.js";
import { extractAudio, chunkAudio } from "./pipeline/extractAudio.js";
import { extractFrames } from "./pipeline/extractFrames.js";
import { transcribeAll, assertAudioHasContent } from "./pipeline/transcribe.js";
import { analyzeFull } from "./pipeline/analyzeGemini.js";
import { pickThumbnailDataUrl } from "./pipeline/thumbnail.js";
import { buildPreview } from "./pipeline/preview.js";
import {
  setStatus,
  setDuration,
  saveTranscript,
  saveAnalysis,
  saveThumbnailUrl,
  saveLanguage,
  savePreviewPath,
  getVideo,
  markFailed,
} from "./pipeline/persist.js";
import { cleanupRawStorage, cleanupWorkDir } from "./pipeline/cleanup.js";

async function main(): Promise<void> {
  const videoId = env("VIDEO_ID");
  log.info("worker starting", { videoId });

  const row = await getVideo(videoId);
  if (!row) throw new Error(`Video ${videoId} not found`);

  const workDir = await mkdtemp(path.join(tmpdir(), `va-${videoId}-`));
  try {
    await setStatus(videoId, "transcribing");

    // 1. Download the raw video from Supabase Storage.
    const videoPath = await downloadVideo(row.storage_path, workDir);

    // 2. Probe duration (used for chunking & saved to the DB).
    const duration = (await probeDurationSeconds(videoPath)) ?? 0;
    if (duration > 0) await setDuration(videoId, duration);
    log.info("duration probed", { duration });

    // 3. Extract audio + sampled frames in parallel.
    const [audioPath, frames] = await Promise.all([
      extractAudio(videoPath, workDir),
      extractFrames(videoPath, workDir, framesIntervalSeconds(duration)),
    ]);

    // Fail clearly if the video had no real audio track.
    await assertAudioHasContent(audioPath);

    // Thumbnail and preview are best-effort background tasks that run in
    // parallel with transcription. A failure in either never blocks analysis.
    pickThumbnailDataUrl(frames)
      .then((url) => (url ? saveThumbnailUrl(videoId, url) : null))
      .catch((err) =>
        log.warn("thumbnail step failed (continuing)", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    const previewPromise = buildPreview(videoId, videoPath)
      .then((p) => savePreviewPath(videoId, p).then(() => p))
      .catch((err) => {
        log.warn("preview build failed (continuing)", {
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      });

    // 4. Chunk audio and transcribe every chunk with per-chunk fallback.
    const audioChunks = await chunkAudio(audioPath, duration, workDir);
    const { segments, language, coverageRatio } = await transcribeAll(audioChunks, duration);
    await saveTranscript(videoId, segments);
    if (language) await saveLanguage(videoId, language);
    log.info("transcript saved", {
      segmentCount: segments.length,
      language,
      coverageRatio: Number(coverageRatio.toFixed(3)),
    });

    // 5. Analyze with Gemini Flash (map-reduce).
    await setStatus(videoId, "analyzing");
    const analysis = await analyzeFull(segments, frames);
    await saveAnalysis(videoId, analysis);

    // 6. Make sure the preview transcode finished before we touch storage.
    await previewPromise;

    // 7. Done. Delete the raw to free storage quota (preview stays).
    await setStatus(videoId, "done");
    await cleanupRawStorage(row.storage_path);
    log.info("worker done", { videoId, title: analysis.title });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("worker failed", { videoId, message });
    await markFailed(videoId, message).catch(() => {});
    process.exitCode = 1;
  } finally {
    await cleanupWorkDir(workDir);
  }
}

function framesIntervalSeconds(duration: number): number {
  // Cap total frames to ~400 so we stay within Gemini inline-payload limits.
  if (duration <= 0) return 30;
  return Math.max(30, Math.ceil(duration / 400));
}

main().catch((err) => {
  console.error("Unhandled error in worker:", err);
  process.exit(1);
});
