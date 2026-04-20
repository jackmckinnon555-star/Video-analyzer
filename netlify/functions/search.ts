import { z } from "zod";
import { verifySitePassword, adminClient, jsonResponse, errorResponse, httpError } from "./_auth.js";

const BodySchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(25).optional(),
  videoId: z.string().uuid().optional(),
});

export default async (req: Request): Promise<Response> => {
  try {
    if (req.method !== "POST") throw httpError(405, "Method not allowed");
    verifySitePassword(req);
    const body = BodySchema.parse(await req.json());

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) throw httpError(500, "GEMINI_API_KEY not set");

    // Embed the query via Gemini embeddings REST — keeps the function Node-only
    // without bringing in @google/genai as a dependency just for one call.
    const model = process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001";
    const embedRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: { parts: [{ text: body.query }] },
        }),
      },
    );
    if (!embedRes.ok) {
      throw httpError(502, `Gemini embed failed: ${embedRes.status} ${await embedRes.text()}`);
    }
    const embedJson = (await embedRes.json()) as { embedding?: { values?: number[] } };
    const values = embedJson.embedding?.values;
    if (!values) throw httpError(502, "Gemini returned no embedding");

    const { data, error } = await adminClient().rpc("match_video_chunks", {
      query_embedding: values,
      match_count: body.limit ?? 10,
      filter_video_id: body.videoId ?? null,
    });
    if (error) throw httpError(500, `Search failed: ${error.message}`);

    return jsonResponse(200, { results: data ?? [] });
  } catch (err) {
    return errorResponse(err);
  }
};
