import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

/** Best-effort client IP (Vercel and most proxies set x-forwarded-for). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/**
 * Fixed-window rate limit backed by Postgres (check_rate_limit RPC).
 * Returns true when the request is allowed. If the limiter itself is
 * unavailable (e.g. service key not configured yet) it fails open and logs,
 * so a misconfiguration never locks every user out.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("check_rate_limit", {
      p_key: key.slice(0, 200),
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.warn("[rate-limit] unavailable:", error.message);
      return true;
    }
    return data !== false;
  } catch (error) {
    console.warn("[rate-limit] unavailable:", error instanceof Error ? error.message : error);
    return true;
  }
}

/** Rate limit by caller IP for a named bucket. */
export async function rateLimitByIp(bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  return rateLimit(`${bucket}:${await clientIp()}`, limit, windowSeconds);
}
