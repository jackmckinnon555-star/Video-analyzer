import { adminClient, jsonResponse, errorResponse, httpError } from "./_auth.js";

/**
 * Unauthenticated read-only endpoint for public share pages.
 * GET /api/public-video?slug=abcdef
 *
 * Returns the sanitized video metadata + a short-lived signed preview URL.
 * Does NOT require the site password — that's the whole point of share links.
 * Only rows with non-null `public_slug` are reachable.
 */
export default async (req: Request): Promise<Response> => {
  try {
    if (req.method !== "GET") throw httpError(405, "Method not allowed");
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug");
    if (!slug || !/^[a-z2-9]{8,20}$/.test(slug)) throw httpError(400, "Invalid slug");

    const { data, error } = await adminClient()
      .from("videos")
      .select(
        "id, title, filename, uploader_name, duration_seconds, detected_language, status, transcript, chapters, highlights, entities, keywords, key_quotes, thumbnail_url, preview_path, created_at",
      )
      .eq("public_slug", slug)
      .maybeSingle();
    if (error) throw httpError(500, error.message);
    if (!data) throw httpError(404, "Not found");

    // Sign the preview URL ourselves — don't expose the get-preview-url
    // endpoint which requires site-password.
    let previewUrl: string | null = null;
    if (data.preview_path) {
      const signed = await adminClient()
        .storage.from("videos")
        .createSignedUrl(data.preview_path, 30 * 60);
      previewUrl = signed.data?.signedUrl ?? null;
    }

    // Strip internal fields before returning.
    const publicVideo = {
      id: data.id,
      title: data.title,
      filename: data.filename,
      uploader_name: data.uploader_name,
      duration_seconds: data.duration_seconds,
      detected_language: data.detected_language,
      status: data.status,
      transcript: data.transcript,
      chapters: data.chapters,
      highlights: data.highlights,
      entities: data.entities,
      keywords: data.keywords,
      key_quotes: data.key_quotes,
      thumbnail_url: data.thumbnail_url,
      preview_url: previewUrl,
      preview_expires_in_seconds: 30 * 60,
      created_at: data.created_at,
    };

    return jsonResponse(200, publicVideo);
  } catch (err) {
    return errorResponse(err);
  }
};

