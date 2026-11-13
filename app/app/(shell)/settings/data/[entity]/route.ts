import type { NextRequest } from "next/server";
import { loadContext, type AppContext } from "@/lib/auth/context";
import { buildExportCsv } from "@/lib/settings/export";
import { EXPORT_ENTITIES } from "@/lib/settings/export-entities";

const NO_STORE = { "Cache-Control": "no-store" };

function plain(message: string, status: number) {
  return new Response(message, { status, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * GET /app/settings/data/{entity} → one CSV file.
 * The layout and page checks do not cover Route Handlers, so the user and the
 * permission are checked again here. Rows are read with the user's own session (RLS).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;
  if (!EXPORT_ENTITIES.some((e) => e.key === entity)) return plain("Not found", 404);

  const ctx = await loadContext();
  if (!ctx) return plain("Please sign in again.", 401);
  if (!ctx.business || !ctx.role || !ctx.memberId || !ctx.business.onboarding_completed_at) {
    return plain("You don't have permission to do this", 403);
  }
  if (!ctx.can("settings.manage")) return plain("You don't have permission to do this", 403);

  try {
    const file = await buildExportCsv(ctx as AppContext, entity);
    if (!file) return plain("Not found", 404);
    return new Response(file.csv, {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[export] failed", entity, error instanceof Error ? error.message : error);
    return plain("Could not prepare this export. Please try again.", 500);
  }
}
