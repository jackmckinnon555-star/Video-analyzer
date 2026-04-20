import { verifySitePassword, adminClient, jsonResponse, errorResponse, httpError } from "./_auth.js";

export default async (req: Request): Promise<Response> => {
  try {
    if (req.method !== "GET") throw httpError(405, "Method not allowed");
    verifySitePassword(req);

    const { data, error } = await adminClient()
      .from("videos")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw httpError(500, error.message);

    return jsonResponse(200, { videos: data ?? [] });
  } catch (err) {
    return errorResponse(err);
  }
};
