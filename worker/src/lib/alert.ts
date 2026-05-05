// Backwards-compatible re-export. The implementation lives in
// shared/lib/alert.ts so Netlify functions can call it too.
import {
  sendFailureAlert as send,
  type AlertPayload as Payload,
} from "../../../shared/lib/alert.js";

export interface AlertPayload {
  videoId: string;
  phase: string;
  error: string;
  /** Legacy alias for detailUrl — pre-existing call sites pass this name. */
  ghaRunUrl?: string;
  extra?: Record<string, unknown>;
}

export async function sendFailureAlert(p: AlertPayload): Promise<void> {
  const payload: Payload = {
    videoId: p.videoId,
    phase: p.phase,
    error: p.error,
    detailUrl: p.ghaRunUrl,
    extra: p.extra,
  };
  await send(payload);
}
