import path from "node:path";
import { runFfmpeg } from "../lib/ffmpeg.js";
import { uploadFile } from "../lib/storage.js";
import { log } from "../lib/log.js";

/**
 * Build a 480p H.264/AAC MP4 preview of the full video and upload it to R2.
 * The preview is what the results page plays back — chapter-click + jump-to-
 * timestamp only work if there's an actual video element to drive.
 *
 * 480p + 500 kbps + stereo AAC @ 96 kbps yields ~70 MB for a 2-hour talk.
 * Well under R2's free 10 GB cap for a small team's working set.
 *
 * Returns the R2 key. The browser fetches a short-lived signed GET URL.
 */
export async function buildPreview(videoId: string, videoPath: string): Promise<string> {
  const out = path.join(path.dirname(videoPath), "preview.mp4");
  log.info("building 480p preview", { videoId });
  await runFfmpeg([
    "-y",
    "-i", videoPath,
    "-vf", "scale='min(854,iw)':'-2'",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "28",
    "-maxrate", "800k",
    "-bufsize", "1600k",
    "-c:a", "aac",
    "-b:a", "96k",
    "-movflags", "+faststart",
    out,
  ]);

  const storagePath = `previews/${videoId}.mp4`;
  await uploadFile(storagePath, out, "video/mp4");
  log.info("preview uploaded", { path: storagePath });
  return storagePath;
}
