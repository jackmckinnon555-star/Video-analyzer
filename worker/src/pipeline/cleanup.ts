import { rm } from "node:fs/promises";

export async function cleanupWorkDir(workDir: string): Promise<void> {
  try {
    await rm(workDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
