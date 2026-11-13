"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, runAction, unwrap, type ActionResult } from "@/lib/actions";
import { uuid } from "@/lib/validation/common";
import { cancelInvoiceSchema, collectionSchema, creditNoteSchema } from "@/lib/validation/sales";

function refresh(invoiceId: string) {
  revalidatePath("/app/sales");
  revalidatePath(`/app/sales/${invoiceId}`);
}

/** Cancel a posted bill. The database checks the permission, the cancel window and puts the stock back. */
export async function cancelInvoiceAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(cancelInvoiceSchema, input, { perm: "sales.cancel" }, async (data, ctx) => {
    unwrap(await ctx.supabase.rpc("cancel_sales_invoice", { p_invoice_id: data.invoice_id, p_reason: data.reason }));
    refresh(data.invoice_id);
    return null;
  });
}

/** Issue a credit note for returned items. Returns the new credit note's id. */
export async function createCreditNoteAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(creditNoteSchema, input, { perm: "sales.credit_note" }, async (data, ctx) => {
    const id = unwrap(
      await ctx.supabase.rpc("create_credit_note", {
        p_invoice_id: data.invoice_id,
        p_items: data.items.map((i) => ({ invoice_item_id: i.invoice_item_id, quantity: i.quantity })),
        p_reason: data.reason,
        p_restock: data.restock,
        p_refund_mode: data.refund_mode,
      }),
    ) as string | null;
    if (!id) throw new ActionError("The credit note could not be created");
    refresh(data.invoice_id);
    return { id };
  });
}

/** Record money collected later against a credit sale. */
export async function recordCollectionAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(collectionSchema, input, { perm: "sales.create" }, async (data, ctx) => {
    unwrap(
      await ctx.supabase.rpc("record_sale_collection", {
        p_invoice_id: data.invoice_id,
        p_mode: data.mode,
        p_amount_paise: data.amount_paise,
        p_reference: data.reference,
      }),
    );
    refresh(data.invoice_id);
    return null;
  });
}

const publicLinkSchema = z.object({ invoice_id: uuid, enabled: z.boolean() });

/** Owner only: switch the public /i/{token} link of a bill off or back on. */
export async function setPublicLinkAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(publicLinkSchema, input, { perm: "settings.manage" }, async (data, ctx) => {
    unwrap(await ctx.supabase.rpc("set_invoice_public_link", { p_invoice_id: data.invoice_id, p_enabled: data.enabled }));
    refresh(data.invoice_id);
    return null;
  });
}
