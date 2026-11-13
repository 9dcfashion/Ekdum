import "server-only";
import type { AppContext } from "@/lib/auth/context";

/** PostgREST caps a response at 1000 rows by default; read bigger sets in chunks. */
const CHUNK = 1000;
const MAX_CHUNKS = 20;

/**
 * Outstanding due per customer, for the given customers only.
 * Sums `amount_due_paise` over the posted bills the signed-in user may see (RLS applies).
 */
export async function loadCustomerDues(ctx: AppContext, customerIds: string[]): Promise<Map<string, number>> {
  const dues = new Map<string, number>();
  if (customerIds.length === 0) return dues;
  for (let chunk = 0; chunk < MAX_CHUNKS; chunk++) {
    const { data, error } = await ctx.supabase
      .from("sales_invoices")
      .select("customer_id, amount_due_paise")
      .eq("business_id", ctx.business.id)
      .eq("status", "posted")
      .gt("amount_due_paise", 0)
      .in("customer_id", customerIds)
      .order("id")
      .range(chunk * CHUNK, chunk * CHUNK + CHUNK - 1);
    if (error) break; // e.g. no permission to see bills: show no dues rather than fail the page
    const rows = (data ?? []) as { customer_id: string; amount_due_paise: number }[];
    for (const row of rows) dues.set(row.customer_id, (dues.get(row.customer_id) ?? 0) + Number(row.amount_due_paise));
    if (rows.length < CHUNK) break;
  }
  return dues;
}

export interface CustomerTotals {
  billCount: number;
  spentPaise: number;
  duePaise: number;
  /** True when the customer has more bills than we add up in one request. */
  truncated: boolean;
}

/** Bill count, total spent and outstanding due over a customer's posted bills (as visible to this user). */
export async function loadCustomerTotals(ctx: AppContext, customerId: string): Promise<CustomerTotals> {
  const totals: CustomerTotals = { billCount: 0, spentPaise: 0, duePaise: 0, truncated: false };
  for (let chunk = 0; chunk < MAX_CHUNKS; chunk++) {
    const { data, error } = await ctx.supabase
      .from("sales_invoices")
      .select("total_paise, amount_due_paise")
      .eq("business_id", ctx.business.id)
      .eq("customer_id", customerId)
      .eq("status", "posted")
      .order("id")
      .range(chunk * CHUNK, chunk * CHUNK + CHUNK - 1);
    if (error) break;
    const rows = (data ?? []) as { total_paise: number; amount_due_paise: number }[];
    for (const row of rows) {
      totals.billCount += 1;
      totals.spentPaise += Number(row.total_paise);
      totals.duePaise += Number(row.amount_due_paise);
    }
    if (rows.length < CHUNK) return totals;
  }
  totals.truncated = true;
  return totals;
}
