import { createReadStream } from "node:fs";
import Groq from "groq-sdk";
import { env } from "../lib/env.js";
import { retry } from "../lib/retry.js";
import type { TranscriptSegment } from "../../../shared/types/video.js";
import type { AudioChunk } from "./extractAudio.js";

let _groq: Groq | null = null;
function groq(): Groq {
  if (_groq) return _groq;
  _groq = new Groq({ apiKey: env("GROQ_API_KEY") });
  return _groq;
}

interface VerboseWord {
  word: string;
  start: number;
  end: number;
}

interface VerboseSegment {
  start: number;
  end: number;
  text: string;
}

interface VerboseResponse {
  segments?: VerboseSegment[];
  words?: VerboseWord[];
  language?: string;
  text?: string;
}

export interface ChunkResult {
  segments: TranscriptSegment[];
  language: string | null;
}

export async function transcribeChunkGroq(chunk: AudioChunk): Promise<ChunkResult> {
  return retry(() => transcribeOne(chunk), { label: "groq chunk", attempts: 3 });
}

async function transcribeOne(chunk: AudioChunk): Promise<ChunkResult> {
  const res = (await groq().audio.transcriptions.create({
    file: createReadStream(chunk.path),
    model: "whisper-large-v3",
    response_format: "verbose_json",
    timestamp_granularities: ["segment", "word"],
  })) as unknown as VerboseResponse;

  const segs = res.segments ?? [];
  const words = res.words ?? [];

  // Bucket words into their owning segment by start-time overlap.
  const wordsBySegment = bucketWords(words, segs);

  const adjusted: TranscriptSegment[] = segs.map((s, i) => ({
    start: s.start + chunk.startOffsetSeconds,
    end: s.end + chunk.startOffsetSeconds,
    text: s.text.trim(),
    words: wordsBySegment[i]?.map((w) => ({
      start: w.start + chunk.startOffsetSeconds,
      end: w.end + chunk.startOffsetSeconds,
      text: w.word,
    })),
  }));

  // Last-resort fallback: if Groq returned `text` but no segments, keep the chunk as one segment.
  if (adjusted.length === 0 && res.text) {
    adjusted.push({
      start: chunk.startOffsetSeconds,
      end: chunk.startOffsetSeconds + chunk.durationSeconds,
      text: res.text.trim(),
    });
  }

  return { segments: adjusted, language: res.language ?? null };
}

function bucketWords(words: VerboseWord[], segs: VerboseSegment[]): VerboseWord[][] {
  const buckets: VerboseWord[][] = segs.map(() => []);
  if (segs.length === 0) return buckets;
  let segIdx = 0;
  for (const w of words) {
    while (segIdx < segs.length - 1 && w.start >= segs[segIdx + 1]!.start) segIdx++;
    buckets[segIdx]!.push(w);
  }
  return buckets;
}
