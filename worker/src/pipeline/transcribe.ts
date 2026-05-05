import { stat } from "node:fs/promises";
import { envOptional } from "../lib/env.js";
import { log } from "../lib/log.js";
import type { TranscriptSegment } from "../../../shared/types/video.js";
import type { AudioChunk } from "./extractAudio.js";
import { transcribeChunkGroq, type ChunkResult } from "./transcribeGroq.js";
import { transcribeChunkCloudflare } from "./transcribeCloudflare.js";

type BackendName = "groq" | "cloudflare";
type BackendFn = (chunk: AudioChunk) => Promise<ChunkResult>;

const BACKENDS: Record<BackendName, BackendFn> = {
  groq: transcribeChunkGroq,
  cloudflare: transcribeChunkCloudflare,
};

export interface TranscribeResult {
  segments: TranscriptSegment[];
  language: string | null;
  coverageRatio: number;
  /** Single backend name if all chunks used the same one, "mixed" otherwise. */
  backend: string;
}

/**
 * Transcribe all audio chunks with per-chunk backend fallback.
 *
 * For each chunk, walk the preference order until one backend returns
 * a non-empty result. A backend that fails on chunk N doesn't prevent
 * the next chunk from trying that same backend first — rate limits are
 * often transient, and this preserves partial progress across a long job.
 */
export async function transcribeAll(
  chunks: AudioChunk[],
  totalDurationSeconds: number,
  onProgress?: (chunkIndex: number, totalChunks: number) => Promise<void>,
): Promise<TranscribeResult> {
  const pref = getPreference();
  log.info("transcription preference", { pref });

  const all: TranscriptSegment[] = [];
  let detectedLanguage: string | null = null;
  const backendsUsed = new Set<BackendName>();

  for (const [i, chunk] of chunks.entries()) {
    if (onProgress) await onProgress(i + 1, chunks.length);
    const { result, backend } = await transcribeOneChunk(chunk, pref, i + 1, chunks.length);
    backendsUsed.add(backend);
    all.push(...result.segments);
    if (!detectedLanguage && result.language) detectedLanguage = result.language;
  }

  const merged = mergeAndDedupe(all);
  const coverageRatio = coverage(merged, totalDurationSeconds);
  const backend = backendsUsed.size === 1 ? [...backendsUsed][0]! : "mixed";
  log.info("transcription complete", {
    segmentCount: merged.length,
    language: detectedLanguage,
    coverageRatio: Number(coverageRatio.toFixed(3)),
    durationSeconds: totalDurationSeconds,
    backend,
  });
  if (coverageRatio < 0.95 && totalDurationSeconds > 60) {
    log.warn("transcript coverage below 95% — possible gaps or silent sections", {
      coverageRatio,
    });
  }
  return { segments: merged, language: detectedLanguage, coverageRatio, backend };
}

async function transcribeOneChunk(
  chunk: AudioChunk,
  pref: BackendName[],
  index: number,
  total: number,
): Promise<{ result: ChunkResult; backend: BackendName }> {
  let lastErr: unknown;
  let emptyFallback: { result: ChunkResult; backend: BackendName } | null = null;
  for (const backend of pref) {
    const fn = BACKENDS[backend];
    if (!fn) {
      log.warn("unknown backend, skipping", { backend });
      continue;
    }
    try {
      log.info("transcribing chunk", { index, total, backend });
      const result = await fn(chunk);
      if (result.segments.length === 0 && chunk.durationSeconds > 5) {
        // Suspicious empty transcript — try the next backend but remember
        // this result so we can fall back to empty if every backend agrees.
        emptyFallback = { result, backend };
        throw new Error("empty transcript for non-trivial chunk");
      }
      return { result, backend };
    } catch (err) {
      lastErr = err;
      log.warn("chunk backend failed, trying next", {
        index,
        backend,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // All backends either returned empty or errored. If at least one returned
  // a well-formed empty result, the chunk is probably genuinely silent —
  // accept it rather than failing the entire job.
  if (emptyFallback) {
    log.warn("all backends returned empty — accepting silent chunk", { index });
    return emptyFallback;
  }
  throw lastErr ?? new Error(`All backends failed for chunk ${index}`);
}

function getPreference(): BackendName[] {
  const raw = envOptional("TRANSCRIBE_PREFERENCE") ?? "groq,cloudflare";
  const known: BackendName[] = ["groq", "cloudflare"];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is BackendName => (known as string[]).includes(s));
}

function mergeAndDedupe(segs: TranscriptSegment[]): TranscriptSegment[] {
  segs.sort((a, b) => a.start - b.start);
  const out: TranscriptSegment[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    // Drop exact-duplicate segments caused by chunk overlap.
    if (last && Math.abs(s.start - last.start) < 0.5 && s.text === last.text) continue;
    out.push(s);
  }
  return out;
}

function coverage(segs: TranscriptSegment[], totalDuration: number): number {
  if (totalDuration <= 0 || segs.length === 0) return 0;
  // Sum non-overlapping covered seconds.
  let covered = 0;
  let cursor = 0;
  for (const s of segs) {
    const start = Math.max(s.start, cursor);
    const end = Math.max(start, s.end);
    if (end > cursor) {
      covered += end - start;
      cursor = end;
    }
  }
  return Math.min(1, covered / totalDuration);
}

export async function assertAudioHasContent(audioPath: string): Promise<void> {
  const size = (await stat(audioPath)).size;
  if (size < 1024) {
    throw new Error(
      `Extracted audio is effectively empty (${size} bytes). The video likely has no audio track.`,
    );
  }
}
