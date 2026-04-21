import { z } from "zod";
import { verifySitePassword, adminClient, jsonResponse, errorResponse, httpError } from "./_auth.js";
import { buildStoragePath, createUploadToken, BUCKET } from "./_storage.js";
import type { PresignUploadResponse } from "../../shared/types/api.js";

const BodySchema = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().min(3).max(100),
  sizeBytes: z.number().int().positive().max(5 * 1024 * 1024 * 1024),
  uploaderName: z.string().max(80).optional(),
});

const EXPIRES = 2 * 60 * 60;

export default async (req: Request): Promise<Response> => {
  try {
    if (req.method !== "POST") throw httpError(405, "Method not allowed");
    verifySitePassword(req);
    const body = BodySchema.parse(await req.json());

    const { data: row, error } = await adminClient()
      .from("videos")
      .insert({
        uploader_name: body.uploaderName ?? null,
        storage_path: "pending",
        filename: body.filename,
        size_bytes: body.sizeBytes,
        status: "pending",
      })
      .select("id")
      .single();
    if (error || !row) throw httpError(500, `DB insert failed: ${error?.message}`);

    const storagePath = buildStoragePath(row.id, body.filename);
    const { path, token, signedUrl } = await createUploadToken(storagePath);

    await adminClient().from("videos").update({ storage_path: storagePath }).eq("id", row.id);

    const res: PresignUploadResponse = {
      videoId: row.id,
      bucket: BUCKET,
      path,
      token,
      signedUrl,
      expiresInSeconds: EXPIRES,
    };
    return jsonResponse(200, res);
  } catch (err) {
    return errorResponse(err);
  }
};
