import "server-only";
import type { z } from "zod";
import { unstable_rethrow } from "next/navigation";
import { loadContext, type AppContext } from "@/lib/auth/context";
import type { Permission } from "@/lib/auth/permissions";

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export function ok(): ActionResult<undefined>;
export function ok<T>(data: T, message?: string): ActionResult<T>;
export function ok<T>(data?: T, message?: string): ActionResult<T | undefined> {
  return { ok: true, data, message };
}

export function fail(error: string, fieldErrors?: Record<string, string[]>): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

/** Thrown inside an action to return a clean message to the user. */
export class ActionError extends Error {
  constructor(
    message: string,
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ActionError";
  }
}

interface PgLikeError {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

const UNIQUE_MESSAGES: Array<[RegExp, string]> = [
  [/products_sku_uniq/, "Another product already uses this SKU"],
  [/products_barcode_uniq/, "Another product already uses this barcode"],
  [/customers_phone_uniq/, "A customer with this phone number already exists"],
  [/vendors_gstin_uniq/, "A vendor with this GSTIN already exists"],
  [/outlets_business_id_name_key/, "An outlet with this name already exists"],
  [/roles_business_id_name_key/, "A role with this name already exists"],
  [/product_categories_name_uniq/, "A category with this name already exists"],
  [/invoice_series_business_id_prefix_financial_year_key/, "This prefix is already used by another series"],
  [/invoice_series_server_uniq/, "This outlet already has an active series of this type"],
  [/courier_partners_name_uniq/, "A courier partner with this name already exists"],
  [/purchase_bills_vendor_invoice_uniq/, "This vendor invoice number has already been entered for this financial year"],
  [/sales_invoices_number_uniq/, "This bill number has already been used"],
  [/business_members_business_id_user_id_key/, "This person is already a member of the business"],
];

/** Turn a Supabase/Postgres error into something a shop owner can read. */
export function describeDbError(error: PgLikeError | null | undefined): string {
  if (!error) return "Something went wrong";
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  if (error.code === "23505") {
    for (const [pattern, message] of UNIQUE_MESSAGES) if (pattern.test(text)) return message;
    return "This already exists";
  }
  if (error.code === "42501" || /row-level security|permission denied/i.test(text)) {
    return "You don't have permission to do this";
  }
  if (error.code === "23503") return "This is used elsewhere and cannot be removed";
  if (error.code === "23514") return "Some values are not valid. Please check the form.";
  if (error.code === "22P02" || error.code === "22003") return "Some values are not in the right format";
  if (error.code === "P0001" && error.message) return error.message; // RAISE EXCEPTION from our own functions
  if (/fetch failed|ECONNREFUSED|network/i.test(text)) return "Could not reach the server. Check your connection.";
  return error.message || "Something went wrong";
}

/** Throw an ActionError when a Supabase call returned an error. */
export function unwrap<T>(result: { data: T; error: PgLikeError | null }): T {
  if (result.error) throw new ActionError(describeDbError(result.error));
  return result.data;
}

type FullContext = AppContext;

/**
 * The standard shape of every Server Action:
 *   1. the user must be signed in and belong to the active business,
 *   2. the input is validated with Zod,
 *   3. the permission is checked on the server (never trusting the client),
 *   4. then the write runs (under RLS as that user).
 */
export async function runAction<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  opts: { perm?: Permission | readonly Permission[]; allowDuringOnboarding?: boolean },
  fn: (data: z.output<S>, ctx: FullContext) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const ctx = await loadContext();
    if (!ctx) return fail("Your session has expired. Please sign in again.");
    if (!ctx.business || !ctx.role || !ctx.memberId) return fail("Set up your business first.");
    if (!opts.allowDuringOnboarding && !ctx.business.onboarding_completed_at) {
      return fail("Finish setting up your business first.");
    }
    if (opts.perm && !ctx.can(opts.perm)) return fail("You don't have permission to do this");

    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "_form";
        (fieldErrors[key] ??= []).push(issue.message);
      }
      const first = parsed.error.issues[0];
      return fail(first ? first.message : "Please check the form", fieldErrors);
    }

    const data = await fn(parsed.data, ctx as FullContext);
    return { ok: true, data };
  } catch (error) {
    // redirect() and notFound() work by throwing; let Next.js handle them.
    unstable_rethrow(error);
    if (error instanceof ActionError) return fail(error.message, error.fieldErrors);
    console.error("[action] unexpected error", error instanceof Error ? error.message : error);
    return fail("Something went wrong. Please try again.");
  }
}
