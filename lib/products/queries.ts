import "server-only";
import type { AppContext } from "@/lib/auth/context";
import type { GstRate, ProductCategory, Unit } from "@/lib/types/db";

type Ctx = Pick<AppContext, "supabase" | "business">;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

const FETCH_PAGE = 1000;
const FETCH_MAX_PAGES = 50;

/**
 * Read every row of a query, page by page (PostgREST caps a single response).
 * `page(from, to)` must apply a stable order and `.range(from, to)`.
 */
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<PageResult<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < FETCH_MAX_PAGES; i++) {
    const { data, error } = await page(rows.length, rows.length + FETCH_PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    // A short page does not prove the end (the server may cap below our page
    // size), so keep going until a page comes back empty.
  }
  return rows;
}

export async function loadGstRates(ctx: Ctx): Promise<GstRate[]> {
  const { data } = await ctx.supabase
    .from("gst_rates")
    .select("id, rate, label, is_active, sort_order")
    .order("sort_order", { ascending: true });
  return ((data ?? []) as GstRate[]).map((r) => ({ ...r, rate: Number(r.rate) }));
}

export async function loadUnits(ctx: Ctx): Promise<Unit[]> {
  const { data } = await ctx.supabase
    .from("units")
    .select("code, name, allow_decimal, is_active, sort_order")
    .order("sort_order", { ascending: true });
  return (data ?? []) as Unit[];
}

export async function loadCategories(ctx: Ctx): Promise<ProductCategory[]> {
  const { data } = await ctx.supabase
    .from("product_categories")
    .select("id, business_id, name, parent_id")
    .eq("business_id", ctx.business.id)
    .order("name", { ascending: true })
    .limit(2000);
  return (data ?? []) as ProductCategory[];
}

export interface CategoryOption {
  id: string;
  /** "Parent › Child" for sub-categories. */
  label: string;
  parent_id: string | null;
}

/** Flat list for a <select>: each top-level category followed by its children. */
export function categoryOptions(categories: ProductCategory[]): CategoryOption[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const isTop = (c: ProductCategory) => !c.parent_id || !byId.has(c.parent_id);
  const options: CategoryOption[] = [];
  for (const top of categories.filter(isTop)) {
    options.push({ id: top.id, label: top.name, parent_id: null });
    for (const child of categories.filter((c) => c.parent_id === top.id)) {
      options.push({ id: child.id, label: `${top.name} › ${child.name}`, parent_id: top.id });
    }
  }
  return options;
}
