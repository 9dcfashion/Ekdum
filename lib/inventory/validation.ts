import { z } from "zod";
import { optionalText, uuid } from "@/lib/validation/common";
import { ADJUSTMENT_REASONS } from "./ledger";

export const adjustStockSchema = z
  .object({
    product_id: uuid,
    outlet_id: uuid,
    /** "set" = I counted this many. "change" = add or remove this many. */
    mode: z.enum(["set", "change"]),
    direction: z.enum(["add", "remove"]),
    quantity: z
      .union([z.string(), z.number()])
      .transform((v) => String(v).trim())
      .refine((v) => /^\d+(\.\d{1,3})?$/.test(v), "Enter a valid quantity (up to 3 decimals)"),
    reason: z.enum(ADJUSTMENT_REASONS, "Select a reason"),
    note: optionalText(300),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "change" && Number(v.quantity) <= 0) {
      ctx.addIssue({ code: "custom", path: ["quantity"], message: "Enter a quantity greater than zero" });
    }
    if (v.reason === "other" && !v.note) {
      ctx.addIssue({ code: "custom", path: ["note"], message: "Please add a note explaining the adjustment" });
    }
  });

export type AdjustStockInput = z.input<typeof adjustStockSchema>;

export interface StockProductOption {
  id: string;
  name: string;
  sku: string | null;
  unit_code: string;
}
