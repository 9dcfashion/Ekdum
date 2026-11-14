import { z } from "zod";
import { hsnOptional, percentRequired, requiredText, rupeesOptional, uuid } from "./common";

/** One quick billing item, as typed in Settings. Shared by the form and the server action. */
export const quickItemSchema = z.object({
  id: uuid.optional(),
  name: requiredText("Item name", 60),
  gst_rate: percentRequired,
  hsn_code: hsnOptional,
  unit_code: z.string().trim().regex(/^[A-Z]{2,4}$/, "Pick a unit"),
  price_includes_tax: z.boolean(),
  /** Usual rate in rupees, prefilled at the counter. Optional. */
  default_rate: rupeesOptional("Usual rate"),
  is_active: z.boolean().default(true),
});

export type QuickItemInput = z.input<typeof quickItemSchema>;
