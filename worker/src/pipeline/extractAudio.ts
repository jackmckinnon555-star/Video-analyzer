import path from "node:path";
import { stat } from "node:fs/promises";
import { runFfmpeg } from "../lib/ffmpeg.js";
import { log } from "../lib/log.js";

const MAX_CHUNK_BYTES = 24 * 1024 * 1024; // leave headroom under Groq's 25 MB cap

export interface AudioChunk {
  path: string;
  startOffsetSeconds: number;
  durationSeconds: number;
}

/** Extract a single compact Opus mono file suitable for ASR. */
export async function extractAudio(videoPath: string, workDir: string): Promise<string> {
  const out = path.join(workDir, "audio.opus");
  log.info("extracting audio", { videoPath, out });
  await runFfmpeg([
    "-y",
    "-i", videoPath,
    "-vn",
    "-c:a", "libopus",
    "-b:a", "32k",
    "-ac", "1",
    "-ar", "16000",
    out,
  ]);
  return out;
}

/**
 * Split audio into chunks under MAX_CHUNK_BYTES. We use fixed-duration cuts with
 * a small overlap instead of silence-based splitting to keep this dependency-free;
 * overlap + timestamp-merge on the transcript side covers boundary issues.
 */
export async function chunkAudio(
  audioPath: string,
  totalDurationSeconds: number,
  workDir: string,
): Promise<AudioChunk[]> {
  const size = (await stat(audioPath)).size;
  if (size <= MAX_CHUNK_BYTES) {
    return [{ path: audioPath, startOffsetSeconds: 0, durationSeconds: totalDurationSeconds }];
  }
  const chunkCount = Math.ceil(size / MAX_CHUNK_BYTES);
  const chunkSeconds = Math.ceil(totalDurationSeconds / chunkCount);
  const overlapSeconds = 2;
  const chunks: AudioChunk[] = [];

  for (let i = 0; i < chunkCount; i++) {
    const start = Math.max(0, i * chunkSeconds - (i === 0 ? 0 : overlapSeconds));
    const dur = Math.min(chunkSeconds + overlapSeconds, totalDurationSeconds - start);
    const out = path.join(workDir, `audio-${i.toString().padStart(3, "0")}.opus`);
    await runFfmpeg([
      "-y",
      "-ss", String(start),
      "-t", String(dur),
      "-i", audioPath,
      "-c:a", "copy",
      out,
    ]);
    chunks.push({ path: out, startOffsetSeconds: start, durationSeconds: dur });
  }
  log.info("audio chunked", { chunkCount: chunks.length });
  return chunks;
}
