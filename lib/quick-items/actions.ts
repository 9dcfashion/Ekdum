"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, runAction, unwrap } from "@/lib/actions";
import type { AppContext } from "@/lib/auth/context";
import { uuid } from "@/lib/validation/common";
import { quickItemSchema } from "@/lib/validation/quick-items";
import { findPack, missingFromPack } from "./packs";

const MANAGE = ["products.manage", "settings.manage"] as const;

function refresh() {
  revalidatePath("/app/settings/quick-items");
  revalidatePath("/app/pos");
}

async function assertRateAndUnit(ctx: AppContext, gstRate: number, unitCode: string) {
  const [rates, units] = await Promise.all([
    ctx.supabase.from("gst_rates").select("rate").eq("is_active", true),
    ctx.supabase.from("units").select("code").eq("code", unitCode).eq("is_active", true),
  ]);
  if (!((rates.data ?? []) as Array<{ rate: number }>).some((r) => Number(r.rate) === gstRate)) {
    throw new ActionError("Pick a GST rate from the list", { gst_rate: ["Pick a GST rate from the list"] });
  }
  if (!(units.data ?? []).length) throw new ActionError("Pick a unit from the list", { unit_code: ["Pick a unit from the list"] });
}

async function nextSortOrder(ctx: AppContext): Promise<number> {
  const { data } = await ctx.supabase
    .from("quick_items")
    .select("sort_order")
    .eq("business_id", ctx.business.id)
    .order("sort_order", { ascending: false })
    .limit(1);
  return ((data?.[0]?.sort_order as number | undefined) ?? 0) + 10;
}

/** Add every item of a ready-made set that the shop does not have yet. Also used during onboarding. */
export async function addQuickItemPackAction(input: unknown) {
  return runAction(z.object({ pack: z.string().min(1).max(40) }), input, { perm: MANAGE, allowDuringOnboarding: true }, async (data, ctx) => {
    const pack = findPack(data.pack);
    if (!pack) throw new ActionError("Unknown set");
    const { data: existing } = await ctx.supabase.from("quick_items").select("name").eq("business_id", ctx.business.id);
    const missing = missingFromPack(pack, ((existing ?? []) as Array<{ name: string }>).map((r) => r.name));
    if (missing.length === 0) return { added: 0 };
    let order = await nextSortOrder(ctx);
    unwrap(
      await ctx.supabase.from("quick_items").insert(
        missing.map((t) => ({
          business_id: ctx.business.id,
          name: t.name,
          gst_rate: t.gstRate,
          hsn_code: t.hsnCode,
          unit_code: t.unitCode,
          price_includes_tax: t.priceIncludesTax,
          sort_order: (order += 10),
          created_by: ctx.user.id,
        })),
      ),
    );
    refresh();
    return { added: missing.length };
  });
}

export async function saveQuickItemAction(input: unknown) {
  return runAction(quickItemSchema, input, { perm: MANAGE }, async (data, ctx) => {
    await assertRateAndUnit(ctx, data.gst_rate, data.unit_code);
    const row = {
      name: data.name.replace(/\s+/g, " "),
      gst_rate: data.gst_rate,
      hsn_code: data.hsn_code,
      unit_code: data.unit_code,
      price_includes_tax: data.price_includes_tax,
      default_rate_paise: data.default_rate && data.default_rate > 0 ? data.default_rate : null,
      is_active: data.is_active,
    };
    if (data.id) {
      unwrap(await ctx.supabase.from("quick_items").update(row).eq("id", data.id).eq("business_id", ctx.business.id).select("id").single());
    } else {
      unwrap(
        await ctx.supabase
          .from("quick_items")
          .insert({ ...row, business_id: ctx.business.id, sort_order: await nextSortOrder(ctx), created_by: ctx.user.id })
          .select("id")
          .single(),
      );
    }
    refresh();
  });
}

export async function setQuickItemActiveAction(input: unknown) {
  return runAction(z.object({ id: uuid, is_active: z.boolean() }), input, { perm: MANAGE }, async (data, ctx) => {
    unwrap(await ctx.supabase.from("quick_items").update({ is_active: data.is_active }).eq("id", data.id).eq("business_id", ctx.business.id));
    refresh();
  });
}

export async function deleteQuickItemAction(input: unknown) {
  return runAction(z.object({ id: uuid }), input, { perm: MANAGE }, async (data, ctx) => {
    // Past bills keep their own copy of the item name, GST and HSN, so deleting is always safe.
    unwrap(await ctx.supabase.from("quick_items").delete().eq("id", data.id).eq("business_id", ctx.business.id));
    refresh();
  });
}

/** Move an item one place up or down in the order shown at the counter. */
export async function moveQuickItemAction(input: unknown) {
  return runAction(z.object({ id: uuid, direction: z.enum(["up", "down"]) }), input, { perm: MANAGE }, async (data, ctx) => {
    const rows = unwrap(
      await ctx.supabase
        .from("quick_items")
        .select("id, sort_order")
        .eq("business_id", ctx.business.id)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
    ) as Array<{ id: string; sort_order: number }>;
    const index = rows.findIndex((r) => r.id === data.id);
    const swapWith = data.direction === "up" ? index - 1 : index + 1;
    if (index < 0 || swapWith < 0 || swapWith >= rows.length) return;
    // Renumber the whole list so equal sort orders can never get stuck.
    const ordered = [...rows];
    [ordered[index], ordered[swapWith]] = [ordered[swapWith], ordered[index]];
    await Promise.all(
      ordered.map((r, i) =>
        r.sort_order === (i + 1) * 10
          ? null
          : ctx.supabase.from("quick_items").update({ sort_order: (i + 1) * 10 }).eq("id", r.id).eq("business_id", ctx.business.id),
      ),
    );
    refresh();
  });
}
