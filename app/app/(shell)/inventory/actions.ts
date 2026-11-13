"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, runAction, unwrap } from "@/lib/actions";
import { AdjustmentError, adjustmentDelta } from "@/lib/inventory/ledger";
import { adjustStockSchema, type StockProductOption } from "@/lib/inventory/validation";
import { ilikeTerm } from "@/lib/list";
import { uuid } from "@/lib/validation/common";

const levelSchema = z.object({ product_id: uuid, outlet_id: uuid });

/**
 * Stock adjustment. The database function `adjust_stock` checks the permission and
 * outlet access again, insists on a reason, applies the negative-stock rule and
 * writes the audit log entry.
 */
export async function adjustStockAction(input: unknown) {
  return runAction(adjustStockSchema, input, { perm: "inventory.adjust" }, async (data, ctx) => {
    if (!ctx.outlets.some((o) => o.id === data.outlet_id)) {
      throw new ActionError("Choose an outlet you have access to", { outlet_id: ["Choose an outlet you have access to"] });
    }
    const product = unwrap(
      await ctx.supabase
        .from("products")
        .select("id, name, track_inventory")
        .eq("id", data.product_id)
        .eq("business_id", ctx.business.id)
        .maybeSingle(),
    ) as { id: string; name: string; track_inventory: boolean } | null;
    if (!product) throw new ActionError("Product not found", { product_id: ["Choose a product"] });
    if (!product.track_inventory) throw new ActionError("Stock is not tracked for this product");

    // For "I counted N", the difference is worked out here from the live level, not from what the browser last saw.
    let current: number | string = 0;
    if (data.mode === "set") {
      const level = unwrap(
        await ctx.supabase.from("stock_levels").select("quantity").eq("product_id", product.id).eq("outlet_id", data.outlet_id).maybeSingle(),
      ) as { quantity: number | string } | null;
      current = level?.quantity ?? 0;
    }
    let delta: string;
    try {
      delta = adjustmentDelta({ mode: data.mode, quantity: data.quantity, direction: data.direction, current });
    } catch (error) {
      if (error instanceof AdjustmentError) throw new ActionError(error.message, { quantity: [error.message] });
      throw error;
    }

    unwrap(
      await ctx.supabase.rpc("adjust_stock", {
        p_outlet_id: data.outlet_id,
        p_product_id: product.id,
        p_quantity_delta: delta,
        p_reason: data.reason,
        p_note: data.note,
      }),
    );
    revalidatePath("/app/inventory");
    revalidatePath(`/app/inventory/${product.id}`);
    return { delta };
  });
}

/** Current stock of one product at one outlet (for the adjustment dialog's preview). */
export async function getStockLevelAction(input: unknown) {
  return runAction(levelSchema, input, { perm: "inventory.view" }, async (data, ctx) => {
    if (!ctx.outlets.some((o) => o.id === data.outlet_id)) throw new ActionError("Choose an outlet you have access to");
    const level = unwrap(
      await ctx.supabase
        .from("stock_levels")
        .select("quantity")
        .eq("business_id", ctx.business.id)
        .eq("product_id", data.product_id)
        .eq("outlet_id", data.outlet_id)
        .maybeSingle(),
    ) as { quantity: number | string } | null;
    return { quantity: String(level?.quantity ?? 0) };
  });
}

/** Products with stock tracking, for the adjustment dialog's product search. */
export async function searchStockProductsAction(input: unknown) {
  return runAction(z.object({ q: z.string().trim().max(100) }), input, { perm: "inventory.adjust" }, async ({ q }, ctx): Promise<StockProductOption[]> => {
    const term = ilikeTerm(q);
    if (!term) return [];
    const rows = unwrap(
      await ctx.supabase
        .from("products")
        .select("id, name, sku, unit_code")
        .eq("business_id", ctx.business.id)
        .eq("track_inventory", true)
        .eq("is_active", true)
        .or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%`)
        .order("name")
        .limit(8),
    );
    return (rows ?? []) as StockProductOption[];
  });
}
