import { adminClient } from "./_auth.js";

export const BUCKET = "videos";

export function buildStoragePath(videoId: string, filename: string): string {
  const safe = filename.replace(/[^\w.\-]+/g, "_").slice(0, 120);
  return `uploads/${videoId}/${safe}`;
}

/**
 * Create a signed URL the browser can PUT an upload directly to. The token
 * is scoped to one object path and a short TTL (default 2 hours — enough
 * even for multi-GB uploads on a modest connection).
 */
export async function createUploadUrl(storagePath: string): Promise<string> {
  const { data, error } = await adminClient()
    .storage.from(BUCKET)
    .createSignedUploadUrl(storagePath, { upsert: true });
  if (error || !data) throw new Error(`Signed upload URL failed: ${error?.message}`);
  return data.signedUrl;
}

/** Short-lived signed GET URL for the browser <video> element. */
export async function createDownloadUrl(
  storagePath: string,
  expiresInSeconds: number,
): Promise<string> {
  const { data, error } = await adminClient()
    .storage.from(BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data) throw new Error(`Signed URL failed: ${error?.message}`);
  return data.signedUrl;
}

export async function removeObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await adminClient().storage.from(BUCKET).remove(paths);
  if (error && !/not.?found/i.test(error.message)) {
    throw new Error(`Storage remove failed: ${error.message}`);
  }
}
