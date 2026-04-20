import { z } from "zod";
import { verifySitePassword, adminClient, jsonResponse, errorResponse, httpError } from "./_auth.js";

const BodySchema = z.object({
  question: z.string().min(1).max(1000),
  videoId: z.string().uuid().optional(),
});

const SYSTEM_PROMPT = `You answer questions about a library of long-form videos (podcasts, lectures, talks) using only the provided transcript snippets. For each substantive claim, cite the source video and timestamp like [Video title @ 14:32]. If the snippets don't contain the answer, say so plainly. Keep replies under 6 sentences unless the user asks for depth.`;

export default async (req: Request): Promise<Response> => {
  try {
    if (req.method !== "POST") throw httpError(405, "Method not allowed");
    verifySitePassword(req);
    const body = BodySchema.parse(await req.json());

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) throw httpError(500, "GEMINI_API_KEY not set");

    // 1. Embed the question.
    const embedModel = process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001";
    const embedRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(embedModel)}:embedContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: { parts: [{ text: body.question }] } }),
      },
    );
    if (!embedRes.ok) throw httpError(502, `Embed: ${embedRes.status}`);
    const embedJson = (await embedRes.json()) as { embedding?: { values?: number[] } };
    const values = embedJson.embedding?.values;
    if (!values) throw httpError(502, "No embedding");

    // 2. Retrieve top-K snippets.
    const { data: matches, error } = await adminClient().rpc("match_video_chunks", {
      query_embedding: values,
      match_count: 8,
      filter_video_id: body.videoId ?? null,
    });
    if (error) throw httpError(500, `Retrieval: ${error.message}`);

    type Match = {
      id: string;
      video_id: string;
      video_title: string;
      start_seconds: number;
      text: string;
      similarity: number;
    };
    const hits = (matches as Match[] | null) ?? [];

    // 3. Build a prompt and call Gemini Flash.
    const snippetBlock = hits
      .map(
        (m, i) =>
          `[${i + 1}] ${m.video_title} @ ${formatTs(m.start_seconds)} (video_id: ${m.video_id}, similarity: ${m.similarity.toFixed(3)})\n${m.text}`,
      )
      .join("\n\n");

    const chatModel = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
    const chatRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(chatModel)}:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [
            {
              role: "user",
              parts: [
                { text: `Snippets:\n${snippetBlock || "(no relevant snippets found)"}` },
                { text: `\nQuestion: ${body.question}` },
              ],
            },
          ],
          generationConfig: { temperature: 0.3 },
        }),
      },
    );
    if (!chatRes.ok) throw httpError(502, `Chat: ${chatRes.status} ${await chatRes.text()}`);
    const chatJson = (await chatRes.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const answer =
      chatJson.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

    return jsonResponse(200, {
      answer,
      sources: hits.map((m) => ({
        video_id: m.video_id,
        video_title: m.video_title,
        start_seconds: m.start_seconds,
        snippet: m.text.slice(0, 200),
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
};

function formatTs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
