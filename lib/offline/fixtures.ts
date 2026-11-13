/** Sample data for the offline unit tests. Not used at runtime. */
import { computeInvoice } from "@/lib/gst";
import { fixtureBusiness, fixtureOutlet } from "@/lib/invoices/fixtures";
import type { PosContext } from "@/lib/pos/types";
import type { SaleInput } from "@/lib/validation/sales";
import type { SellerSnapshot } from "./receipt";
import type { DeviceRecord } from "./types";

export const OUTLET_ID = "22222222-2222-4222-8222-222222222222";
export const DEVICE_ID = "33333333-3333-4333-8333-333333333333";
export const PRODUCT_ID = "44444444-4444-4444-8444-444444444444";

export const uuidOf = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;

export function fixtureContext(overrides: Partial<PosContext> = {}): PosContext {
  return {
    outletId: OUTLET_ID,
    sellerStateCode: "27",
    gstScheme: "regular",
    roundOff: true,
    bosForExemptOnly: false,
    allowNegativeStock: true,
    canDiscount: true,
    maxDiscountPercent: 10,
    canOverridePrice: false,
    ...overrides,
  };
}

export function fixtureSeller(): SellerSnapshot {
  return {
    business: fixtureBusiness(),
    outlet: fixtureOutlet({ id: OUTLET_ID }),
    sellerGstin: "27AAPFU0939F1ZV",
    cashierName: "Asha",
    userId: "55555555-5555-4555-8555-555555555555",
  };
}

export function fixtureDevice(overrides: Partial<DeviceRecord> = {}): DeviceRecord {
  return {
    outletId: OUTLET_ID,
    deviceId: DEVICE_ID,
    key: "k".repeat(64),
    name: "Counter 1",
    prefix: "C1",
    counters: {},
    reservations: {},
    registeredAt: 0,
    ...overrides,
  };
}

/** A valid cash bill: `quantity` × ₹118.00 (tax included, 18%), totals from the shared engine. */
export function fixtureSale(n: number, opts: { quantity?: string; ctx?: PosContext } = {}): SaleInput {
  const ctx = opts.ctx ?? fixtureContext();
  const line = { quantity: opts.quantity ?? "2", unitPricePaise: 118_00, priceIncludesTax: true, discountPaise: 0, gstRate: 18, cessRate: 0 };
  const { lines: _lines, ...totals } = computeInvoice({ lines: [line], billDiscountPaise: 0, chargeTax: true, isInterState: false, roundOff: ctx.roundOff });
  void _lines;
  return {
    client_uuid: uuidOf(n),
    outlet_id: OUTLET_ID,
    supply_type: "b2c",
    customer_id: null,
    customer: { name: null, phone: null, email: null, gstin: null, address: null, pincode: null, state_code: null },
    lines: [
      {
        product_id: PRODUCT_ID,
        description: "Basmati rice 1kg",
        hsn_code: "1006",
        quantity: line.quantity,
        unit_code: "PCS",
        unit_price_paise: line.unitPricePaise,
        price_includes_tax: true,
        discount_paise: 0,
        gst_rate: 18,
        cess_rate: 0,
      },
    ],
    bill_discount_paise: 0,
    payments: [{ mode: "cash", amount_paise: totals.totalPaise, reference: null }],
    notify: { email: false, whatsapp: false },
    whatsapp_opt_in: false,
    notes: null,
    totals: {
      subtotalPaise: totals.subtotalPaise,
      discountPaise: totals.discountPaise,
      taxablePaise: totals.taxablePaise,
      cgstPaise: totals.cgstPaise,
      sgstPaise: totals.sgstPaise,
      igstPaise: totals.igstPaise,
      cessPaise: totals.cessPaise,
      roundOffPaise: totals.roundOffPaise,
      totalPaise: totals.totalPaise,
    },
  };
}
