import { rm } from "node:fs/promises";
import { deleteObject } from "../lib/storage.js";
import { log } from "../lib/log.js";

export async function cleanupRawStorage(path: string): Promise<void> {
  try {
    await deleteObject(path);
    log.info("raw storage object deleted", { path });
  } catch (err) {
    log.warn("storage delete failed (continuing)", {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function cleanupWorkDir(workDir: string): Promise<void> {
  try {
    await rm(workDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
