import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { env, envOptional } from "./lib/env.js";
import { log } from "./lib/log.js";
import { sendFailureAlert } from "./lib/alert.js";
import { probeDurationSeconds } from "./lib/ffmpeg.js";
import { downloadVideo } from "./pipeline/download.js";
import { extractAudio, chunkAudio } from "./pipeline/extractAudio.js";
import { extractFrames } from "./pipeline/extractFrames.js";
import { transcribeAll, assertAudioHasContent } from "./pipeline/transcribe.js";
import { analyzeFull } from "./pipeline/analyzeGemini.js";
import { embedTranscript } from "./pipeline/embed.js";
import { pickThumbnailDataUrl } from "./pipeline/thumbnail.js";
import {
  preparePartFiles,
  offsetAudioChunks,
  offsetFrames,
} from "./pipeline/parts.js";
import {
  setStatus,
  setDuration,
  saveTranscript,
  saveAnalysis,
  saveThumbnailUrl,
  saveLanguage,
  savePreviewPath,
  saveTranscribeBackend,
  setProgress,
  getVideo,
  getVideoParts,
  markFailed,
  markChildrenDone,
} from "./pipeline/persist.js";
import { cleanupWorkDir } from "./pipeline/cleanup.js";

async function main(): Promise<void> {
  const videoId = env("VIDEO_ID");
  log.info("worker starting", { videoId });

  const row = await getVideo(videoId);
  if (!row) throw new Error(`Video ${videoId} not found`);

  // Children of a multi-part upload should never be dispatched directly.
  // If we ever do (manual rerun, schema confusion), fail loudly so we
  // don't accidentally process a part as if it were a standalone.
  if (row.parent_video_id) {
    throw new Error(
      `Video ${videoId} is part ${row.part_index} of a multi-part upload — its parent should be processed instead.`,
    );
  }

  const isMultiPart = (row.total_parts ?? 0) > 1;
  const workDir = await mkdtemp(path.join(tmpdir(), `va-${videoId}-`));

  try {
    await setStatus(videoId, "transcribing");
    await savePreviewPath(videoId, row.storage_path);

    let combinedAudioChunks: Awaited<ReturnType<typeof chunkAudio>> = [];
    let combinedFrames: Awaited<ReturnType<typeof extractFrames>> = [];
    let combinedDuration = 0;

    if (isMultiPart) {
      // Multi-part path: download every part, extract audio + frames per
      // part, then merge into a single timeline with offsets so the
      // transcribe and analyze passes see the whole logical video.
      const parts = await getVideoParts(videoId);
      log.info("multi-part run", { videoId, partCount: parts.length });
      if (parts.length < (row.total_parts ?? parts.length)) {
        throw new Error(
          `Expected ${row.total_parts} parts but found ${parts.length}. The upload may have been interrupted; please re-upload.`,
        );
      }

      const prepared = await preparePartFiles(
        parts,
        workDir,
        framesIntervalSeconds,
        async (partIndex, total, label) => {
          await setProgress(videoId, {
            phase: "transcribing",
            chunk_index: partIndex,
            total_chunks: total,
            message: label,
          });
        },
      );

      // Validate every part has audio.
      for (const p of prepared) {
        await assertAudioHasContent(p.audioPath);
      }

      // Merge per-part outputs into a single timeline.
      for (const p of prepared) {
        combinedAudioChunks.push(...offsetAudioChunks(p.audioChunks, p.startOffsetSeconds));
        combinedFrames.push(...offsetFrames(p.frames, p.startOffsetSeconds));
        combinedDuration += p.durationSeconds;
      }
      await setDuration(videoId, combinedDuration);
      log.info("merged parts", {
        chunks: combinedAudioChunks.length,
        frames: combinedFrames.length,
        durationSeconds: combinedDuration,
      });

      // Best-effort thumbnail from the first part's frames (skip if audio-only).
      if (prepared[0]?.frames.length) {
        pickThumbnailDataUrl(prepared[0].frames)
          .then((url) => (url ? saveThumbnailUrl(videoId, url) : null))
          .catch((err) =>
            log.warn("thumbnail step failed (continuing)", {
              error: err instanceof Error ? err.message : String(err),
            }),
          );
      }
    } else {
      // Single-file path (unchanged).
      const videoPath = await downloadVideo(row.storage_path, workDir);

      const duration = (await probeDurationSeconds(videoPath)) ?? 0;
      if (duration <= 0) {
        throw new Error(
          "Uploaded file isn't a readable video or audio file. Please re-upload using the desktop installer or a different source.",
        );
      }
      await setDuration(videoId, duration);
      log.info("duration probed", { duration });

      const [audioPath, frames] = await Promise.all([
        extractAudio(videoPath, workDir),
        extractFrames(videoPath, workDir, framesIntervalSeconds(duration)),
      ]);

      await assertAudioHasContent(audioPath);

      if (frames.length > 0) {
        pickThumbnailDataUrl(frames)
          .then((url) => (url ? saveThumbnailUrl(videoId, url) : null))
          .catch((err) =>
            log.warn("thumbnail step failed (continuing)", {
              error: err instanceof Error ? err.message : String(err),
            }),
          );
      }

      combinedAudioChunks = await chunkAudio(audioPath, duration, workDir);
      combinedFrames = frames;
      combinedDuration = duration;
    }

    // Transcribe over the (merged) timeline.
    const { segments, language, coverageRatio, backend } = await transcribeAll(
      combinedAudioChunks,
      combinedDuration,
      (i, total) =>
        setProgress(videoId, {
          phase: "transcribing",
          chunk_index: i,
          total_chunks: total,
          message: `Transcribing chunk ${i}/${total}`,
        }),
    );
    await saveTranscript(videoId, segments);
    if (language) await saveLanguage(videoId, language);
    await saveTranscribeBackend(videoId, backend);
    log.info("transcript saved", {
      segmentCount: segments.length,
      language,
      coverageRatio: Number(coverageRatio.toFixed(3)),
      backend,
      parts: isMultiPart ? row.total_parts : 1,
    });

    // 5. Analyze with Gemini Flash (map-reduce).
    // Partial-save behavior: if analysis fails after the transcript is saved,
    // we still complete the video with a placeholder title so the user keeps
    // the transcript. A retry can re-run analysis later.
    await setStatus(videoId, "analyzing");
    try {
      const analysis = await analyzeFull(segments, combinedFrames, (i, total) =>
        setProgress(videoId, {
          phase: "analyzing",
          chunk_index: i,
          total_chunks: total,
          message: `Analyzing chunk ${i}/${total}`,
        }),
      );
      await saveAnalysis(videoId, analysis);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn("analysis failed — keeping transcript, marking partial", { error: message });
      await saveAnalysis(videoId, {
        title: "Transcript only (analysis unavailable)",
        chapters: [],
        highlights: [],
        entities: [],
        keywords: [],
        key_quotes: [],
      });
      // Surface the analysis error non-fatally so the user can Retry.
      await markFailed(videoId, `analysis: ${message}`).catch(() => {});
      await sendFailureAlert({
        videoId,
        phase: "analyzing",
        error: message,
        ghaRunUrl: buildGhaUrl(),
      }).catch(() => {});
      return; // Skip embeddings; user can retry.
    }

    // 6. Build semantic-search embeddings. Best-effort — search just won't
    // find this video if embedding fails, but analysis is still saved.
    await setProgress(videoId, { phase: "embedding", message: "Building search index" });
    try {
      const chunkCount = await embedTranscript(videoId, segments);
      log.info("embeddings saved", { videoId, chunkCount });
    } catch (err) {
      log.warn("embedding failed (continuing)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 7. Done. We intentionally DO NOT delete the upload — it's the preview.
    // Storage cleanup happens when the user clicks "Delete" on the dashboard.
    await setStatus(videoId, "done");
    if (isMultiPart) {
      // Mark all child parts done too so the reaper doesn't churn on them
      // and the dashboard can confirm the whole upload finished.
      await markChildrenDone(videoId).catch((err) =>
        log.warn("markChildrenDone failed (continuing)", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    log.info("worker done", { videoId, multiPart: isMultiPart });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("worker failed", { videoId, message });
    await markFailed(videoId, message).catch(() => {});
    await sendFailureAlert({
      videoId,
      phase: "worker",
      error: message,
      ghaRunUrl: buildGhaUrl(),
    }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await cleanupWorkDir(workDir);
  }
}

function buildGhaUrl(): string | undefined {
  const server = envOptional("GITHUB_SERVER_URL") ?? "https://github.com";
  const repo = envOptional("GITHUB_REPOSITORY");
  const runId = envOptional("GITHUB_RUN_ID");
  if (!repo || !runId) return undefined;
  return `${server}/${repo}/actions/runs/${runId}`;
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
