import { z } from "zod";
import { verifySitePassword, adminClient, jsonResponse, errorResponse, httpError } from "./_auth.js";
import { removeObjects } from "./_storage.js";

const BodySchema = z.object({
  videoId: z.string().uuid(),
});

export default async (req: Request): Promise<Response> => {
  try {
    if (req.method !== "POST") throw httpError(405, "Method not allowed");
    verifySitePassword(req);
    const { videoId } = BodySchema.parse(await req.json());

    const { data, error } = await adminClient()
      .from("videos")
      .select("storage_path, preview_path")
      .eq("id", videoId)
      .single();
    if (error || !data) throw httpError(404, "Not found");

    // preview_path and storage_path are the same object after the worker
    // simplification, so dedupe before calling remove.
    const pathSet = new Set<string>();
    if (data.storage_path && data.storage_path !== "pending") pathSet.add(data.storage_path);
    if (data.preview_path) pathSet.add(data.preview_path);
    await removeObjects([...pathSet]);

    const { error: delErr } = await adminClient().from("videos").delete().eq("id", videoId);
    if (delErr) throw httpError(500, delErr.message);

    return jsonResponse(200, { ok: true });
  } catch (err) {
    return errorResponse(err);
  }
};
