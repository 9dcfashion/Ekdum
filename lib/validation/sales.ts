import { z } from "zod";
import { isValidGstin, isValidStateCode, normaliseGstin, normaliseMobile } from "@/lib/gst";
import { isoDate, quantityRequired, uuid, uuidOptional } from "./common";

const paise = z.number().int("Amounts must be whole paise").min(0).max(99_99_99_99_999);
const rate = z.coerce.number().min(0).max(100);
const blankToNull = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const PAYMENT_MODES = ["cash", "upi", "card", "bank_transfer", "credit"] as const;

export const saleLineSchema = z.object({
  /** Null for a free-text line that is not in the product master. */
  product_id: uuidOptional,
  description: z.string().trim().min(1, "Item name is required").max(200),
  hsn_code: blankToNull(8),
  quantity: quantityRequired,
  unit_code: z.string().trim().min(2).max(4).default("PCS"),
  unit_price_paise: paise,
  price_includes_tax: z.boolean(),
  /** Line discount as an amount in paise (percentages are resolved on the client). */
  discount_paise: paise.default(0),
  gst_rate: rate,
  cess_rate: rate.default(0),
});

export const saleCustomerSchema = z.object({
  name: blankToNull(150),
  phone: z
    .string()
    .nullish()
    .transform((v) => (v && v.trim() ? normaliseMobile(v) : null)),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email address"),
  gstin: z
    .string()
    .nullish()
    .transform((v) => (v && v.trim() ? normaliseGstin(v) : null))
    .refine((v) => v === null || isValidGstin(v), "Enter a valid customer GSTIN"),
  address: blankToNull(400),
  pincode: blankToNull(6),
  state_code: z
    .string()
    .nullish()
    .transform((v) => (v && isValidStateCode(v) ? v : null)),
});

export const salePaymentSchema = z.object({
  mode: z.enum(PAYMENT_MODES),
  amount_paise: z.number().int().positive("Payment amount must be more than zero"),
  reference: blankToNull(100),
});

/** Totals as computed by the client with the shared GST engine. The server recomputes and compares. */
export const saleTotalsSchema = z.object({
  subtotalPaise: paise,
  discountPaise: paise,
  taxablePaise: paise,
  cgstPaise: paise,
  sgstPaise: paise,
  igstPaise: paise,
  cessPaise: paise,
  roundOffPaise: z.number().int().min(-99).max(99),
  totalPaise: paise,
});

/**
 * One bill, as sent by the POS (online), the back office, or the offline sync queue.
 * `client_uuid` is the idempotency key: retrying the same bill never creates a second invoice.
 */
export const saleInputSchema = z.object({
  client_uuid: uuid,
  outlet_id: uuid,
  supply_type: z.enum(["b2c", "b2b"]).default("b2c"),
  customer_id: uuidOptional,
  customer: saleCustomerSchema.default({ name: null, phone: null, email: null, gstin: null, address: null, pincode: null, state_code: null }),
  /** Set when goods are shipped to an address in another state. */
  delivery_state_code: z
    .string()
    .nullish()
    .transform((v) => (v && isValidStateCode(v) ? v : null)),
  /** Cashier override of the place of supply; the reason is written to the audit log. */
  place_of_supply_override: z
    .object({
      state_code: z.string().refine(isValidStateCode, "Select a state"),
      reason: z.string().trim().min(3, "Give a reason for changing the place of supply").max(200),
    })
    .nullish(),
  lines: z.array(saleLineSchema).min(1, "Add at least one item").max(300, "Too many lines on one bill"),
  bill_discount_paise: paise.default(0),
  payments: z.array(salePaymentSchema).max(10),
  notify: z.object({ email: z.boolean().default(false), whatsapp: z.boolean().default(false) }).default({ email: false, whatsapp: false }),
  /** True when the customer agreed at the counter to receive bills on WhatsApp. */
  whatsapp_opt_in: z.boolean().default(false),
  notes: blankToNull(500),
  totals: saleTotalsSchema,

  // ── Registered POS device (its own number series, online and offline) ──
  device: z.object({ id: uuid, key: z.string().min(32).max(200) }).nullish(),
  /** Number issued by the device from its local counter. Required with `device`. */
  invoice_number: z.string().trim().max(16).nullish(),
  /** Offline bills only: the IST date the bill was printed. */
  invoice_date: isoDate.nullish(),
});

export type SaleInput = z.input<typeof saleInputSchema>;
export type SaleData = z.output<typeof saleInputSchema>;
export type SaleLineInput = z.input<typeof saleLineSchema>;
export type SalePaymentInput = z.input<typeof salePaymentSchema>;

export const cancelInvoiceSchema = z.object({
  invoice_id: uuid,
  reason: z.string().trim().min(3, "Give a reason for cancelling").max(300),
});

export const creditNoteSchema = z.object({
  invoice_id: uuid,
  items: z
    .array(z.object({ invoice_item_id: uuid, quantity: quantityRequired }))
    .min(1, "Select at least one item to return"),
  reason: z.string().trim().min(3, "Give a reason for the return").max(300),
  restock: z.boolean().default(true),
  refund_mode: z.enum(["cash", "upi", "card", "bank_transfer"]).default("cash"),
});

export const collectionSchema = z.object({
  invoice_id: uuid,
  mode: z.enum(["cash", "upi", "card", "bank_transfer"]),
  amount_paise: z.number().int().positive("Amount must be more than zero"),
  reference: blankToNull(100),
});
