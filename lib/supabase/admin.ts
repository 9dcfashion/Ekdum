import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Service-role client. BYPASSES RLS. Server only: this module imports
 * "server-only", so bundling it into client code fails the build.
 * Use it only for: posting RPCs (after the server has checked the user),
 * invitations, the notification worker, the public invoice page and rate limits.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local (server only).");
  }
  return createClient(env.supabaseUrl, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type AdminClient = ReturnType<typeof createAdminClient>;
