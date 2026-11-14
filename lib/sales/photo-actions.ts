"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, runAction, unwrap } from "@/lib/actions";
import { BUCKETS, UPLOAD_LIMITS } from "@/lib/storage";

const attachSchema = z.object({
  invoice_id: z.uuid(),
  paths: z.array(z.string().min(10).max(300)).min(1).max(UPLOAD_LIMITS.salePhoto.maxPerBill),
});

/**
 * Record photos (already uploaded to the sale-photos bucket by the browser) against a bill.
 * RLS decides who may: anyone with sales.create on a posted bill they can see.
 */
export async function attachSalePhotosAction(input: unknown) {
  return runAction(attachSchema, input, { perm: "sales.create" }, async (data, ctx) => {
    const prefix = `${ctx.business.id}/${data.invoice_id}/`;
    if (data.paths.some((p) => !p.startsWith(prefix) || p.includes(".."))) {
      throw new ActionError("That photo does not belong to this bill");
    }
    unwrap(
      await ctx.supabase.from("sales_invoice_photos").insert(
        data.paths.map((storage_path) => ({
          business_id: ctx.business.id,
          invoice_id: data.invoice_id,
          storage_path,
          created_by: ctx.user.id,
        })),
      ),
    );
    revalidatePath(`/app/sales/${data.invoice_id}`);
    return { count: data.paths.length };
  });
}

const deleteSchema = z.object({ photo_id: z.uuid() });

/** Owners and managers only (sales.cancel). The database writes the removal to the audit log. */
export async function deleteSalePhotoAction(input: unknown) {
  return runAction(deleteSchema, input, { perm: "sales.cancel" }, async (data, ctx) => {
    const row = unwrap(
      await ctx.supabase
        .from("sales_invoice_photos")
        .delete()
        .eq("id", data.photo_id)
        .eq("business_id", ctx.business.id)
        .select("invoice_id, storage_path")
        .maybeSingle(),
    ) as { invoice_id: string; storage_path: string } | null;
    if (!row) throw new ActionError("Photo not found");
    // The record is gone either way; a leftover file is harmless and invisible without its row.
    await ctx.supabase.storage.from(BUCKETS.salePhotos).remove([row.storage_path]);
    revalidatePath(`/app/sales/${row.invoice_id}`);
  });
}
