import path from "node:path";
import { mkdir } from "node:fs/promises";
import { downloadToFile } from "../lib/storage.js";
import { probeDurationSeconds } from "../lib/ffmpeg.js";
import { log } from "../lib/log.js";
import { extractAudio, chunkAudio, type AudioChunk } from "./extractAudio.js";
import { extractFrames, type SampledFrame } from "./extractFrames.js";

export interface PartFiles {
  /** Source video file on disk. */
  videoPath: string;
  /** Extracted audio file on disk. */
  audioPath: string;
  /** Audio chunked for transcription. */
  audioChunks: AudioChunk[];
  /** Sampled frames for analysis context. */
  frames: SampledFrame[];
  /** Probed duration in seconds. */
  durationSeconds: number;
  /** Cumulative offset (sum of prior parts' durations) so chunk + frame
   *  timestamps can be remapped onto the global timeline. */
  startOffsetSeconds: number;
  /** Part index (1..N) for logging / progress messages. */
  partIndex: number;
}

export interface PartInputs {
  id: string;
  storage_path: string;
  filename: string;
  part_index: number | null;
}

/**
 * Download + audio-extract + frame-sample for every part of a multi-part
 * upload, in order. Returns one PartFiles per part with cumulative timestamp
 * offsets ready for transcription/analysis to use as a global timeline.
 *
 * Each part is processed sequentially to keep peak disk usage low (one
 * source file × one extracted audio at a time) — important on the GHA
 * runner, which has limited disk.
 */
export async function preparePartFiles(
  parts: PartInputs[],
  workDir: string,
  framesIntervalSeconds: (durationSeconds: number) => number,
  onPartProgress?: (partIndex: number, totalParts: number, label: string) => Promise<void>,
): Promise<PartFiles[]> {
  const results: PartFiles[] = [];
  let cumulativeOffset = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const partIndex = part.part_index ?? i + 1;
    const partDir = path.join(workDir, `part-${partIndex}`);
    await mkdir(partDir, { recursive: true });

    if (onPartProgress) {
      await onPartProgress(partIndex, parts.length, `Downloading part ${partIndex}`);
    }
    log.info("downloading part", { partIndex, total: parts.length, storage_path: part.storage_path });
    const videoPath = path.join(partDir, "video.bin");
    await downloadToFile(part.storage_path, videoPath);

    const duration = (await probeDurationSeconds(videoPath)) ?? 0;
    if (duration <= 0) {
      throw new Error(
        `Part ${partIndex} (${part.filename}) has no readable duration. Re-upload the source.`,
      );
    }

    if (onPartProgress) {
      await onPartProgress(partIndex, parts.length, `Extracting audio for part ${partIndex}`);
    }
    const [audioPath, frames] = await Promise.all([
      extractAudio(videoPath, partDir),
      extractFrames(videoPath, partDir, framesIntervalSeconds(duration)),
    ]);

    const audioChunks = await chunkAudio(audioPath, duration, partDir);

    results.push({
      videoPath,
      audioPath,
      audioChunks,
      frames,
      durationSeconds: duration,
      startOffsetSeconds: cumulativeOffset,
      partIndex,
    });

    cumulativeOffset += duration;
  }

  return results;
}

/**
 * Apply the per-part time offset to a chunk's segments so they live on the
 * combined timeline. AudioChunks already track their own internal offset
 * within a part; for multi-part we add the part's startOffsetSeconds on top.
 */
export function offsetAudioChunks(chunks: AudioChunk[], offsetSeconds: number): AudioChunk[] {
  if (offsetSeconds === 0) return chunks;
  return chunks.map((c) => ({
    ...c,
    startOffsetSeconds: c.startOffsetSeconds + offsetSeconds,
  }));
}

/**
 * Apply the per-part time offset to frames so their timestamps live on the
 * combined timeline. Mirrors offsetAudioChunks.
 */
export function offsetFrames(frames: SampledFrame[], offsetSeconds: number): SampledFrame[] {
  if (offsetSeconds === 0) return frames;
  return frames.map((f) => ({
    ...f,
    timestampSeconds: f.timestampSeconds + offsetSeconds,
  }));
}
