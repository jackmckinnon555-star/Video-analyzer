import { adminClient } from "./_auth.js";

export const BUCKET = "videos";

export function buildStoragePath(videoId: string, filename: string): string {
  const safe = filename.replace(/[^\w.\-]+/g, "_").slice(0, 120);
  return `uploads/${videoId}/${safe}`;
}

/**
 * Issue a signed upload token scoped to one object path. Returns:
 * - `path` / `token` for the Supabase JS client
 *   (`supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, file)`)
 * - `signedUrl` — the full `https://…/storage/v1/object/upload/sign/…?token=…`
 *   URL for clients that prefer a raw PUT (e.g. the desktop upload script).
 */
export async function createUploadToken(
  storagePath: string,
): Promise<{ path: string; token: string; signedUrl: string }> {
  const { data, error } = await adminClient()
    .storage.from(BUCKET)
    .createSignedUploadUrl(storagePath, { upsert: true });
  if (error || !data) throw new Error(`Signed upload URL failed: ${error?.message}`);
  return { path: data.path, token: data.token, signedUrl: data.signedUrl };
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
