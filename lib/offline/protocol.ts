/** The wire format of POST /api/pos/sync, shared by the route handler and the client engine. */
import type { SaleInput } from "@/lib/validation/sales";

export const SYNC_ENDPOINT = "/api/pos/sync";
export const SYNC_BATCH_MAX = 25;
/** 25 bills of 300 lines each still fit comfortably. */
export const SYNC_BODY_MAX_BYTES = 4 * 1024 * 1024;

export interface SyncRequestBody {
  /** The business these bills belong to. The server refuses the batch if the session is on another one. */
  business_id: string;
  invoices: SaleInput[];
}

export interface SyncItemResult {
  client_uuid: string;
  ok: boolean;
  invoiceId?: string;
  invoiceNumber?: string;
  duplicate?: boolean;
  warnings?: Array<{ code: string; message: string }>;
  code?: string;
  message?: string;
}

export interface SyncResponseBody {
  results: SyncItemResult[];
}

/** Envelope-level failures (the batch was not processed at all). */
export type SyncErrorCode = "unauthorized" | "business_mismatch" | "rate_limited" | "invalid_request" | "too_large" | "not_ready";

/** A bill the server did not get to because an earlier one in the batch hit a temporary error. */
export const CODE_DEFERRED = "deferred";

/**
 * The service worker asks for /app/pos with this header to get the "shell": the
 * same page with no products in it, which is what it keeps for starting offline.
 */
export const POS_SHELL_HEADER = "x-ekdum-shell";
