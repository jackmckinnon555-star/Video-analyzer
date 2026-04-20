import { z } from "zod";
import { randomBytes } from "node:crypto";
import { verifySitePassword, adminClient, jsonResponse, errorResponse, httpError } from "./_auth.js";

const BodySchema = z.object({
  videoId: z.string().uuid(),
  revoke: z.boolean().optional(),
});

function generateSlug(): string {
  // 10 random bytes → ~16 chars of base32. Plenty of entropy, URL-safe.
  const alphabet = "23456789abcdefghjkmnpqrstvwxyz";
  const bytes = randomBytes(10);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export default async (req: Request): Promise<Response> => {
  try {
    if (req.method !== "POST") throw httpError(405, "Method not allowed");
    verifySitePassword(req);
    const body = BodySchema.parse(await req.json());

    if (body.revoke) {
      const { error } = await adminClient()
        .from("videos")
        .update({ public_slug: null })
        .eq("id", body.videoId);
      if (error) throw httpError(500, error.message);
      return jsonResponse(200, { ok: true, revoked: true });
    }

    // Check if one already exists.
    const { data: existing } = await adminClient()
      .from("videos")
      .select("public_slug")
      .eq("id", body.videoId)
      .single();

    if (existing?.public_slug) {
      return jsonResponse(200, { ok: true, slug: existing.public_slug });
    }

    const slug = generateSlug();
    const { error } = await adminClient()
      .from("videos")
      .update({ public_slug: slug })
      .eq("id", body.videoId);
    if (error) throw httpError(500, error.message);

    return jsonResponse(200, { ok: true, slug });
  } catch (err) {
    return errorResponse(err);
  }
};
