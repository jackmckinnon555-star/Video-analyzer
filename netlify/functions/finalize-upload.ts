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

    // Atomic status transition: only flip pending -> queued once.
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

    await dispatchWorker(videoId);

    const res: FinalizeUploadResponse = { ok: true, status: "queued" };
    return jsonResponse(200, res);
  } catch (err) {
    return errorResponse(err);
  }
};

async function dispatchWorker(videoId: string): Promise<void> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) {
    console.warn("[finalize] No GITHUB_DISPATCH_TOKEN/GITHUB_REPO; skipping worker dispatch");
    return;
  }
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
    throw httpError(502, `GitHub dispatch failed: ${r.status} ${txt}`);
  }
}
