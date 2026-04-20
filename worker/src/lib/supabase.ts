import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.js";

let _client: SupabaseClient | null = null;
export function sb(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  return _client;
}
