import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Secret-key client for trusted server-side writes (e.g. ingesting Riot API
 * snapshots on a cron job). Bypasses RLS — never import this in code that
 * runs in the browser.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
}
