import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { sb } from "./supabase.js";

export const BUCKET = "videos";

/**
 * Download an object to disk. All uploads are capped at 50 MB by the
 * client-side compressor + Supabase bucket limit, so we safely buffer
 * the whole file into memory before streaming to disk.
 */
export async function downloadToFile(path: string, destPath: string): Promise<void> {
  const { data, error } = await sb().storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? "no body"}`);
  const arrayBuffer = await data.arrayBuffer();
  const stream = Readable.from(Buffer.from(arrayBuffer));
  await pipeline(stream, createWriteStream(destPath));
}

export async function deleteObject(path: string): Promise<void> {
  const { error } = await sb().storage.from(BUCKET).remove([path]);
  if (error) throw new Error(`Storage delete failed: ${error.message}`);
}

export async function uploadBuffer(
  path: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await sb()
    .storage.from(BUCKET)
    .upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
}
