import { after, type NextRequest } from "next/server";
import { loadContext, type AppContext } from "@/lib/auth/context";
import { parseInvoiceNumber } from "@/lib/gst/numbering";
import { processDueNotifications } from "@/lib/notifications/process";
import { CODE_DEFERRED, SYNC_BATCH_MAX, SYNC_BODY_MAX_BYTES, type SyncErrorCode, type SyncItemResult, type SyncResponseBody } from "@/lib/offline/protocol";
import { rateLimit } from "@/lib/rate-limit";
import { postInvoice } from "@/lib/sales/post";
import { saleInputSchema } from "@/lib/validation/sales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" } as const;

const refuse = (status: number, error: SyncErrorCode, message: string) => Response.json({ error, message }, { status, headers: NO_STORE });

/** Sort key: financial year, then sequence. Bills without a readable number go last, in the order received. */
function numberKey(raw: unknown): [string, number] {
  const number = raw && typeof raw === "object" ? (raw as { invoice_number?: unknown }).invoice_number : null;
  const parsed = typeof number === "string" ? parseInvoiceNumber(number.trim()) : null;
  return parsed ? [`${parsed.fy}/${parsed.prefix}`, parsed.sequence] : ["~", Number.MAX_SAFE_INTEGER];
}

const uuidOf = (raw: unknown): string => {
  const id = raw && typeof raw === "object" ? (raw as { client_uuid?: unknown }).client_uuid : null;
  return typeof id === "string" ? id.slice(0, 64) : "";
};

/**
 * Offline sync. The till POSTs the bills it made without a network:
 *   { business_id, invoices: SaleInput[] }   (at most 25)
 * Each bill goes through the same postInvoice() as an online sale (source
 * "pos_offline"): permissions, totals and the device's number are all checked
 * again. The answer has one result per bill, in the order they were sent. One
 * bad bill never fails the others, and a retry is always safe (client_uuid).
 */
export async function POST(request: NextRequest) {
  const ctx = await loadContext();
  if (!ctx) return refuse(401, "unauthorized", "Sign in again to sync your bills");
  if (!ctx.business || !ctx.role || !ctx.memberId || !ctx.business.onboarding_completed_at) {
    return refuse(409, "not_ready", "Finish setting up your business first");
  }
  if (!(await rateLimit(`pos:sync:${ctx.user.id}`, 30, 60))) {
    return Response.json({ error: "rate_limited" satisfies SyncErrorCode, message: "Too many sync requests. Try again in a minute." }, { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });
  }

  if (Number(request.headers.get("content-length") ?? 0) > SYNC_BODY_MAX_BYTES) return refuse(413, "too_large", "Too much data in one request");
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > SYNC_BODY_MAX_BYTES) return refuse(413, "too_large", "Too much data in one request");
    body = JSON.parse(text);
  } catch {
    return refuse(400, "invalid_request", "The request could not be read");
  }
  const envelope = body as { business_id?: unknown; invoices?: unknown } | null;
  const invoices = envelope && typeof envelope === "object" ? envelope.invoices : null;
  if (!Array.isArray(invoices) || invoices.length === 0 || invoices.length > SYNC_BATCH_MAX) {
    return refuse(400, "invalid_request", `Send between 1 and ${SYNC_BATCH_MAX} bills at a time`);
  }
  // These bills were made for one business. If the user has since switched to another, do nothing rather than refuse each bill.
  if (envelope?.business_id !== ctx.business.id) {
    return refuse(409, "business_mismatch", "These bills belong to another business. Switch back to it to sync them.");
  }

  // Oldest number first, so the series fills in order and a gap is only reported when it is real.
  const order = invoices
    .map((raw, index) => ({ index, key: numberKey(raw) }))
    .sort((a, b) => a.key[0].localeCompare(b.key[0]) || a.key[1] - b.key[1] || a.index - b.index);

  const results = new Array<SyncItemResult>(invoices.length);
  let posted = false;
  let halted = false;
  for (const { index } of order) {
    const raw: unknown = invoices[index];
    const clientUuid = uuidOf(raw);
    if (halted) {
      results[index] = { client_uuid: clientUuid, ok: false, code: CODE_DEFERRED, message: "Not processed yet. It will be sent again." };
      continue;
    }
    const parsed = saleInputSchema.safeParse(raw);
    if (!parsed.success) {
      results[index] = { client_uuid: clientUuid, ok: false, code: "invalid", message: parsed.error.issues[0]?.message ?? "This bill could not be read" };
      continue;
    }
    try {
      const result = await postInvoice(ctx as AppContext, parsed.data, "pos_offline");
      if (result.ok) {
        posted ||= !result.duplicate;
        results[index] = {
          client_uuid: parsed.data.client_uuid,
          ok: true,
          invoiceId: result.invoiceId,
          invoiceNumber: result.invoiceNumber,
          duplicate: result.duplicate,
          warnings: result.warnings,
        };
      } else {
        // Only the code and message go back: never the device key, never the payload.
        results[index] = { client_uuid: parsed.data.client_uuid, ok: false, code: result.code, message: result.message };
        // A temporary failure: stop here so later numbers are not posted ahead of this one.
        if (result.code === "server_error") halted = true;
      }
    } catch (error) {
      console.error("[pos/sync] bill failed", error instanceof Error ? error.message : "unknown error");
      results[index] = { client_uuid: parsed.data.client_uuid, ok: false, code: "server_error", message: "Could not save the bill. It will be sent again." };
      halted = true;
    }
  }

  if (posted) {
    // Receipts for offline bills are queued when they sync; send them without making the till wait.
    after(async () => {
      try {
        await processDueNotifications();
      } catch (error) {
        console.error("[pos/sync] receipt processing failed", error instanceof Error ? error.message : "unknown error");
      }
    });
  }

  return Response.json({ results } satisfies SyncResponseBody, { headers: NO_STORE });
}
