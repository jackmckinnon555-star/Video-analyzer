import path from "node:path";
import { mkdir } from "node:fs/promises";
import { downloadToFile } from "../lib/storage.js";
import { log } from "../lib/log.js";

export async function downloadVideo(storagePath: string, workDir: string): Promise<string> {
  await mkdir(workDir, { recursive: true });
  const dest = path.join(workDir, "video.bin");
  log.info("downloading video from storage", { storagePath, dest });
  await downloadToFile(storagePath, dest);
  return dest;
}
