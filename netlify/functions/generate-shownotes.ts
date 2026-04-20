import { z } from "zod";
import { verifySitePassword, adminClient, jsonResponse, errorResponse, httpError } from "./_auth.js";

const BodySchema = z.object({
  videoId: z.string().uuid(),
  force: z.boolean().optional(),
});

const SYSTEM = `You write publication-ready markdown show notes from a video's metadata and transcript. Produce:
1. An H1 with the title
2. A 2-3 sentence overview paragraph
3. "## Chapters" — a markdown list: "- \`[mm:ss]\` Chapter title — one-sentence summary"
4. "## Highlights" — bullet list of the most notable moments with timestamps
5. "## Key quotes" — italicized quotes with speaker (if available) and timestamp
6. "## Topics" — inline keyword chips
7. "## Full transcript" — the transcript with per-segment timestamps inline

No preamble. No "here is..." wrapper. Just the markdown.`;

export default async (req: Request): Promise<Response> => {
  try {
    if (req.method !== "POST") throw httpError(405, "Method not allowed");
    verifySitePassword(req);
    const body = BodySchema.parse(await req.json());

    const { data: video, error } = await adminClient()
      .from("videos")
      .select("title, chapters, highlights, keywords, key_quotes, transcript, show_notes")
      .eq("id", body.videoId)
      .single();
    if (error || !video) throw httpError(404, "Video not found");

    // Cached — return immediately unless force-refresh requested.
    if (video.show_notes && !body.force) {
      return jsonResponse(200, { markdown: video.show_notes, cached: true });
    }
    if (!video.transcript) throw httpError(409, "Transcript not ready");

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) throw httpError(500, "GEMINI_API_KEY not set");
    const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

    const payload = {
      title: video.title,
      chapters: video.chapters,
      highlights: video.highlights,
      keywords: video.keywords,
      key_quotes: video.key_quotes,
      transcript: video.transcript,
    };

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [
            { role: "user", parts: [{ text: JSON.stringify(payload).slice(0, 300_000) }] },
          ],
          generationConfig: { temperature: 0.3 },
        }),
      },
    );
    if (!res.ok) throw httpError(502, `Gemini: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const markdown = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

    await adminClient().from("videos").update({ show_notes: markdown }).eq("id", body.videoId);

    return jsonResponse(200, { markdown, cached: false });
  } catch (err) {
    return errorResponse(err);
  }
};
