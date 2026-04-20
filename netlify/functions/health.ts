import { verifySitePassword, adminClient, jsonResponse, errorResponse, httpError } from "./_auth.js";

/**
 * Returns which environment pieces are configured. Useful for checking
 * the app is wired correctly before attempting an upload.
 *
 * Protected by site password so it doesn't leak config status publicly.
 */
export default async (req: Request): Promise<Response> => {
  try {
    if (req.method !== "GET") throw httpError(405, "Method not allowed");
    verifySitePassword(req);

    const env = process.env;
    const checks = {
      supabase: !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
      groq: !!env.GROQ_API_KEY,
      gemini: !!env.GEMINI_API_KEY,
      cloudflare_ai: !!(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_WORKERS_AI_TOKEN),
      github_dispatch: !!(env.GITHUB_DISPATCH_TOKEN && env.GITHUB_REPO),
    };

    // DB ping + bucket existence check.
    let supabaseReachable = false;
    let bucketReady = false;
    try {
      const { error: dbErr } = await adminClient().from("videos").select("id").limit(1);
      supabaseReachable = !dbErr;
      const { data: buckets, error: bErr } = await adminClient().storage.listBuckets();
      bucketReady = !bErr && !!buckets?.some((b) => b.name === "videos");
    } catch {
      supabaseReachable = false;
    }

    const allRequired = checks.supabase && checks.groq && checks.gemini;

    return jsonResponse(200, {
      ok: allRequired && supabaseReachable && bucketReady,
      checks,
      supabaseReachable,
      bucketReady,
      notes: {
        required: ["supabase (DB + storage + bucket 'videos')", "groq", "gemini"],
        recommended: ["cloudflare_ai (fallback transcription)", "github_dispatch (auto-process on upload)"],
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
};
