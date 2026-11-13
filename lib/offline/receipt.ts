/**
 * Builds the printable bill for an offline sale entirely on the device, with the
 * same GST engine and the same view model the server uses for the thermal slip.
 * Pure: no network, no storage.
 */
import {
  GstEngineError,
  UNREGISTERED_RECIPIENT_DETAILS_THRESHOLD_PAISE,
  amountInWords,
  chargesTax,
  computeInvoice,
  diffTotals,
  isInterState,
  resolveDocumentType,
  resolvePlaceOfSupply,
  type DocumentType,
} from "@/lib/gst";
import { financialYear } from "@/lib/dates";
import type { InvoiceBundle, InvoiceBusiness, InvoiceOutlet } from "@/lib/invoices/types";
import { buildInvoiceView, type InvoiceView } from "@/lib/invoices/view";
import type { PosContext } from "@/lib/pos/types";
import { saleInputSchema, type SaleData, type SaleInput } from "@/lib/validation/sales";

/** What the slip prints about the seller. Sent with the POS page, so it is there when the network is not. */
export interface SellerSnapshot {
  business: InvoiceBusiness;
  outlet: InvoiceOutlet;
  /** GSTIN printed on bills from this outlet (null for an unregistered business). */
  sellerGstin: string | null;
  cashierName: string | null;
  userId: string;
}

export type LocalBill =
  | { ok: true; data: SaleData; documentType: DocumentType; view: InvoiceView; amountDuePaise: number }
  | { ok: false; code: string; message: string };

export const offlineInvoiceId = (clientUuid: string) => `offline:${clientUuid}`;

/**
 * Check a bill the way the server will, and build its printable view.
 * A bill that fails here would only come back later as a conflict, after the
 * customer has left with it, so it is refused before it is queued.
 */
export function buildLocalBill(input: SaleInput, ctx: PosContext, seller: SellerSnapshot, at: Date): LocalBill {
  const parsed = saleInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", message: parsed.error.issues[0]?.message ?? "Please check the bill" };
  const data = parsed.data;
  if (!data.invoice_number || !data.invoice_date) return { ok: false, code: "number_invalid", message: "This bill has no number yet" };

  if (data.supply_type === "b2b" && !data.customer.gstin) return { ok: false, code: "invalid", message: "A B2B bill needs the customer's GSTIN" };
  if (data.supply_type === "b2b" && !data.customer.name) return { ok: false, code: "invalid", message: "A B2B bill needs the customer's name" };
  if (data.payments.some((p) => p.mode === "credit") && !data.customer_id) {
    return { ok: false, code: "invalid", message: "Select a saved customer to give credit" };
  }

  const taxed = chargesTax(ctx.gstScheme);
  const place = resolvePlaceOfSupply({
    sellerState: ctx.sellerStateCode,
    supplyType: data.supply_type,
    customerGstin: data.customer.gstin,
    customerStateCode: data.customer.state_code,
    deliveryStateCode: data.delivery_state_code,
    overrideStateCode: data.place_of_supply_override?.state_code,
  });
  const interState = isInterState(ctx.sellerStateCode, place.stateCode);

  let totals;
  try {
    totals = computeInvoice({
      lines: data.lines.map((l) => ({
        quantity: l.quantity,
        unitPricePaise: l.unit_price_paise,
        priceIncludesTax: l.price_includes_tax,
        discountPaise: l.discount_paise,
        gstRate: l.gst_rate,
        cessRate: l.cess_rate,
      })),
      billDiscountPaise: data.bill_discount_paise,
      chargeTax: taxed,
      isInterState: interState,
      roundOff: ctx.roundOff,
    });
  } catch (error) {
    if (error instanceof GstEngineError) return { ok: false, code: "invalid", message: error.message };
    throw error;
  }
  const { lines, ...headline } = totals;
  if (diffTotals(headline, data.totals, 0).length > 0) {
    return { ok: false, code: "totals_mismatch", message: "The bill total does not add up. Review the bill and try again." };
  }
  const paid = data.payments.reduce((sum, p) => sum + p.amount_paise, 0);
  if (paid !== totals.totalPaise) return { ok: false, code: "invalid", message: "The payments do not add up to the bill total" };

  const documentType = resolveDocumentType({
    scheme: ctx.gstScheme,
    lineGstRates: lines.map((l) => l.gstRate),
    bosForExemptOnly: ctx.bosForExemptOnly,
  });
  if (
    documentType === "tax_invoice" &&
    data.supply_type === "b2c" &&
    totals.taxablePaise >= UNREGISTERED_RECIPIENT_DETAILS_THRESHOLD_PAISE &&
    !(data.customer.name && data.customer.address && (data.customer.state_code || data.delivery_state_code))
  ) {
    return { ok: false, code: "invalid", message: "For a bill of ₹50,000 or more, add the customer's name, address and state." };
  }

  const amountDuePaise = data.payments.filter((p) => p.mode === "credit").reduce((sum, p) => sum + p.amount_paise, 0);
  const id = offlineInvoiceId(data.client_uuid);
  const bundle: InvoiceBundle = {
    invoice: {
      id,
      business_id: seller.business.id,
      outlet_id: data.outlet_id,
      series_id: "",
      pos_device_id: data.device?.id ?? null,
      invoice_number: data.invoice_number,
      financial_year: financialYear(data.invoice_date),
      document_type: documentType,
      invoice_date: data.invoice_date,
      seller_gstin: ctx.gstScheme === "unregistered" ? null : seller.sellerGstin,
      seller_state_code: ctx.sellerStateCode,
      customer_id: data.customer_id,
      customer_name: data.customer.name,
      customer_phone: data.customer.phone,
      customer_email: data.customer.email,
      customer_gstin: data.customer.gstin,
      customer_address: data.customer.address,
      customer_pincode: data.customer.pincode,
      customer_state_code: data.customer.state_code,
      supply_type: data.supply_type,
      place_of_supply_state: place.stateCode,
      pos_override_reason: data.place_of_supply_override?.reason ?? null,
      is_inter_state: interState,
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
      amount_due_paise: amountDuePaise,
      amount_in_words: amountInWords(totals.totalPaise),
      notes: data.notes,
      status: "posted",
      cancelled_at: null,
      cancelled_by: null,
      cancel_reason: null,
      public_token: "",
      public_token_revoked_at: null,
      client_uuid: data.client_uuid,
      source: "pos_offline",
      created_by: seller.userId,
      created_at: at.toISOString(),
    },
    items: data.lines.map((line, i) => {
      const c = lines[i];
      return {
        id: `${id}:${i + 1}`,
        line_no: i + 1,
        description: line.description,
        hsn_code: line.hsn_code,
        quantity: Number(line.quantity),
        unit_code: line.unit_code,
        unit_price_paise: line.unit_price_paise,
        price_includes_tax: line.price_includes_tax,
        discount_paise: c.discountPaise,
        taxable_paise: c.taxablePaise,
        gst_rate: Number(c.gstRate),
        cess_rate: Number(c.cessRate),
        cgst_paise: c.cgstPaise,
        sgst_paise: c.sgstPaise,
        igst_paise: c.igstPaise,
        cess_paise: c.cessPaise,
        total_paise: c.totalPaise,
      };
    }),
    payments: data.payments.map((p, i) => ({
      id: `${id}:p${i + 1}`,
      mode: p.mode,
      amount_paise: p.amount_paise,
      reference: p.reference,
      is_collection: false,
      received_on: data.invoice_date as string,
    })),
    // Bank details are not printed on a slip, so they are never kept on the device.
    business: { ...seller.business, bank_name: null, bank_account_name: null, bank_account_number: null, ifsc: null },
    outlet: seller.outlet,
  };

  return { ok: true, data, documentType, view: buildInvoiceView(bundle), amountDuePaise };
}

/** The client_uuid behind the placeholder id of a bill that only exists on this device. */
export const clientUuidOfOffline = (invoiceId: string) => invoiceId.replace(/^offline:/, "");
