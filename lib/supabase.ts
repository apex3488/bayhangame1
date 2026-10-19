import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let client: SupabaseClient | null = null;

/** Browser client. Uses only the publishable key; access is limited by RLS and RPC checks. */
export function getSupabase(): SupabaseClient {
  if (!url || !key) {
    throw new Error("Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }
  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  return client;
}

/** Players sign in with a login; Supabase Auth needs an email, so a service-only address is derived. */
export function loginToEmail(login: string): string {
  return `${login.trim().toLowerCase()}@players.bayhan.app`;
}
