import { createWriteStream } from "node:fs";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { sb } from "./supabase.js";

export const BUCKET = "videos";

/** Download an object to disk. Streams; safe for multi-GB files. */
export async function downloadToFile(path: string, destPath: string): Promise<void> {
  const { data, error } = await sb().storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? "no body"}`);
  // Blob -> Node Readable -> file
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

export async function uploadFile(
  path: string,
  filePath: string,
  contentType: string,
): Promise<void> {
  // Supabase storage-js accepts a ReadableStream or Buffer. For large files
  // (our 480p preview can be ~100 MB for long videos), stream via a Buffer
  // only if it's small; otherwise use the REST resumable endpoint.
  const size = (await stat(filePath)).size;
  if (size < 50 * 1024 * 1024) {
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(filePath);
    await uploadBuffer(path, body, contentType);
    return;
  }
  // For larger files, stream via a direct REST call to the TUS-compatible
  // Supabase Storage endpoint. Non-resumable here (we retry the whole upload
  // on failure; the preview is always rebuildable from the raw).
  await uploadLargeFileViaRest(path, filePath, contentType, size);
}

async function uploadLargeFileViaRest(
  path: string,
  filePath: string,
  contentType: string,
  size: number,
): Promise<void> {
  const url = `${process.env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(path)}`;
  const body = createReadStream(filePath);
  // Node fetch accepts Readable for body with duplex: 'half'.
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": contentType,
      "Content-Length": String(size),
      "x-upsert": "true",
    },
    // Node fetch accepts a Readable as body but the type only says BodyInit.
    // 'duplex' is required when streaming.
    ...({ body, duplex: "half" } as object),
  } as RequestInit);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Large upload failed ${res.status}: ${text.slice(0, 300)}`);
  }
}
