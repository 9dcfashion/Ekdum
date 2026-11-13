import { z } from "zod";
import {
  hsnOptional,
  percentRequired,
  quantityOptional,
  requiredText,
  rupeesOptional,
  rupeesRequired,
  uuid,
  uuidOptional,
} from "./common";

const shortCodeOptional = (label: string) =>
  z
    .string()
    .trim()
    .max(64, `${label} is too long (64 characters at most)`)
    .nullish()
    .transform((v) => (v ? v : null));

/** Blank means 0%. */
const percentOrZero = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v === null || v === undefined || String(v).trim() === "" ? 0 : v))
  .pipe(percentRequired);

export const openingStockEntrySchema = z.object({
  outlet_id: uuid,
  quantity: quantityOptional,
});

/**
 * Product create / edit. Used by the form (as the resolver) and by the Server
 * Action. Money fields are rupee strings in the form and integer paise after parsing.
 */
export const productSchema = z.object({
  /** Present when editing. */
  id: uuidOptional,
  name: requiredText("Product name", 150),
  sku: shortCodeOptional("SKU"),
  barcode: shortCodeOptional("Barcode"),
  category_id: uuidOptional,
  hsn_code: hsnOptional,
  unit_code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,4}$/, "Select a unit"),
  gst_rate: percentRequired,
  cess_rate: percentOrZero,
  sale_price: rupeesRequired("Selling price"),
  price_includes_tax: z.boolean(),
  mrp: rupeesOptional("MRP"),
  /** Only read on the server when the user has products.view_cost. */
  purchase_price: rupeesOptional("Purchase price"),
  track_inventory: z.boolean(),
  low_stock_threshold: quantityOptional,
  is_active: z.boolean(),
  /** Create only: one entry per outlet. */
  opening_stock: z.array(openingStockEntrySchema).max(200).optional(),
}).superRefine((v, ctx) => {
  // MRP is the most a shop may charge, tax included.
  if (v.mrp !== null && v.mrp < v.sale_price) {
    ctx.addIssue({ code: "custom", path: ["mrp"], message: "MRP cannot be less than the selling price" });
  }
});

export type ProductFormInput = z.input<typeof productSchema>;
export type ProductData = z.output<typeof productSchema>;

export const categorySchema = z.object({
  id: uuidOptional,
  name: requiredText("Category name", 100),
  parent_id: uuidOptional,
});

export type CategoryInput = z.input<typeof categorySchema>;

export const productIdSchema = z.object({ id: uuid });

export const setProductActiveSchema = z.object({ id: uuid, is_active: z.boolean() });
