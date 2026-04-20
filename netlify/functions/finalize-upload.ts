import { z } from "zod";
import { verifySitePassword, adminClient, jsonResponse, errorResponse, httpError } from "./_auth.js";
import type { FinalizeUploadResponse } from "../../shared/types/api.js";

const BodySchema = z.object({
  videoId: z.string().uuid(),
});

export default async (req: Request): Promise<Response> => {
  try {
    if (req.method !== "POST") throw httpError(405, "Method not allowed");
    verifySitePassword(req);
    const { videoId } = BodySchema.parse(await req.json());

    // Atomic status transition: pending -> queued, once.
    const { data, error } = await adminClient()
      .from("videos")
      .update({ status: "queued", dispatched_at: new Date().toISOString() })
      .eq("id", videoId)
      .eq("status", "pending")
      .select("id")
      .single();

    if (error || !data) {
      throw httpError(409, "Video not found or already queued");
    }

    // Dispatch to the worker. If dispatch fails (GitHub outage, token issue),
    // the file is still safely in storage — don't bubble up as a user-facing
    // upload failure. Mark the row so it's retryable and surface a warning.
    const dispatchError = await dispatchWorker(videoId);
    if (dispatchError) {
      await adminClient()
        .from("videos")
        .update({ status: "failed", error: `dispatch: ${dispatchError}` })
        .eq("id", videoId);
      const res: FinalizeUploadResponse = {
        ok: true,
        status: "dispatch_failed",
        warning: dispatchError,
      };
      return jsonResponse(200, res);
    }

    const res: FinalizeUploadResponse = { ok: true, status: "queued" };
    return jsonResponse(200, res);
  } catch (err) {
    return errorResponse(err);
  }
};

async function dispatchWorker(videoId: string): Promise<string | null> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) {
    console.warn("[finalize] No GITHUB_DISPATCH_TOKEN/GITHUB_REPO; skipping dispatch");
    return "GitHub dispatch not configured";
  }
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: "process-video",
        client_payload: { video_id: videoId },
      }),
    });
    if (r.status !== 204) {
      const txt = await r.text().catch(() => "");
      return `GitHub dispatch ${r.status}: ${txt.slice(0, 200)}`;
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
