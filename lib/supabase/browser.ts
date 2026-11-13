"use client";

import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/lib/env";

let client: ReturnType<typeof createBrowserClient> | undefined;

/** Supabase client for Client Components (anon key + the user's session; RLS applies). */
export function createClient() {
  client ??= createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
  return client;
}
