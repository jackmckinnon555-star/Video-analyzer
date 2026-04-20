import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";

let _admin: SupabaseClient | null = null;
export function adminClient(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  _admin = createClient(url, key, { auth: { persistSession: false } });
  return _admin;
}

/**
 * Shared site-password gate. Not a real auth system — just keeps random
 * strangers from finding the URL and burning the R2/inference budget.
 * The password lives in the SITE_PASSWORD env var and in the client's
 * localStorage after the user types it once.
 */
export function verifySitePassword(req: Request): void {
  const expected = process.env.SITE_PASSWORD;
  if (!expected) throw httpError(500, "SITE_PASSWORD not configured");
  const got =
    req.headers.get("x-site-password") ??
    req.headers.get("X-Site-Password") ??
    "";
  if (!timingEqual(got, expected)) throw httpError(401, "Invalid site password");
}

function timingEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still run a comparison of equal-length buffers to keep timing roughly stable.
    const pad = Buffer.alloc(b.length, 0);
    timingSafeEqual(pad, Buffer.from(b));
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(err: unknown): Response {
  const status = (err as { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : "Internal error";
  return jsonResponse(status, { error: message });
}
