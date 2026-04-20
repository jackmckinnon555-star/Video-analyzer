import { readFile, stat } from "node:fs/promises";
import { log } from "../lib/log.js";
import type { SampledFrame } from "./extractFrames.js";

/**
 * Choose a thumbnail from the sampled frames and return it as a base64 data URL.
 *
 * Heuristic: among frames in the middle 60% of the video, pick the one
 * with the largest file size. Under a fixed JPEG quality, bigger file =
 * more high-frequency detail = less likely to be a blank/transition frame.
 * No image-processing dependency required.
 *
 * Returning a data URL keeps the whole result in Supabase: no presigning
 * function, no extra request from the browser. At 512px+q5 a JPEG is
 * typically 20-40 KB — fine for the 500 MB free-tier Postgres cap.
 */
export async function pickThumbnailDataUrl(
  frames: SampledFrame[],
): Promise<string | null> {
  if (frames.length === 0) return null;

  const start = Math.floor(frames.length * 0.2);
  const end = Math.max(start + 1, Math.floor(frames.length * 0.8));
  const candidates = frames.slice(start, end);

  let best: { frame: SampledFrame; size: number } | null = null;
  for (const f of candidates) {
    const size = (await stat(f.path)).size;
    if (!best || size > best.size) best = { frame: f, size };
  }
  if (!best) return null;

  const buf = await readFile(best.frame.path);
  const url = `data:image/jpeg;base64,${buf.toString("base64")}`;
  log.info("thumbnail selected", {
    timestampSeconds: best.frame.timestampSeconds,
    size: best.size,
  });
  return url;
}
