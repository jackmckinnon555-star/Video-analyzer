import {
  ChunkAnalysisSchema,
  GlobalAnalysisSchema,
  geminiChunkResponseSchema,
  geminiGlobalResponseSchema,
  type ChunkAnalysis,
  type GlobalAnalysis,
} from "../../../shared/schemas/geminiOutput.js";
import { gemini, geminiModel } from "../lib/gemini.js";
import { retry } from "../lib/retry.js";
import { log } from "../lib/log.js";
import type { TranscriptSegment } from "../../../shared/types/video.js";
import type { SampledFrame } from "./extractFrames.js";

// Semantic chunks: target ~25 min of transcript each. Splitting on long
// inter-segment gaps beats fixed-time cuts — avoids slicing mid-topic.
const TARGET_CHUNK_SECONDS = 25 * 60;
const GAP_BIAS_SECONDS = 2.0;

interface TranscriptChunk {
  startSeconds: number;
  endSeconds: number;
  segments: TranscriptSegment[];
}

export async function analyzeFull(
  transcript: TranscriptSegment[],
  frames: SampledFrame[],
  onProgress?: (chunkIndex: number, totalChunks: number) => Promise<void>,
): Promise<GlobalAnalysis> {
  // Guard: empty transcript = no content to analyze. Emit a minimal valid
  // shape so the video row still transitions to 'done' with a clear message.
  if (transcript.length === 0) {
    log.warn("analysis: empty transcript — emitting placeholder result");
    return {
      title: "Untitled (no speech detected)",
      chapters: [],
      highlights: [],
      entities: [],
      keywords: [],
      key_quotes: [],
    };
  }

  const chunks = splitTranscript(transcript);
  log.info("analysis: map phase", { chunkCount: chunks.length });

  const mapResults: ChunkAnalysis[] = [];
  for (const [i, chunk] of chunks.entries()) {
    if (onProgress) await onProgress(i + 1, chunks.length);
    const chunkFrames = frames.filter(
      (f) => f.timestampSeconds >= chunk.startSeconds && f.timestampSeconds <= chunk.endSeconds,
    );
    log.info("analysis: mapping chunk", {
      i: i + 1,
      of: chunks.length,
      startSeconds: chunk.startSeconds,
      endSeconds: chunk.endSeconds,
      frameCount: chunkFrames.length,
    });
    const result = await retry(
      () => mapChunk(chunk, chunkFrames),
      { label: `gemini map ${i}`, attempts: 3, baseMs: 4000 },
    );
    mapResults.push(result);
  }

  // Single-chunk shortcut: skip the reduce call (it's redundant), upgrade the
  // map result directly. Saves one Gemini request for short videos.
  if (mapResults.length === 1) {
    const only = mapResults[0]!;
    log.info("analysis: single-chunk shortcut — promoting map result");
    return {
      title: only.chapter_candidates[0]?.title ?? only.chunk_summary.slice(0, 80),
      chapters: only.chapter_candidates.slice(0, 12),
      highlights: only.highlight_candidates.slice(0, 10),
      entities: only.entities,
      keywords: only.keywords.slice(0, 30),
      key_quotes: only.key_quotes.slice(0, 15),
    };
  }

  log.info("analysis: reduce phase");
  return retry(() => reduceGlobal(mapResults), {
    label: "gemini reduce",
    attempts: 3,
    baseMs: 4000,
  });
}

function splitTranscript(segs: TranscriptSegment[]): TranscriptChunk[] {
  if (segs.length === 0) return [];
  const chunks: TranscriptChunk[] = [];
  let buf: TranscriptSegment[] = [];
  let bufStart = segs[0]!.start;

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    buf.push(seg);
    const durationSoFar = seg.end - bufStart;
    const nextSeg = segs[i + 1];
    const gapToNext = nextSeg ? nextSeg.start - seg.end : 0;

    const shouldSplit =
      durationSoFar >= TARGET_CHUNK_SECONDS &&
      (gapToNext >= GAP_BIAS_SECONDS || durationSoFar >= TARGET_CHUNK_SECONDS * 1.3);

    if (shouldSplit || !nextSeg) {
      chunks.push({ startSeconds: bufStart, endSeconds: seg.end, segments: buf });
      buf = [];
      if (nextSeg) bufStart = nextSeg.start;
    }
  }
  return chunks;
}

async function mapChunk(chunk: TranscriptChunk, frames: SampledFrame[]): Promise<ChunkAnalysis> {
  const transcriptText = chunk.segments
    .map((s) => `[${formatTs(s.start)}]${s.speaker ? ` ${s.speaker}:` : ""} ${s.text}`)
    .join("\n");

  const imageParts = frames.flatMap((f) => [
    { text: `Frame at ${formatTs(f.timestampSeconds)}` },
    { inlineData: { mimeType: "image/jpeg", data: f.base64 } },
  ]);

  const prompt = `You analyze a ~${Math.round(
    (chunk.endSeconds - chunk.startSeconds) / 60,
  )}-minute section of a longer video (section starts at ${formatTs(
    chunk.startSeconds,
  )}, ends at ${formatTs(chunk.endSeconds)}).

Return structured JSON with:
- chunk_summary: 2-4 sentence summary of what this section covers
- chapter_candidates: natural chapter breakpoints within this section, 0-5 of them, each with start_seconds, title, summary
- highlight_candidates: memorable/quotable/pivotal moments, 0-5 of them
- keywords: 5-10 keywords/topics specific to this section
- key_quotes: 0-5 direct quotes with timestamps
- entities: named people, orgs, places, products mentioned (with mention counts within this section)
- energy_score: 0-10 subjective energy/engagement level of this section

All timestamps must be absolute seconds into the full video (the transcript already uses absolute times).`;

  const response = await gemini().models.generateContent({
    model: geminiModel(),
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          { text: `Transcript:\n${transcriptText}` },
          ...imageParts,
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: geminiChunkResponseSchema as unknown as object,
      temperature: 0.3,
    },
  });

  const text = response.text ?? "";
  return ChunkAnalysisSchema.parse(JSON.parse(text));
}

async function reduceGlobal(chunks: ChunkAnalysis[]): Promise<GlobalAnalysis> {
  const digest = chunks
    .map(
      (c, i) => `### Section ${i + 1}
Summary: ${c.chunk_summary}
Energy: ${c.energy_score}/10
Chapter candidates: ${JSON.stringify(c.chapter_candidates)}
Highlight candidates: ${JSON.stringify(c.highlight_candidates)}
Keywords: ${c.keywords.join(", ")}
Key quotes: ${JSON.stringify(c.key_quotes)}
Entities: ${JSON.stringify(c.entities)}`,
    )
    .join("\n\n");

  const prompt = `You are producing the final metadata for a long-form video. You are given section-level analyses (map phase) — consolidate them into a single coherent global view (reduce phase).

Return structured JSON with:
- title: a sharp, specific title for the whole video (no clickbait, no colons if avoidable). Reflect the full arc, not just section 1.
- chapters: de-duplicated and merged chapter list, at most 12, spanning the video from start to end, each with start_seconds/title/summary
- highlights: the 5-10 strongest notable-moment highlights across the whole video
- entities: consolidated named entities (sum mentions across sections)
- keywords: up to 30 deduplicated global keywords
- key_quotes: up to 15 strongest direct quotes with timestamps

Prefer chapter boundaries that reflect real topic shifts over evenly-spaced ones.`;

  const response = await gemini().models.generateContent({
    model: geminiModel(),
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }, { text: digest }],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: geminiGlobalResponseSchema as unknown as object,
      temperature: 0.3,
    },
  });

  const text = response.text ?? "";
  return GlobalAnalysisSchema.parse(JSON.parse(text));
}

function formatTs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
