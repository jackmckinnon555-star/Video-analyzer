import { verifySitePassword, adminClient, jsonResponse, errorResponse, httpError } from "./_auth.js";

export default async (req: Request): Promise<Response> => {
  try {
    if (req.method !== "GET") throw httpError(405, "Method not allowed");
    verifySitePassword(req);

    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) throw httpError(400, "Missing ?id");

    const { data, error } = await adminClient()
      .from("videos")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) throw httpError(404, "Not found");

    return jsonResponse(200, data);
  } catch (err) {
    return errorResponse(err);
  }
};
