import { verifySitePassword, adminClient, jsonResponse, errorResponse, httpError } from "./_auth.js";
import { createDownloadUrl } from "./_storage.js";

const EXPIRES = 30 * 60; // 30 minutes

export default async (req: Request): Promise<Response> => {
  try {
    if (req.method !== "GET") throw httpError(405, "Method not allowed");
    verifySitePassword(req);

    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) throw httpError(400, "Missing ?id");

    const { data, error } = await adminClient()
      .from("videos")
      .select("preview_path")
      .eq("id", id)
      .single();
    if (error || !data?.preview_path) throw httpError(404, "No preview available");

    const signed = await createDownloadUrl(data.preview_path, EXPIRES);

    return jsonResponse(200, { url: signed, expiresInSeconds: EXPIRES });
  } catch (err) {
    return errorResponse(err);
  }
};
