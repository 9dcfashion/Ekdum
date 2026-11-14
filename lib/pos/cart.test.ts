import { describe, expect, it } from "vitest";
import { computeInvoice, gstinCheckChar } from "@/lib/gst";
import { saleInputSchema } from "@/lib/validation/sales";
import {
  addManualItem,
  addProduct,
  buildPosContext,
  buildSaleInput,
  cartIssues,
  cashSettlement,
  changeQuantity,
  checkPayments,
  computeCart,
  customerFromRecord,
  emptyCart,
  exceedsStock,
  parseQuantity,
  patchCustomer,
  removeLine,
  setBillDiscount,
  setCustomer,
  setDeliveryState,
  setLineDiscount,
  setPlaceOfSupplyOverride,
  setQuantity,
  setSupplyType,
  setUnitPrice,
  isManualLine,
  syncCartWithCatalog,
} from "./cart";
import { createLocalParkedStore, toParkedBill } from "./parked";
import { buildCatalogIndex, resolveScan, searchCatalog } from "./search";
import type { CartResult, CartState, CatalogProduct, ManualItemInput, PaymentEntry, PosContext } from "./types";

const UUID = "0b9f4c2e-6f1d-4a57-9d55-2f0d3c7a1e11";
const gstin = (first14: string) => first14 + gstinCheckChar(first14);
const GSTIN_MH = gstin("27AAPFU0939F1Z");
const GSTIN_KA = gstin("29AAGCB7383J1Z");

const ctx: PosContext = {
  outletId: "5d0c6a51-9a59-4c0e-8f65-0e9a4d1d2b22",
  sellerStateCode: "27",
  gstScheme: "regular",
  roundOff: true,
  bosForExemptOnly: true,
  allowNegativeStock: false,
  canDiscount: true,
  maxDiscountPercent: 10,
  canOverridePrice: false,
};

const product = (over: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id: "a3b1f6f0-52f5-4c0b-9a50-7a6d0c1e0001",
  name: "Cotton Kurta",
  sku: "KUR-001",
  barcode: "8901234567890",
  hsn_code: "6109",
  unit_code: "PCS",
  allow_decimal: false,
  gst_rate: 5,
  cess_rate: 0,
  sale_price_paise: 499_00,
  price_includes_tax: true,
  track_inventory: true,
  stock: 10,
  ...over,
});
const rice = product({
  id: "a3b1f6f0-52f5-4c0b-9a50-7a6d0c1e0002",
  name: "Basmati Rice",
  sku: "RICE-1",
  barcode: "8900000000017",
  hsn_code: "1006",
  unit_code: "KGS",
  allow_decimal: true,
  gst_rate: 18,
  sale_price_paise: 120_00,
  price_includes_tax: false,
  stock: 50,
});

function must(result: CartResult): CartState {
  if (!result.ok) throw new Error(result.error);
  return result.cart;
}
const cash = (amountPaise: number): PaymentEntry[] => [{ mode: "cash", amountPaise, reference: "" }];

describe("adding items", () => {
  it("scanning the same item twice gives one line with quantity 2", () => {
    let cart = must(addProduct(emptyCart(UUID), product(), ctx));
    cart = must(addProduct(cart, product(), ctx));
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].quantity).toBe("2");
  });

  it("keeps separate lines for different products and never mutates the old cart", () => {
    const first = must(addProduct(emptyCart(UUID), product(), ctx));
    const second = must(addProduct(first, rice, ctx, "0.25"));
    expect(first.lines).toHaveLength(1);
    expect(second.lines.map((l) => l.quantity)).toEqual(["1", "0.25"]);
  });

  it("allows decimals only when the unit allows them, up to 3 places", () => {
    expect(parseQuantity("1.5", false).ok).toBe(false);
    expect(parseQuantity("1.5", true)).toEqual({ ok: true, quantity: "1.5" });
    expect(parseQuantity("0.1234", true).ok).toBe(false);
    expect(parseQuantity("0", true).ok).toBe(false);
    expect(parseQuantity("abc", true).ok).toBe(false);
    const cart = must(addProduct(emptyCart(UUID), product(), ctx));
    expect(setQuantity(cart, cart.lines[0].key, "2.5", ctx).ok).toBe(false);
  });

  it("plus and minus change the quantity but never reach zero", () => {
    let cart = must(addProduct(emptyCart(UUID), product(), ctx));
    const key = cart.lines[0].key;
    cart = must(changeQuantity(cart, key, 1, ctx));
    expect(cart.lines[0].quantity).toBe("2");
    cart = must(changeQuantity(cart, key, -1, ctx));
    expect(changeQuantity(cart, key, -1, ctx).ok).toBe(false);
    expect(removeLine(cart, key).lines).toHaveLength(0);
  });
});

describe("stock", () => {
  it("blocks selling more than the stock when negative stock is off", () => {
    const low = product({ stock: 2 });
    let cart = must(addProduct(emptyCart(UUID), low, ctx, 2));
    const blocked = addProduct(cart, low, ctx);
    expect(blocked.ok).toBe(false);
    expect(setQuantity(cart, low.id, 3, ctx).ok).toBe(false);
    cart = must(setQuantity(cart, low.id, 1, ctx));
    expect(cart.lines[0].quantity).toBe("1");
    expect(addProduct(emptyCart(UUID), product({ stock: 0 }), ctx).ok).toBe(false);
  });

  it("only warns when negative stock is allowed, and ignores untracked or unknown stock", () => {
    const loose = { ...ctx, allowNegativeStock: true };
    const cart = must(addProduct(emptyCart(UUID), product({ stock: 1 }), loose, 5));
    expect(exceedsStock(cart.lines[0])).toBe(true);
    expect(cartIssues(cart, loose)).toEqual([]);
    expect(addProduct(emptyCart(UUID), product({ track_inventory: false, stock: 0 }), ctx, 5).ok).toBe(true);
    expect(addProduct(emptyCart(UUID), product({ stock: null }), ctx, 5).ok).toBe(true);
  });

  it("reports a stock problem on a resumed bill whose stock has since dropped", () => {
    const cart = must(addProduct(emptyCart(UUID), product({ stock: 5 }), ctx, 5));
    const synced = syncCartWithCatalog(cart, () => product({ stock: 5 }), () => 3);
    expect(synced.lines[0].stock).toBe(2);
    expect(cartIssues(synced, ctx).map((i) => i.code)).toEqual(["insufficient_stock"]);
    expect(buildSaleInput(synced, ctx, cash(2495_00)).ok).toBe(false);
  });
});

describe("discounts", () => {
  const two = () => must(addProduct(emptyCart(UUID), product(), ctx, 2)); // subtotal 998.00

  it("accepts a line discount within the role limit, as an amount or a percentage", () => {
    const byPercent = must(setLineDiscount(two(), product().id, { kind: "percent", percent: 10 }, ctx));
    expect(computeCart(byPercent, ctx).totals.discountPaise).toBe(99_80);
    const byAmount = must(setLineDiscount(two(), product().id, { kind: "amount", paise: 50_00 }, ctx));
    expect(computeCart(byAmount, ctx).discountPercent).toBe(5.01);
  });

  it("refuses a discount above the role limit, counting line and bill discounts together", () => {
    expect(setLineDiscount(two(), product().id, { kind: "percent", percent: 10.5 }, ctx).ok).toBe(false);
    const cart = must(setLineDiscount(two(), product().id, { kind: "percent", percent: 6 }, ctx));
    const over = setBillDiscount(cart, { kind: "percent", percent: 6 }, ctx);
    expect(over.ok).toBe(false);
    expect(setBillDiscount(cart, { kind: "percent", percent: 4 }, ctx).ok).toBe(true);
  });

  it("refuses any discount without the discount permission", () => {
    const none = { ...ctx, canDiscount: false };
    const result = setBillDiscount(two(), { kind: "amount", paise: 1_00 }, none);
    expect(result).toEqual({ ok: false, error: "You are not allowed to give discounts" });
  });

  it("refuses a discount larger than the line, and lets a discount be cleared", () => {
    const open = { ...ctx, maxDiscountPercent: 100 };
    expect(setLineDiscount(two(), product().id, { kind: "amount", paise: 999_00 }, open).ok).toBe(false);
    expect(setLineDiscount(two(), product().id, { kind: "percent", percent: 101 }, open).ok).toBe(false);
    const cart = must(setLineDiscount(two(), product().id, { kind: "amount", paise: 0 }, { ...ctx, canDiscount: false }));
    expect(computeCart(cart, ctx).totals.discountPaise).toBe(0);
  });

  it("flags a bill that drifts over the limit after the quantity is reduced", () => {
    let cart = must(addProduct(emptyCart(UUID), product(), ctx, 4));
    cart = must(setLineDiscount(cart, product().id, { kind: "amount", paise: 150_00 }, ctx)); // 7.5% of 1996
    cart = must(setQuantity(cart, product().id, 2, ctx)); // now 15% of 998
    expect(cartIssues(cart, ctx).map((i) => i.code)).toEqual(["discount_over_limit"]);
  });
});

describe("price override", () => {
  it("is refused without the permission and allowed with it", () => {
    const cart = must(addProduct(emptyCart(UUID), product(), ctx));
    expect(setUnitPrice(cart, product().id, 450_00, ctx).ok).toBe(false);
    const allowed = must(setUnitPrice(cart, product().id, 450_00, { ...ctx, canOverridePrice: true }));
    expect(allowed.lines[0].unitPricePaise).toBe(450_00);
    expect(cartIssues(allowed, ctx).map((i) => i.code)).toEqual(["price_override_denied"]);
  });

  it("a catalog refresh updates list prices but keeps an overridden price", () => {
    const boss = { ...ctx, canOverridePrice: true };
    let cart = must(addProduct(emptyCart(UUID), product(), boss));
    cart = must(addProduct(cart, rice, boss));
    cart = must(setUnitPrice(cart, rice.id, 100_00, boss));
    const fresh = [product({ sale_price_paise: 549_00 }), { ...rice, sale_price_paise: 130_00 }];
    const synced = syncCartWithCatalog(cart, (id) => fresh.find((p) => p.id === id));
    expect(synced.lines.map((l) => l.unitPricePaise)).toEqual([549_00, 100_00]);
    expect(synced.lines[1].listPricePaise).toBe(130_00);
    expect(syncCartWithCatalog(synced, (id) => fresh.find((p) => p.id === id))).toBe(synced);
  });
});

describe("customer, B2B and place of supply", () => {
  const base = () => must(addProduct(emptyCart(UUID), rice, ctx, 2));

  it("B2B needs a customer with a name and a valid GSTIN", () => {
    let cart = setSupplyType(base(), "b2b");
    expect(cartIssues(cart, ctx).map((i) => i.code)).toEqual(["b2b_customer"]);
    cart = patchCustomer(cart, { name: "Acme Traders", gstin: "27AAPFU0939F1ZX" });
    expect(cartIssues(cart, ctx)[0].message).toMatch(/check digit/i);
    expect(buildSaleInput(cart, ctx, cash(283_00)).ok).toBe(false);
    cart = patchCustomer(cart, { gstin: GSTIN_MH });
    expect(cartIssues(cart, ctx)).toEqual([]);
    expect(cartIssues(patchCustomer(cart, { name: " " }), ctx).map((i) => i.code)).toEqual(["b2b_customer"]);
  });

  it("charges CGST+SGST in the same state and IGST for a B2B customer in another state", () => {
    const local = computeCart(base(), ctx);
    expect(local.interState).toBe(false);
    expect(local.totals).toMatchObject({ cgstPaise: 21_60, sgstPaise: 21_60, igstPaise: 0 });

    const cart = patchCustomer(setSupplyType(base(), "b2b"), { name: "Blr Stores", gstin: GSTIN_KA });
    const away = computeCart(cart, ctx);
    expect(away.placeOfSupply).toMatchObject({ stateCode: "29", source: "customer_gstin" });
    expect(away.totals).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: 43_20 });
  });

  it("delivery state and the override change the place of supply; the override needs a reason", () => {
    const shipped = computeCart(setDeliveryState(base(), "24"), ctx);
    expect(shipped.placeOfSupply).toMatchObject({ stateCode: "24", source: "delivery" });
    expect(shipped.interState).toBe(true);

    const noReason = setPlaceOfSupplyOverride(setDeliveryState(base(), "24"), { stateCode: "27", reason: " " });
    expect(computeCart(noReason, ctx).placeOfSupply.source).toBe("override");
    expect(cartIssues(noReason, ctx).map((i) => i.code)).toEqual(["override_reason"]);
    const withReason = setPlaceOfSupplyOverride(noReason, { stateCode: "27", reason: "Customer collects at shop" });
    expect(cartIssues(withReason, ctx)).toEqual([]);
    const built = buildSaleInput(withReason, ctx, cash(283_00));
    expect(built.ok && built.input.place_of_supply_override).toEqual({ state_code: "27", reason: "Customer collects at shop" });
  });

  it("a walk-in with nothing typed is no customer at all", () => {
    expect(patchCustomer(base(), { name: "  " }).customer).toBeNull();
    expect(setCustomer(base(), null).customer).toBeNull();
  });
});

describe("totals", () => {
  it("equal computeInvoice for the same lines, discounts and tax position", () => {
    let cart = must(addProduct(emptyCart(UUID), product(), ctx, 3));
    cart = must(addProduct(cart, rice, ctx, "1.75"));
    cart = must(setLineDiscount(cart, product().id, { kind: "percent", percent: 5 }, ctx));
    cart = must(setBillDiscount(cart, { kind: "amount", paise: 40_00 }, ctx));
    const summary = computeCart(cart, ctx);

    const expected = computeInvoice({
      lines: [
        { quantity: "3", unitPricePaise: 499_00, priceIncludesTax: true, discountPaise: 74_85, gstRate: 5, cessRate: 0 },
        { quantity: "1.75", unitPricePaise: 120_00, priceIncludesTax: false, discountPaise: 0, gstRate: 18, cessRate: 0 },
      ],
      billDiscountPaise: 40_00,
      chargeTax: true,
      isInterState: false,
      roundOff: true,
    });
    expect(summary.totals).toEqual(expected);
    expect(summary.totals.totalPaise % 100).toBe(0);
    expect(summary.rateSummary.map((r) => r.gstRate)).toEqual(["5.00", "18.00"]);
    expect(summary.documentType).toBe("tax_invoice");
  });

  it("composition and unregistered businesses charge no tax and issue the right document", () => {
    const cart = must(addProduct(emptyCart(UUID), rice, ctx, 2));
    const composition = computeCart(cart, { ...ctx, gstScheme: "composition" });
    expect(composition.chargeTax).toBe(false);
    expect(composition.totals.taxPaise).toBe(0);
    expect(composition.rateSummary).toEqual([]);
    expect(composition.documentType).toBe("bill_of_supply");
    expect(computeCart(cart, { ...ctx, gstScheme: "unregistered" }).documentType).toBe("cash_memo");
  });

  it("a bill of only exempt items becomes a Bill of Supply when the business chose that", () => {
    const cart = must(addProduct(emptyCart(UUID), product({ gst_rate: 0 }), ctx));
    expect(computeCart(cart, ctx).documentType).toBe("bill_of_supply");
    expect(computeCart(cart, { ...ctx, bosForExemptOnly: false }).documentType).toBe("tax_invoice");
  });

  it("an empty cart totals zero", () => {
    expect(computeCart(emptyCart(UUID), ctx).totals.totalPaise).toBe(0);
    expect(cartIssues(emptyCart(UUID), ctx).map((i) => i.code)).toEqual(["empty"]);
  });
});

describe("payments", () => {
  it("must add up to exactly the bill total", () => {
    expect(checkPayments(500_00, cash(400_00), { hasCustomerRecord: false })).toMatchObject({ ok: false, remainingPaise: 100_00 });
    expect(checkPayments(500_00, cash(600_00), { hasCustomerRecord: false })).toMatchObject({ ok: false, remainingPaise: -100_00 });
    const split: PaymentEntry[] = [
      { mode: "cash", amountPaise: 200_00, reference: "" },
      { mode: "upi", amountPaise: 300_00, reference: "UTR123" },
      { mode: "card", amountPaise: 0, reference: "" },
    ];
    expect(checkPayments(500_00, split, { hasCustomerRecord: false })).toMatchObject({ ok: true, paidPaise: 500_00 });
  });

  it("credit needs a saved customer", () => {
    const credit: PaymentEntry[] = [{ mode: "credit", amountPaise: 500_00, reference: "" }];
    expect(checkPayments(500_00, credit, { hasCustomerRecord: false }).ok).toBe(false);
    expect(checkPayments(500_00, credit, { hasCustomerRecord: true }).ok).toBe(true);
  });

  it("works out the change due for cash", () => {
    expect(cashSettlement(437_00, 500_00)).toEqual({ changePaise: 63_00, shortPaise: 0 });
    expect(cashSettlement(437_00, 400_00)).toEqual({ changePaise: 0, shortPaise: 37_00 });
    expect(cashSettlement(437_00, 437_00)).toEqual({ changePaise: 0, shortPaise: 0 });
  });
});

describe("buildSaleInput", () => {
  const customer = customerFromRecord({
    id: "c0a8012e-1111-4222-8333-444455556666",
    name: "Asha Patel",
    phone: "98765 43210",
    email: "Asha@Example.com",
    gstin: null,
    address: "12 MG Road",
    pincode: "400001",
    state_code: "27",
    whatsapp_opt_in: false,
  });

  it("produces a payload the server schema accepts, with engine totals and net cash only", () => {
    let cart = must(addProduct(emptyCart(UUID), product(), ctx, 2));
    cart = must(addProduct(cart, rice, ctx, "1.5"));
    cart = setCustomer(cart, customer);
    const summary = computeCart(cart, ctx);
    const total = summary.totals.totalPaise;
    const payments: PaymentEntry[] = [
      { mode: "cash", amountPaise: total - 300_00, reference: "" },
      { mode: "upi", amountPaise: 300_00, reference: " UTR42 " },
      { mode: "card", amountPaise: 0, reference: "" },
    ];
    const built = buildSaleInput(cart, ctx, payments, { notifyEmail: true, notifyWhatsapp: true, whatsappOptIn: true });
    if (!built.ok) throw new Error(built.error);

    const parsed = saleInputSchema.parse(built.input);
    expect(parsed.client_uuid).toBe(UUID);
    expect(parsed.customer).toMatchObject({ name: "Asha Patel", phone: "+919876543210", email: "asha@example.com" });
    expect(parsed.lines.map((l) => l.quantity)).toEqual(["2", "1.5"]);
    expect(parsed.payments).toEqual([
      { mode: "cash", amount_paise: total - 300_00, reference: null },
      { mode: "upi", amount_paise: 300_00, reference: "UTR42" },
    ]);
    expect(parsed.payments.reduce((s, p) => s + p.amount_paise, 0)).toBe(parsed.totals.totalPaise);
    expect(parsed.notify).toEqual({ email: true, whatsapp: true });
    expect(parsed.whatsapp_opt_in).toBe(true);

    const { lines: _lines, taxPaise: _tax, ...expectedTotals } = summary.totals;
    void _lines;
    void _tax;
    expect(parsed.totals).toEqual(expectedTotals);
  });

  it("rejects payments that do not match the total, and credit for a walk-in", () => {
    const cart = must(addProduct(emptyCart(UUID), product(), ctx));
    expect(buildSaleInput(cart, ctx, cash(100_00))).toMatchObject({ ok: false, error: "Payments are less than the bill total" });
    const credit: PaymentEntry[] = [{ mode: "credit", amountPaise: 499_00, reference: "" }];
    expect(buildSaleInput(cart, ctx, credit)).toMatchObject({ ok: false, error: "Select a customer to give credit" });
    expect(buildSaleInput(setCustomer(cart, customer), ctx, credit).ok).toBe(true);
  });

  it("never asks for WhatsApp without a saved customer, phone and consent", () => {
    const cart = must(addProduct(emptyCart(UUID), product(), ctx));
    const walkIn = patchCustomer(cart, { name: "Ravi", phone: "9876543210" });
    const a = buildSaleInput(walkIn, ctx, cash(499_00), { notifyWhatsapp: true, whatsappOptIn: true });
    expect(a.ok && a.input.notify).toEqual({ email: false, whatsapp: false });
    expect(a.ok && a.input.whatsapp_opt_in).toBe(false);
    const b = buildSaleInput(setCustomer(cart, customer), ctx, cash(499_00), { notifyWhatsapp: true });
    expect(b.ok && b.input.notify?.whatsapp).toBe(false);
    const c = buildSaleInput(setCustomer(cart, { ...customer, whatsapp_opt_in: true }), ctx, cash(499_00), { notifyWhatsapp: true });
    expect(c.ok && c.input.notify?.whatsapp).toBe(true);
    expect(c.ok && c.input.whatsapp_opt_in).toBe(false);
  });

  it("rejects an invalid mobile number instead of silently dropping it", () => {
    const cart = patchCustomer(must(addProduct(emptyCart(UUID), product(), ctx)), { name: "Ravi", phone: "12345" });
    expect(buildSaleInput(cart, ctx, cash(499_00))).toMatchObject({ ok: false });
  });

  it("keeps the same client_uuid on every build so a retry cannot create a second bill", () => {
    const cart = must(addProduct(emptyCart(UUID), product(), ctx));
    const a = buildSaleInput(cart, ctx, cash(499_00));
    const b = buildSaleInput(cart, ctx, cash(499_00));
    expect(a.ok && b.ok && a.input.client_uuid === b.input.client_uuid).toBe(true);
  });
});

describe("buildPosContext", () => {
  const business = { gst_scheme: "regular" as const, gstin: GSTIN_MH, round_off_enabled: true, bos_for_exempt_only: true, allow_negative_stock: false };
  it("takes the seller state from the GSTIN, and ignores it for unregistered sellers", () => {
    const outlet = { id: ctx.outletId, gstin: null, state_code: "24" };
    const args = { outlet, canDiscount: true, maxDiscountPercent: 15, canOverridePrice: false };
    expect(buildPosContext({ business, ...args }).sellerStateCode).toBe("27");
    expect(buildPosContext({ business: { ...business, gst_scheme: "unregistered" }, ...args }).sellerStateCode).toBe("24");
    expect(buildPosContext({ business, ...args, canDiscount: false }).maxDiscountPercent).toBe(0);
  });
});

describe("search and scanning", () => {
  const index = buildCatalogIndex([product(), rice, product({ id: "p3", name: "Kurta Pyjama Set", sku: "KUR-002", barcode: null })]);

  it("an exact barcode or SKU adds the item straight away", () => {
    expect(resolveScan(index, "8901234567890")).toMatchObject({ kind: "add", via: "barcode", product: { name: "Cotton Kurta" } });
    expect(resolveScan(index, "rice-1")).toMatchObject({ kind: "add", via: "sku" });
  });

  it("a single match is added, several matches open the list, nothing matches nothing", () => {
    expect(resolveScan(index, "basm")).toMatchObject({ kind: "add", via: "single" });
    const many = resolveScan(index, "kurta");
    expect(many.kind === "choose" && many.results.map((p) => p.name)).toEqual(["Kurta Pyjama Set", "Cotton Kurta"]);
    expect(resolveScan(index, "zzz")).toEqual({ kind: "none" });
    expect(resolveScan(index, "  ")).toEqual({ kind: "none" });
  });

  it("matches every word, on name, SKU or barcode, and limits the results", () => {
    expect(searchCatalog(index, "kurta cotton").map((p) => p.name)).toEqual(["Cotton Kurta"]);
    expect(searchCatalog(index, "kur-").length).toBe(2);
    expect(searchCatalog(index, "89")).toHaveLength(2);
    expect(searchCatalog(index, "k", 1)).toHaveLength(1);
  });
});

describe("held bills", () => {
  function memoryStorage() {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  }

  it("saves, lists newest first, replaces by id and removes", async () => {
    const store = createLocalParkedStore("biz.outlet", memoryStorage());
    const one = must(addProduct(emptyCart(UUID), product(), ctx));
    const two = patchCustomer(must(addProduct(emptyCart("7f1f3f0a-0000-4000-8000-000000000002"), rice, ctx)), { name: "Asha" });
    await store.save(toParkedBill(one, 499_00, new Date("2026-11-12T10:00:00Z")));
    await store.save(toParkedBill(two, 142_00, new Date("2026-11-12T11:00:00Z")));
    await store.save(toParkedBill(one, 998_00, new Date("2026-11-12T10:00:00Z")));
    const bills = await store.list();
    expect(bills.map((b) => [b.customerLabel, b.totalPaise])).toEqual([["Asha", 142_00], ["Walk-in", 998_00]]);
    expect(bills[1].cart.lines[0].name).toBe("Cotton Kurta");
    await store.remove(UUID);
    expect((await store.list()).map((b) => b.id)).toEqual(["7f1f3f0a-0000-4000-8000-000000000002"]);
  });

  it("keeps scopes apart and survives corrupt data", async () => {
    const storage = memoryStorage();
    storage.setItem("ekdum.pos.parked.a", "{not json");
    expect(await createLocalParkedStore("a", storage).list()).toEqual([]);
    await createLocalParkedStore("a", storage).save(toParkedBill(emptyCart(UUID), 0));
    expect(await createLocalParkedStore("b", storage).list()).toEqual([]);
  });
});


describe("manual items (not in the product list)", () => {
  const manual = (over: Partial<ManualItemInput> = {}): ManualItemInput => ({
    key: "manual-1",
    name: "  Silk   saree ",
    quantity: "1",
    unitPricePaise: 2500_00,
    priceIncludesTax: true,
    gstRate: 5,
    hsnCode: "5007",
    unitCode: "PCS",
    allowDecimal: false,
    ...over,
  });

  it("adds a line with no product, no stock tracking and a tidy name", () => {
    const cart = must(addManualItem(emptyCart(UUID), manual(), ctx));
    const line = cart.lines[0];
    expect(isManualLine(line)).toBe(true);
    expect(line).toMatchObject({ productId: null, name: "Silk saree", trackInventory: false, stock: null, hsnCode: "5007" });
    expect(line.listPricePaise).toBe(line.unitPricePaise);
  });

  it("is never blocked by stock, even when negative stock is not allowed", () => {
    const cart = must(addManualItem(emptyCart(UUID), manual({ quantity: "50" }), { ...ctx, allowNegativeStock: false }));
    expect(cartIssues(cart, ctx).filter((i) => i.code === "insufficient_stock")).toEqual([]);
  });

  it("lets a cashier without price-override permission set and correct its price", () => {
    let cart = must(addManualItem(emptyCart(UUID), manual(), { ...ctx, canOverridePrice: false }));
    cart = must(setUnitPrice(cart, "manual-1", 2400_00, { ...ctx, canOverridePrice: false }));
    expect(cart.lines[0].unitPricePaise).toBe(2400_00);
    expect(cartIssues(cart, ctx).filter((i) => i.code === "price_override_denied")).toEqual([]);
    expect(setUnitPrice(cart, "manual-1", 0, ctx).ok).toBe(false);
  });

  it("validates the input", () => {
    const base = emptyCart(UUID);
    expect(addManualItem(base, manual({ name: "   " }), ctx)).toEqual({ ok: false, error: "Enter the item name" });
    expect(addManualItem(base, manual({ unitPricePaise: 0 }), ctx).ok).toBe(false);
    expect(addManualItem(base, manual({ quantity: "1.5" }), ctx).ok).toBe(false); // PCS is whole units
    expect(addManualItem(base, manual({ quantity: "1.5", allowDecimal: true, unitCode: "KGS" }), ctx).ok).toBe(true);
    expect(addManualItem(base, manual({ hsnCode: "123" }), ctx)).toEqual({ ok: false, error: "HSN must be 4, 6 or 8 digits" });
    expect(addManualItem(base, manual({ gstRate: Number.NaN }), ctx)).toEqual({ ok: false, error: "Select the GST rate" });
    expect(addManualItem(base, manual({ unitCode: "pcs" }), ctx)).toEqual({ ok: false, error: "Select a unit" });
  });

  it("keeps two manual items with the same name as separate lines", () => {
    let cart = must(addManualItem(emptyCart(UUID), manual(), ctx));
    cart = must(addManualItem(cart, manual({ key: "manual-2" }), ctx));
    expect(cart.lines).toHaveLength(2);
    expect(addManualItem(cart, manual({ key: "manual-2" }), ctx).ok).toBe(false);
  });

  it("drops the GST rate for sellers who do not charge tax", () => {
    const cart = must(addManualItem(emptyCart(UUID), manual({ gstRate: 18, priceIncludesTax: false }), { ...ctx, gstScheme: "composition" }));
    expect(cart.lines[0]).toMatchObject({ gstRate: 0, priceIncludesTax: true });
  });

  it("survives a catalog refresh untouched", () => {
    const cart = must(addManualItem(emptyCart(UUID), manual(), ctx));
    expect(syncCartWithCatalog(cart, () => product())).toBe(cart);
  });

  it("builds a valid payload with product_id null, mixed with catalog items, and totals that match the engine", () => {
    let cart = must(addProduct(emptyCart(UUID), product(), ctx));
    cart = must(addManualItem(cart, manual({ quantity: "2", unitPricePaise: 350_00, gstRate: 18, priceIncludesTax: false, hsnCode: "" }), ctx));
    const total = computeCart(cart, ctx).totals.totalPaise;
    const built = buildSaleInput(cart, ctx, [{ mode: "cash", amountPaise: total, reference: "" }]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const parsed = saleInputSchema.parse(built.input);
    expect(parsed.lines[1]).toMatchObject({ product_id: null, description: "Silk saree", hsn_code: null, quantity: "2", unit_price_paise: 350_00 });
    const engine = computeInvoice({
      lines: [
        { quantity: "1", unitPricePaise: 499_00, priceIncludesTax: true, gstRate: 5 },
        { quantity: "2", unitPricePaise: 350_00, priceIncludesTax: false, gstRate: 18 },
      ],
      chargeTax: true,
      isInterState: false,
      roundOff: true,
    });
    expect(built.input.totals.totalPaise).toBe(engine.totalPaise);
  });

  it("can be held like any other line", () => {
    const cart = must(addManualItem(emptyCart(UUID), manual(), ctx));
    const parked = toParkedBill(cart, 2500_00);
    expect(parked.cart.lines[0].productId).toBeNull();
    expect(parked.itemCount).toBe(1);
  });
});
