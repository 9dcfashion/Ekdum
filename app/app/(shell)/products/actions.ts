"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, describeDbError, runAction, unwrap } from "@/lib/actions";
import type { AppContext } from "@/lib/auth/context";
import {
  IMPORT_CHUNK_SIZE,
  IMPORT_COLUMNS,
  IMPORT_MAX_ROWS,
  validateImportRows,
  type ImportChunkResult,
  type ImportRowResult,
  type ParsedImportRow,
  type RawImportRow,
  type RawImportValues,
} from "@/lib/products/import";
import { fetchAll, loadCategories, loadGstRates, loadUnits } from "@/lib/products/queries";
import {
  categorySchema,
  productIdSchema,
  productSchema,
  setProductActiveSchema,
} from "@/lib/validation/products";

const MANAGE = { perm: "products.manage" } as const;

interface DbResult<T> {
  data: T;
  error: { message?: string; code?: string; details?: string | null; hint?: string | null } | null;
}

/** Like unwrap(), but puts duplicate SKU / barcode errors on the right form field. */
function unwrapProduct<T>(result: DbResult<T>): T {
  if (result.error) {
    const message = describeDbError(result.error);
    const text = `${result.error.message ?? ""} ${result.error.details ?? ""}`;
    if (/products_sku_uniq/.test(text)) throw new ActionError(message, { sku: [message] });
    if (/products_barcode_uniq/.test(text)) throw new ActionError(message, { barcode: [message] });
    throw new ActionError(message);
  }
  return result.data;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ── Products ────────────────────────────────────────────────────────────────

export async function saveProductAction(input: unknown) {
  return runAction(productSchema, input, MANAGE, async (data, ctx) => {
    const [rates, units] = await Promise.all([loadGstRates(ctx), loadUnits(ctx)]);
    if (!rates.some((r) => r.rate === data.gst_rate)) {
      const message = "Select a GST rate from the list";
      throw new ActionError(message, { gst_rate: [message] });
    }
    if (!units.some((u) => u.code === data.unit_code)) {
      const message = "Select a unit from the list";
      throw new ActionError(message, { unit_code: [message] });
    }
    if (data.category_id) {
      const category = unwrap(
        await ctx.supabase
          .from("product_categories")
          .select("id")
          .eq("id", data.category_id)
          .eq("business_id", ctx.business.id)
          .maybeSingle(),
      );
      if (!category) {
        const message = "This category no longer exists";
        throw new ActionError(message, { category_id: [message] });
      }
    }

    const row = {
      name: data.name,
      sku: data.sku,
      barcode: data.barcode,
      category_id: data.category_id,
      hsn_code: data.hsn_code,
      unit_code: data.unit_code,
      gst_rate: data.gst_rate,
      cess_rate: data.cess_rate,
      sale_price_paise: data.sale_price,
      price_includes_tax: data.price_includes_tax,
      mrp_paise: data.mrp,
      track_inventory: data.track_inventory,
      low_stock_threshold: data.track_inventory ? data.low_stock_threshold : null,
      is_active: data.is_active,
    };

    const warnings: string[] = [];
    let id: string;
    const isNew = !data.id;

    if (data.id) {
      const updated = unwrapProduct(
        await ctx.supabase
          .from("products")
          .update(row)
          .eq("id", data.id)
          .eq("business_id", ctx.business.id)
          .select("id")
          .maybeSingle(),
      ) as { id: string } | null;
      if (!updated) throw new ActionError("This product no longer exists");
      id = updated.id;
    } else {
      const created = unwrapProduct(
        await ctx.supabase
          .from("products")
          .insert({ ...row, business_id: ctx.business.id, created_by: ctx.user.id })
          .select("id")
          .single(),
      ) as { id: string };
      id = created.id;
    }

    // Cost price lives in its own table and needs products.view_cost as well.
    if (ctx.can("products.view_cost") && (data.purchase_price !== null || !isNew)) {
      const { error } = await ctx.supabase.from("product_costs").upsert(
        {
          product_id: id,
          business_id: ctx.business.id,
          purchase_price_paise: data.purchase_price ?? 0,
          updated_by: ctx.user.id,
        },
        { onConflict: "product_id" },
      );
      if (error) warnings.push(`The purchase price was not saved: ${describeDbError(error)}`);
    }

    if (isNew && data.track_inventory && data.opening_stock?.length) {
      const allowed = new Set(ctx.outlets.map((o) => o.id));
      for (const entry of data.opening_stock) {
        if (!entry.quantity || Number(entry.quantity) <= 0 || !allowed.has(entry.outlet_id)) continue;
        const { error } = await ctx.supabase.rpc("set_opening_stock", {
          p_product_id: id,
          p_outlet_id: entry.outlet_id,
          p_quantity: entry.quantity,
        });
        if (error) {
          const outlet = ctx.outlets.find((o) => o.id === entry.outlet_id)?.name ?? "an outlet";
          warnings.push(`Opening stock for ${outlet} was not saved: ${describeDbError(error)}`);
        }
      }
    }

    revalidatePath("/app/products");
    revalidatePath(`/app/products/${id}`);
    return { id, warnings };
  });
}

export async function setProductActiveAction(input: unknown) {
  return runAction(setProductActiveSchema, input, MANAGE, async (data, ctx) => {
    const updated = unwrap(
      await ctx.supabase
        .from("products")
        .update({ is_active: data.is_active })
        .eq("id", data.id)
        .eq("business_id", ctx.business.id)
        .select("id")
        .maybeSingle(),
    );
    if (!updated) throw new ActionError("This product no longer exists");
    revalidatePath("/app/products");
    revalidatePath(`/app/products/${data.id}`);
    return { id: data.id, is_active: data.is_active };
  });
}

/** Hard delete. The database refuses when the product has bills or stock history. */
export async function deleteProductAction(input: unknown) {
  return runAction(productIdSchema, input, MANAGE, async (data, ctx) => {
    const { data: deleted, error } = await ctx.supabase
      .from("products")
      .delete()
      .eq("id", data.id)
      .eq("business_id", ctx.business.id)
      .select("id");
    if (error) {
      if (error.code === "23503" || /append-only|foreign key/i.test(error.message ?? "")) {
        throw new ActionError(
          "This product has bills or stock history, so it cannot be deleted. Deactivate it instead to hide it from billing.",
        );
      }
      throw new ActionError(describeDbError(error));
    }
    if (!deleted || deleted.length === 0) throw new ActionError("This product no longer exists");
    revalidatePath("/app/products");
    return { id: data.id };
  });
}

// ── Categories ──────────────────────────────────────────────────────────────

export async function saveCategoryAction(input: unknown) {
  return runAction(categorySchema, input, MANAGE, async (data, ctx) => {
    if (data.parent_id) {
      if (data.parent_id === data.id) {
        throw new ActionError("A category cannot be its own parent", { parent_id: ["Pick a different parent"] });
      }
      const parent = unwrap(
        await ctx.supabase
          .from("product_categories")
          .select("id, parent_id")
          .eq("id", data.parent_id)
          .eq("business_id", ctx.business.id)
          .maybeSingle(),
      ) as { id: string; parent_id: string | null } | null;
      if (!parent) throw new ActionError("The parent category no longer exists");
      if (parent.parent_id) {
        const message = "Categories can only be nested one level deep";
        throw new ActionError(message, { parent_id: [message] });
      }
      if (data.id) {
        const { count } = await ctx.supabase
          .from("product_categories")
          .select("id", { count: "exact", head: true })
          .eq("business_id", ctx.business.id)
          .eq("parent_id", data.id);
        if ((count ?? 0) > 0) {
          const message = "This category has sub-categories, so it cannot be moved under another category";
          throw new ActionError(message, { parent_id: [message] });
        }
      }
    }

    let row: { id: string; name: string; parent_id: string | null } | null;
    if (data.id) {
      row = unwrap(
        await ctx.supabase
          .from("product_categories")
          .update({ name: data.name, parent_id: data.parent_id })
          .eq("id", data.id)
          .eq("business_id", ctx.business.id)
          .select("id, name, parent_id")
          .maybeSingle(),
      );
      if (!row) throw new ActionError("This category no longer exists");
    } else {
      row = unwrap(
        await ctx.supabase
          .from("product_categories")
          .insert({
            name: data.name,
            parent_id: data.parent_id,
            business_id: ctx.business.id,
            created_by: ctx.user.id,
          })
          .select("id, name, parent_id")
          .single(),
      );
    }
    revalidatePath("/app/products", "layout");
    return row as { id: string; name: string; parent_id: string | null };
  });
}

/** Products in the category become uncategorised; sub-categories move to the top level (FK set null). */
export async function deleteCategoryAction(input: unknown) {
  return runAction(productIdSchema, input, MANAGE, async (data, ctx) => {
    const deleted = unwrap(
      await ctx.supabase
        .from("product_categories")
        .delete()
        .eq("id", data.id)
        .eq("business_id", ctx.business.id)
        .select("id"),
    ) as { id: string }[] | null;
    if (!deleted || deleted.length === 0) throw new ActionError("This category no longer exists");
    revalidatePath("/app/products", "layout");
    return { id: data.id };
  });
}

// ── CSV import ──────────────────────────────────────────────────────────────

/** Every SKU already used in the business, so the preview can count new products vs updates. */
export async function getExistingSkusAction() {
  return runAction(z.object({}), {}, MANAGE, async (_data, ctx) => {
    const rows = await fetchAll<{ sku: string }>((from, to) =>
      ctx.supabase
        .from("products")
        .select("sku")
        .eq("business_id", ctx.business.id)
        .not("sku", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    );
    return rows.map((r) => r.sku);
  });
}

const importChunkSchema = z.object({
  rows: z
    .array(
      z.object({
        row: z.number().int().min(2).max(1_000_000),
        values: z.record(z.string(), z.string().max(500)),
      }),
    )
    .min(1, "There is nothing to import")
    .max(IMPORT_CHUNK_SIZE, `Send at most ${IMPORT_CHUNK_SIZE} rows at a time`),
  /** Total rows in the file, for the overall cap. */
  total: z.number().int().min(1).max(IMPORT_MAX_ROWS, `A file can have at most ${IMPORT_MAX_ROWS} products`),
});

function productPatch(r: ParsedImportRow, categoryId: string | null): Record<string, unknown> {
  // Blank cells are left out: new products get the database default and
  // existing products keep their current value.
  const patch: Record<string, unknown> = { name: r.name, sale_price_paise: r.sale_price_paise };
  if (r.sku !== null) patch.sku = r.sku;
  if (r.barcode !== null) patch.barcode = r.barcode;
  if (categoryId !== null) patch.category_id = categoryId;
  if (r.hsn_code !== null) patch.hsn_code = r.hsn_code;
  if (r.unit_code !== null) patch.unit_code = r.unit_code;
  if (r.gst_rate !== null) patch.gst_rate = r.gst_rate;
  if (r.cess_rate !== null) patch.cess_rate = r.cess_rate;
  if (r.price_includes_tax !== null) patch.price_includes_tax = r.price_includes_tax;
  if (r.mrp_paise !== null) patch.mrp_paise = r.mrp_paise;
  if (r.track_inventory !== null) patch.track_inventory = r.track_inventory;
  if (r.low_stock_threshold !== null) patch.low_stock_threshold = r.low_stock_threshold;
  return patch;
}

/** Find or create the categories named in the rows. Returns lower-cased name → id. */
async function resolveCategories(ctx: AppContext, names: string[]): Promise<Map<string, string>> {
  const index = async () => {
    const map = new Map<string, string>();
    const categories = await loadCategories(ctx);
    // Top-level categories win when a sub-category has the same name.
    for (const c of categories) if (c.parent_id) map.set(c.name.trim().toLowerCase(), c.id);
    for (const c of categories) if (!c.parent_id) map.set(c.name.trim().toLowerCase(), c.id);
    return map;
  };

  let map = await index();
  const missing = new Map<string, string>();
  for (const name of names) {
    const key = name.toLowerCase();
    if (!map.has(key) && !missing.has(key)) missing.set(key, name);
  }
  if (missing.size > 0) {
    const { error } = await ctx.supabase.from("product_categories").insert(
      [...missing.values()].map((name) => ({
        name,
        parent_id: null,
        business_id: ctx.business.id,
        created_by: ctx.user.id,
      })),
    );
    if (error) {
      // Most likely someone else created one of them a moment ago: add what is still missing one at a time.
      map = await index();
      for (const [key, name] of missing) {
        if (map.has(key)) continue;
        await ctx.supabase
          .from("product_categories")
          .insert({ name, parent_id: null, business_id: ctx.business.id, created_by: ctx.user.id });
      }
    }
    map = await index();
  }
  return map;
}

/**
 * Import one chunk of CSV rows. Re-validates everything, updates products whose
 * SKU already exists and creates the rest. Returns one result per row.
 */
export async function importProductsChunkAction(input: unknown) {
  return runAction(importChunkSchema, input, MANAGE, async (data, ctx): Promise<ImportChunkResult> => {
    const canCost = ctx.can("products.view_cost");
    const results = new Map<number, ImportRowResult>();
    const setResult = (r: ImportRowResult) => results.set(r.row, r);

    const rawRows: RawImportRow[] = data.rows.map((r) => {
      const values: RawImportValues = {};
      for (const col of IMPORT_COLUMNS) {
        const v = r.values[col];
        if (typeof v === "string") values[col] = v;
      }
      return { row: r.row, values };
    });
    if (new Set(rawRows.map((r) => r.row)).size !== rawRows.length) {
      throw new ActionError("The file was not read correctly. Please choose it again.");
    }

    const [rates, units] = await Promise.all([loadGstRates(ctx), loadUnits(ctx)]);
    const validation = validateImportRows(rawRows, {
      units: units.filter((u) => u.is_active).map((u) => ({ code: u.code, name: u.name })),
      gstRates: rates.filter((r) => r.is_active).map((r) => r.rate),
    });

    const messagesByRow = new Map<number, string[]>();
    for (const e of validation.errors) {
      const list = messagesByRow.get(e.row) ?? [];
      list.push(e.message);
      messagesByRow.set(e.row, list);
    }
    for (const [row, messages] of messagesByRow) setResult({ row, status: "failed", message: messages.join(" ") });

    // Existing SKUs and barcodes of the business (a few thousand short strings at most).
    const existing = await fetchAll<{ id: string; sku: string | null; barcode: string | null }>((from, to) =>
      ctx.supabase
        .from("products")
        .select("id, sku, barcode")
        .eq("business_id", ctx.business.id)
        .or("sku.not.is.null,barcode.not.is.null")
        .order("id", { ascending: true })
        .range(from, to),
    );
    const idBySku = new Map<string, string>();
    const idByBarcode = new Map<string, string>();
    for (const p of existing) {
      if (p.sku) idBySku.set(p.sku, p.id);
      if (p.barcode) idByBarcode.set(p.barcode, p.id);
    }

    interface Planned {
      row: ParsedImportRow;
      id: string;
      isNew: boolean;
    }
    const planned: Planned[] = [];
    for (const row of validation.valid) {
      const existingId = row.sku ? idBySku.get(row.sku) : undefined;
      const barcodeOwner = row.barcode ? idByBarcode.get(row.barcode) : undefined;
      if (barcodeOwner && barcodeOwner !== existingId) {
        setResult({ row: row.row, status: "failed", message: "Another product already uses this barcode" });
        continue;
      }
      planned.push({ row, id: existingId ?? randomUUID(), isNew: !existingId });
    }

    const categoryNames = planned.map((p) => p.row.category).filter((c): c is string => !!c);
    const categoryIds = categoryNames.length > 0 ? await resolveCategories(ctx, categoryNames) : new Map<string, string>();

    const ready: Array<Planned & { patch: Record<string, unknown> }> = [];
    for (const p of planned) {
      let categoryId: string | null = null;
      if (p.row.category) {
        categoryId = categoryIds.get(p.row.category.toLowerCase()) ?? null;
        if (!categoryId) {
          setResult({ row: p.row.row, status: "failed", message: `Could not create the category "${p.row.category}"` });
          continue;
        }
      }
      ready.push({ ...p, patch: productPatch(p.row, categoryId) });
    }

    const saved: Planned[] = [];

    // New products: one bulk insert; if it fails, insert one by one to find the bad rows.
    const inserts = ready.filter((p) => p.isNew);
    const insertRow = (p: (typeof ready)[number]) => ({
      ...p.patch,
      id: p.id,
      business_id: ctx.business.id,
      created_by: ctx.user.id,
    });
    if (inserts.length > 0) {
      const bulk = await ctx.supabase.from("products").insert(inserts.map(insertRow), { defaultToNull: false });
      if (!bulk.error) {
        for (const p of inserts) {
          saved.push(p);
          setResult({ row: p.row.row, status: "created" });
        }
      } else {
        await mapLimit(inserts, 8, async (p) => {
          const { error } = await ctx.supabase.from("products").insert(insertRow(p));
          if (error) setResult({ row: p.row.row, status: "failed", message: describeDbError(error) });
          else {
            saved.push(p);
            setResult({ row: p.row.row, status: "created" });
          }
        });
      }
    }

    // Existing products (matched by SKU): update only the columns the file filled in.
    await mapLimit(
      ready.filter((p) => !p.isNew),
      8,
      async (p) => {
        const { data: updated, error } = await ctx.supabase
          .from("products")
          .update(p.patch)
          .eq("id", p.id)
          .eq("business_id", ctx.business.id)
          .select("id");
        if (error) setResult({ row: p.row.row, status: "failed", message: describeDbError(error) });
        else if (!updated || updated.length === 0) {
          setResult({ row: p.row.row, status: "failed", message: "This product could not be updated" });
        } else {
          saved.push(p);
          setResult({ row: p.row.row, status: "updated" });
        }
      },
    );

    const note = (row: number, message: string) => {
      const current = results.get(row);
      if (current) setResult({ ...current, message: current.message ? `${current.message} ${message}` : message });
    };

    // Purchase prices: only for users who are allowed to see cost.
    if (canCost) {
      const costs = saved.filter((p) => p.row.purchase_price_paise !== null);
      if (costs.length > 0) {
        const { error } = await ctx.supabase.from("product_costs").upsert(
          costs.map((p) => ({
            product_id: p.id,
            business_id: ctx.business.id,
            purchase_price_paise: p.row.purchase_price_paise,
            updated_by: ctx.user.id,
          })),
          { onConflict: "product_id" },
        );
        if (error) {
          for (const p of costs) note(p.row.row, `Purchase price was not saved: ${describeDbError(error)}`);
        }
      }
    }

    // Opening stock: new products only, into the active outlet.
    const outlet = ctx.outlet;
    const withStock = saved.filter(
      (p) => p.isNew && p.row.opening_stock !== null && Number(p.row.opening_stock) > 0 && p.row.track_inventory !== false,
    );
    if (withStock.length > 0) {
      if (!outlet) {
        for (const p of withStock) note(p.row.row, "Opening stock was not set because no outlet is selected.");
      } else {
        await mapLimit(withStock, 8, async (p) => {
          const { error } = await ctx.supabase.rpc("set_opening_stock", {
            p_product_id: p.id,
            p_outlet_id: outlet.id,
            p_quantity: p.row.opening_stock,
          });
          if (error) note(p.row.row, `Opening stock was not set: ${describeDbError(error)}`);
        });
      }
    }

    revalidatePath("/app/products");
    return {
      results: rawRows.map(
        (r) => results.get(r.row) ?? { row: r.row, status: "failed" as const, message: "This row was not imported" },
      ),
    };
  });
}
