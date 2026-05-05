import { z } from "zod";
import { verifySitePassword, adminClient, jsonResponse, errorResponse, httpError } from "./_auth.js";
import type { FinalizeUploadResponse } from "../../shared/types/api.js";
import { sendFailureAlert } from "../../shared/lib/alert.js";

const BodySchema = z.object({
  videoId: z.string().uuid(),
  // Optional list of additional uploaded video rows that, together with
  // videoId, make up a single logical upload (long source split into ~6 hr
  // parts). videoId is part 1; childIds are parts 2..N in order.
  childIds: z.array(z.string().uuid()).max(10).optional(),
});

export default async (req: Request): Promise<Response> => {
  try {
    if (req.method !== "POST") throw httpError(405, "Method not allowed");
    verifySitePassword(req);
    const { videoId, childIds = [] } = BodySchema.parse(await req.json());

    // Multi-part upload: link children to the parent so the worker can find
    // them. Part 1 (videoId) keeps parent_video_id = NULL; parts 2..N point
    // back at it. All rows get part_index + total_parts set so the dashboard
    // can show "Part k of N".
    if (childIds.length > 0) {
      const totalParts = childIds.length + 1;
      const admin = adminClient();
      // Mark the parent as part 1.
      const { error: pErr } = await admin
        .from("videos")
        .update({ part_index: 1, total_parts: totalParts })
        .eq("id", videoId);
      if (pErr) throw httpError(500, `Parent linkage failed: ${pErr.message}`);
      // Link children with their indices.
      for (let i = 0; i < childIds.length; i++) {
        const childId = childIds[i]!;
        const { error: cErr } = await admin
          .from("videos")
          .update({
            parent_video_id: videoId,
            part_index: i + 2,
            total_parts: totalParts,
            // Children get queued straight to "transcribing"-eligible state but
            // never get their own dispatch — the parent's worker pulls them.
            status: "queued",
            dispatched_at: new Date().toISOString(),
          })
          .eq("id", childId)
          .eq("status", "pending");
        if (cErr) throw httpError(500, `Child ${i + 2} linkage failed: ${cErr.message}`);
      }
    }

    // Atomic status transition: pending -> queued, once. Only the parent
    // (or a standalone) is dispatched; children ride along inside the
    // parent's single worker run.
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
      // Fire-and-forget — alert fan-out errors must not mask the upload's own state.
      sendFailureAlert({
        videoId,
        phase: "dispatch",
        error: dispatchError,
        detailUrl: `https://${process.env.URL?.replace(/^https?:\/\//, "") ?? "video-analyzer-tra.netlify.app"}/video/${videoId}`,
      }).catch((e) => console.warn("[finalize] alert fan-out failed:", String(e)));
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
