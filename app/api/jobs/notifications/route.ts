import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { processDueNotifications } from "@/lib/notifications/process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Constant-time comparison of the bearer token with JOBS_SECRET. */
function isAuthorised(request: NextRequest, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  const given = Buffer.from(match[1], "utf8");
  const expected = Buffer.from(secret, "utf8");
  // timingSafeEqual needs equal lengths; a length mismatch is simply a wrong secret.
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

/**
 * Outbox processor. Called by pg_cron + pg_net every minute (retries) and
 * can be called by hand:  curl -X POST -H "Authorization: Bearer $JOBS_SECRET" …/api/jobs/notifications
 */
async function handle(request: NextRequest) {
  const secret = process.env.JOBS_SECRET;
  if (!secret) {
    return Response.json({ error: "not configured" }, { status: 503, headers: NO_STORE });
  }
  if (!isAuthorised(request, secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  try {
    const summary = await processDueNotifications(25);
    return Response.json(summary, { headers: NO_STORE });
  } catch (error) {
    console.error("[jobs/notifications] run failed:", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "failed" }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
