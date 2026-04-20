import { readFile } from "node:fs/promises";
import { env } from "../lib/env.js";
import { retry } from "../lib/retry.js";
import type { TranscriptSegment } from "../../../shared/types/video.js";
import type { AudioChunk } from "./extractAudio.js";
import type { ChunkResult } from "./transcribeGroq.js";

/**
 * Cloudflare Workers AI transcription — @cf/openai/whisper.
 * Per-chunk entry point: matches the transcribeChunkGroq shape.
 *
 * Free-tier: 10,000 neurons/day recurring. Covers ~1-2 hours of audio/day
 * depending on load. Used as a middle rail between Groq and local whisper.
 */
export async function transcribeChunkCloudflare(chunk: AudioChunk): Promise<ChunkResult> {
  const accountId = env("CLOUDFLARE_ACCOUNT_ID");
  const token = env("CLOUDFLARE_WORKERS_AI_TOKEN");
  return retry(
    () => transcribeOne(chunk, accountId, token),
    { label: "cf whisper chunk", attempts: 3 },
  );
}

interface CfWhisperResponse {
  success?: boolean;
  result?: {
    text?: string;
    vtt?: string;
    language?: string;
    word_count?: number;
    words?: Array<{ word: string; start: number; end: number }>;
  };
  errors?: Array<{ message: string }>;
}

async function transcribeOne(
  chunk: AudioChunk,
  accountId: string,
  token: string,
): Promise<ChunkResult> {
  const audio = await readFile(chunk.path);
  // `@cf/openai/whisper` expects JSON body with `audio: number[]` (byte array).
  // Raw octet-stream bodies are accepted by some Workers AI models but not
  // reliably this one; JSON is the documented path.
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/openai/whisper`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ audio: Array.from(audio) }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Cloudflare Whisper ${res.status}: ${text.slice(0, 300)}`);
  }
  const body = (await res.json()) as CfWhisperResponse;
  if (!body.success || !body.result) {
    throw new Error(`Cloudflare Whisper failed: ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
  }

  const language = body.result.language ?? null;
  let segments: TranscriptSegment[];
  if (body.result.words && body.result.words.length > 0) {
    segments = groupWordsIntoSegments(body.result.words, chunk.startOffsetSeconds);
  } else if (body.result.vtt) {
    segments = parseVtt(body.result.vtt, chunk.startOffsetSeconds);
  } else if (body.result.text) {
    segments = [{
      start: chunk.startOffsetSeconds,
      end: chunk.startOffsetSeconds + chunk.durationSeconds,
      text: body.result.text.trim(),
    }];
  } else {
    segments = [];
  }
  return { segments, language };
}

function groupWordsIntoSegments(
  words: Array<{ word: string; start: number; end: number }>,
  offset: number,
): TranscriptSegment[] {
  const segs: TranscriptSegment[] = [];
  const targetDuration = 6;
  let buf: typeof words = [];
  let bufStart = words[0]?.start ?? 0;

  for (const w of words) {
    if (buf.length === 0) bufStart = w.start;
    buf.push(w);
    if (w.end - bufStart >= targetDuration) {
      segs.push({
        start: bufStart + offset,
        end: w.end + offset,
        text: buf.map((x) => x.word).join(" ").trim(),
        words: buf.map((x) => ({
          start: x.start + offset,
          end: x.end + offset,
          text: x.word,
        })),
      });
      buf = [];
    }
  }
  if (buf.length > 0) {
    const last = buf[buf.length - 1]!;
    segs.push({
      start: bufStart + offset,
      end: last.end + offset,
      text: buf.map((x) => x.word).join(" ").trim(),
      words: buf.map((x) => ({
        start: x.start + offset,
        end: x.end + offset,
        text: x.word,
      })),
    });
  }
  return segs;
}

function parseVtt(vtt: string, offset: number): TranscriptSegment[] {
  const segs: TranscriptSegment[] = [];
  const lines = vtt.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const m = lines[i]?.match(
      /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})/,
    );
    if (m) {
      const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = m;
      const start = +h1! * 3600 + +m1! * 60 + +s1! + +ms1! / 1000;
      const end = +h2! * 3600 + +m2! * 60 + +s2! + +ms2! / 1000;
      i++;
      const textLines: string[] = [];
      while (i < lines.length && lines[i] && lines[i]!.trim() !== "") {
        textLines.push(lines[i]!);
        i++;
      }
      segs.push({
        start: start + offset,
        end: end + offset,
        text: textLines.join(" ").trim(),
      });
    }
    i++;
  }
  return segs;
}
