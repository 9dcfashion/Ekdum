import { randomUUID } from "node:crypto";
import { amountInWords, computeInvoice, type LineInput } from "@/lib/gst";

export interface PayloadLine {
  productId?: string | null;
  description?: string;
  quantity?: string | number;
  unitPricePaise: number;
  priceIncludesTax?: boolean;
  gstRate?: number;
  cessRate?: number;
  discountPaise?: number;
  hsnCode?: string;
}

export interface PayloadOptions {
  businessId: string;
  outletId: string;
  lines: PayloadLine[];
  source?: "pos_online" | "pos_offline" | "back_office";
  clientUuid?: string;
  deviceId?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  documentType?: "tax_invoice" | "bill_of_supply" | "cash_memo";
  chargeTax?: boolean;
  sellerState?: string;
  placeOfSupply?: string;
  supplyType?: "b2b" | "b2c";
  customerId?: string | null;
  customer?: Record<string, string | null>;
  billDiscountPaise?: number;
  roundOff?: boolean;
  payments?: Array<{ mode: string; amount_paise: number; reference?: string }>;
  notify?: { email?: boolean; whatsapp?: boolean };
  whatsappOptIn?: boolean;
  posOverrideReason?: string;
}

/** Builds the payload for post_sales_invoice exactly the way the app server does: via the shared GST engine. */
export function buildInvoicePayload(o: PayloadOptions) {
  const sellerState = o.sellerState ?? "27";
  const placeOfSupply = o.placeOfSupply ?? sellerState;
  const isInterState = sellerState !== placeOfSupply;
  const chargeTax = o.chargeTax ?? true;

  const engineLines: LineInput[] = o.lines.map((l) => ({
    quantity: l.quantity ?? 1,
    unitPricePaise: l.unitPricePaise,
    priceIncludesTax: l.priceIncludesTax ?? true,
    discountPaise: l.discountPaise ?? 0,
    gstRate: l.gstRate ?? 18,
    cessRate: l.cessRate ?? 0,
  }));
  const totals = computeInvoice({
    lines: engineLines,
    billDiscountPaise: o.billDiscountPaise ?? 0,
    chargeTax,
    isInterState,
    roundOff: o.roundOff ?? true,
  });

  return {
    business_id: o.businessId,
    outlet_id: o.outletId,
    client_uuid: o.clientUuid ?? randomUUID(),
    source: o.source ?? "pos_online",
    device_id: o.deviceId ?? null,
    invoice_number: o.invoiceNumber ?? null,
    invoice_date: o.invoiceDate ?? null,
    document_type: o.documentType ?? (chargeTax ? "tax_invoice" : "bill_of_supply"),
    supply_type: o.supplyType ?? "b2c",
    customer_id: o.customerId ?? null,
    customer: o.customer ?? {},
    place_of_supply_state: placeOfSupply,
    pos_override_reason: o.posOverrideReason ?? null,
    is_inter_state: isInterState,
    reverse_charge: false,
    subtotal_paise: totals.subtotalPaise,
    discount_paise: totals.discountPaise,
    taxable_paise: totals.taxablePaise,
    cgst_paise: totals.cgstPaise,
    sgst_paise: totals.sgstPaise,
    igst_paise: totals.igstPaise,
    cess_paise: totals.cessPaise,
    round_off_paise: totals.roundOffPaise,
    total_paise: totals.totalPaise,
    amount_in_words: amountInWords(totals.totalPaise),
    items: o.lines.map((l, i) => {
      const r = totals.lines[i];
      return {
        product_id: l.productId ?? null,
        description: l.description ?? "Item",
        hsn_code: l.hsnCode ?? "6109",
        quantity: String(l.quantity ?? 1),
        unit_code: "PCS",
        unit_price_paise: l.unitPricePaise,
        price_includes_tax: l.priceIncludesTax ?? true,
        discount_paise: r.discountPaise,
        taxable_paise: r.taxablePaise,
        gst_rate: r.gstRate,
        cess_rate: r.cessRate,
        cgst_paise: r.cgstPaise,
        sgst_paise: r.sgstPaise,
        igst_paise: r.igstPaise,
        cess_paise: r.cessPaise,
        total_paise: r.totalPaise,
      };
    }),
    payments: o.payments ?? (totals.totalPaise > 0 ? [{ mode: "cash", amount_paise: totals.totalPaise }] : []),
    notify: o.notify ?? {},
    whatsapp_opt_in: o.whatsappOptIn ?? false,
  };
}
