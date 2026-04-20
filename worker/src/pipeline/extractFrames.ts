import path from "node:path";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { runFfmpeg } from "../lib/ffmpeg.js";
import { log } from "../lib/log.js";

export interface SampledFrame {
  timestampSeconds: number;
  path: string;
  base64: string;
}

/**
 * Sample one frame every `everyNSeconds`, scaled to 512px longest edge.
 * Returns frames with their timestamps, in order.
 */
export async function extractFrames(
  videoPath: string,
  workDir: string,
  everyNSeconds = 30,
): Promise<SampledFrame[]> {
  const framesDir = path.join(workDir, "frames");
  await mkdir(framesDir, { recursive: true });

  await runFfmpeg([
    "-y",
    "-i", videoPath,
    "-vf", `fps=1/${everyNSeconds},scale='min(512,iw)':'-2'`,
    "-q:v", "5",
    path.join(framesDir, "frame-%05d.jpg"),
  ]);

  const files = (await readdir(framesDir)).filter((f) => f.endsWith(".jpg")).sort();
  const frames: SampledFrame[] = [];
  for (let i = 0; i < files.length; i++) {
    const filename = files[i]!;
    const p = path.join(framesDir, filename);
    const buf = await readFile(p);
    frames.push({
      timestampSeconds: i * everyNSeconds,
      path: p,
      base64: buf.toString("base64"),
    });
  }
  log.info("frames sampled", { count: frames.length, everyNSeconds });
  return frames;
}
