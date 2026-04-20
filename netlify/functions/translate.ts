import { z } from "zod";
import { verifySitePassword, adminClient, jsonResponse, errorResponse, httpError } from "./_auth.js";

const BodySchema = z.object({
  videoId: z.string().uuid(),
  targetLanguage: z.string().min(2).max(30), // ISO code or English name, both accepted
});

const SYSTEM = `You translate video transcripts while preserving segment structure and timing. Input is a JSON array of {start, end, text}. Output is the SAME array with ONLY the text field translated into the target language. Preserve punctuation, speaker tags, and timestamps. Return valid JSON — no wrapping, no prose.`;

export default async (req: Request): Promise<Response> => {
  try {
    if (req.method !== "POST") throw httpError(405, "Method not allowed");
    verifySitePassword(req);
    const body = BodySchema.parse(await req.json());

    const { data: video, error } = await adminClient()
      .from("videos")
      .select("transcript, translations")
      .eq("id", body.videoId)
      .single();
    if (error || !video) throw httpError(404, "Video not found");
    if (!video.transcript) throw httpError(409, "Transcript not ready");

    const cached = (video.translations as Record<string, unknown> | null) ?? null;
    const cachedEntry = cached?.[body.targetLanguage];
    if (cachedEntry) {
      return jsonResponse(200, { transcript: cachedEntry, cached: true });
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) throw httpError(500, "GEMINI_API_KEY not set");
    const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [
            {
              role: "user",
              parts: [
                { text: `Target language: ${body.targetLanguage}` },
                { text: `Transcript JSON:\n${JSON.stringify(video.transcript)}` },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
          },
        }),
      },
    );
    if (!res.ok) throw httpError(502, `Gemini: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    let translated: unknown;
    try {
      translated = JSON.parse(text);
    } catch {
      throw httpError(502, "Translation was not valid JSON");
    }

    // Cache on the row.
    const nextCache = { ...(cached ?? {}), [body.targetLanguage]: translated };
    await adminClient()
      .from("videos")
      .update({ translations: nextCache })
      .eq("id", body.videoId);

    return jsonResponse(200, { transcript: translated, cached: false });
  } catch (err) {
    return errorResponse(err);
  }
};
