import { gemini, geminiEmbeddingModel } from "../lib/gemini.js";
import { sb } from "../lib/supabase.js";
import { retry } from "../lib/retry.js";
import { log } from "../lib/log.js";
import type { TranscriptSegment } from "../../../shared/types/video.js";

// Target chunk size for semantic search. Too small = lots of rows, tiny context;
// too large = less precise match. ~500 words / ~2500 chars is a sweet spot.
const TARGET_CHUNK_CHARS = 2500;
const MIN_CHUNK_CHARS = 400;
const BATCH_SIZE = 16; // Embeddings API supports batching; stay well under rate limits.

interface Chunk {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

/**
 * Build semantic passages from the transcript and embed each via Gemini.
 * Writes rows into public.video_chunks. Best-effort: if embedding fails,
 * log and move on — the core transcript/analysis is already saved.
 */
export async function embedTranscript(
  videoId: string,
  transcript: TranscriptSegment[],
): Promise<number> {
  if (transcript.length === 0) return 0;
  const chunks = segmentIntoChunks(transcript);
  log.info("embedding: chunks built", { count: chunks.length, videoId });

  // Wipe any prior rows for this video (handles retries cleanly).
  await sb().from("video_chunks").delete().eq("video_id", videoId);

  let inserted = 0;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    try {
      const embeddings = await retry(
        () => embedBatch(batch.map((c) => c.text)),
        { label: `gemini embed batch ${i}`, attempts: 3, baseMs: 2000 },
      );
      const rows = batch.map((c, idx) => ({
        video_id: videoId,
        start_seconds: c.startSeconds,
        end_seconds: c.endSeconds,
        text: c.text,
        embedding: embeddings[idx],
      }));
      const { error } = await sb().from("video_chunks").insert(rows);
      if (error) throw error;
      inserted += rows.length;
    } catch (err) {
      log.warn("embedding batch failed (skipping)", {
        videoId,
        batchIndex: i,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  log.info("embedding complete", { videoId, inserted });
  return inserted;
}

function segmentIntoChunks(segs: TranscriptSegment[]): Chunk[] {
  if (segs.length === 0) return [];
  const out: Chunk[] = [];
  let buf: TranscriptSegment[] = [];
  let bufStart = segs[0]!.start;
  let bufLen = 0;

  const flush = () => {
    if (buf.length === 0 || bufLen < MIN_CHUNK_CHARS) return;
    out.push({
      startSeconds: bufStart,
      endSeconds: buf[buf.length - 1]!.end,
      text: buf.map((s) => s.text).join(" ").trim(),
    });
    buf = [];
    bufLen = 0;
  };

  for (const s of segs) {
    if (buf.length === 0) bufStart = s.start;
    buf.push(s);
    bufLen += s.text.length + 1;
    if (bufLen >= TARGET_CHUNK_CHARS) flush();
  }
  // Tail: append short residual to the previous chunk rather than creating
  // a tiny fragment.
  if (buf.length > 0) {
    if (out.length > 0 && bufLen < MIN_CHUNK_CHARS) {
      const last = out[out.length - 1]!;
      last.endSeconds = buf[buf.length - 1]!.end;
      last.text = (last.text + " " + buf.map((s) => s.text).join(" ")).trim();
    } else {
      out.push({
        startSeconds: bufStart,
        endSeconds: buf[buf.length - 1]!.end,
        text: buf.map((s) => s.text).join(" ").trim(),
      });
    }
  }
  return out;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  // @google/genai has batch embedding support via `embedContent` with an array.
  const response = await gemini().models.embedContent({
    model: geminiEmbeddingModel(),
    contents: texts.map((t) => ({ parts: [{ text: t }] })),
  });
  const embs = (response as unknown as { embeddings?: { values: number[] }[] }).embeddings;
  if (!embs || embs.length !== texts.length) {
    throw new Error(`Embed response size mismatch: got ${embs?.length ?? 0}, expected ${texts.length}`);
  }
  return embs.map((e) => e.values);
}
