import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Loud failure is better than silent fallback. Missing VITE_ vars at build
// time ship a bundle that can never talk to the DB — we'd rather surface it
// as a visible error banner than let "Failed to load videos" confuse users.
if (!url || !anonKey) {
  const msg = "Supabase is not configured — VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set at build time.";
  console.error("[supabase]", msg);
  if (typeof document !== "undefined") {
    document.body?.insertAdjacentHTML(
      "afterbegin",
      `<div style="padding:12px 16px;background:#fee2e2;color:#991b1b;font:13px system-ui;border-bottom:1px solid #fecaca">${msg}</div>`,
    );
  }
}

export const supabase = createClient(url ?? "https://invalid.supabase.co", anonKey ?? "invalid", {
  auth: { persistSession: true, autoRefreshToken: true },
});
