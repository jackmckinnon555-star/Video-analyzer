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
  setStatus,
  setDuration,
  saveTranscript,
  saveAnalysis,
  saveThumbnailUrl,
  saveLanguage,
  savePreviewPath,
  setProgress,
  getVideo,
  markFailed,
} from "./pipeline/persist.js";
import { cleanupWorkDir } from "./pipeline/cleanup.js";

async function main(): Promise<void> {
  const videoId = env("VIDEO_ID");
  log.info("worker starting", { videoId });

  const row = await getVideo(videoId);
  if (!row) throw new Error(`Video ${videoId} not found`);

  const workDir = await mkdtemp(path.join(tmpdir(), `va-${videoId}-`));
  try {
    await setStatus(videoId, "transcribing");

    // The browser uploads files at <=50 MB directly; the desktop installer
    // compresses on the client so its output is also <=50 MB. Either way,
    // the uploaded file IS the playable preview — no server-side transcode
    // needed. Set the preview path up front so the UI can play back even
    // mid-processing.
    await savePreviewPath(videoId, row.storage_path);

    // 1. Download the uploaded video/audio from Supabase Storage.
    const videoPath = await downloadVideo(row.storage_path, workDir);

    // 2. Probe duration. Defense-in-depth guardrail: if the downloaded file
    // doesn't have a readable duration, it isn't a valid media file —
    // fail fast with a clear message before burning Groq quota.
    const duration = (await probeDurationSeconds(videoPath)) ?? 0;
    if (duration <= 0) {
      throw new Error(
        "Uploaded file isn't a readable video or audio file. Please re-upload using the desktop installer or a different source.",
      );
    }
    await setDuration(videoId, duration);
    log.info("duration probed", { duration });

    // 3. Extract audio + sampled frames in parallel.
    const [audioPath, frames] = await Promise.all([
      extractAudio(videoPath, workDir),
      extractFrames(videoPath, workDir, framesIntervalSeconds(duration)),
    ]);

    // Guard: if the file has no audio, transcription will never succeed —
    // fail fast with a clear message.
    await assertAudioHasContent(audioPath);

    // Best-effort thumbnail (audio-only files produce zero frames → skipped).
    if (frames.length > 0) {
      pickThumbnailDataUrl(frames)
        .then((url) => (url ? saveThumbnailUrl(videoId, url) : null))
        .catch((err) =>
          log.warn("thumbnail step failed (continuing)", {
            error: err instanceof Error ? err.message : String(err),
          }),
        );
    }

    // 4. Transcribe with per-chunk fallback (Groq → Cloudflare AI → local whisper).
    const audioChunks = await chunkAudio(audioPath, duration, workDir);
    const { segments, language, coverageRatio } = await transcribeAll(
      audioChunks,
      duration,
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
    log.info("transcript saved", {
      segmentCount: segments.length,
      language,
      coverageRatio: Number(coverageRatio.toFixed(3)),
    });

    // 5. Analyze with Gemini Flash (map-reduce).
    // Partial-save behavior: if analysis fails after the transcript is saved,
    // we still complete the video with a placeholder title so the user keeps
    // the transcript. A retry can re-run analysis later.
    await setStatus(videoId, "analyzing");
    try {
      const analysis = await analyzeFull(segments, frames, (i, total) =>
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
    log.info("worker done", { videoId });
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
