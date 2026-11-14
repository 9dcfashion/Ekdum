import { describe, expect, it } from "vitest";
import { saleInputSchema } from "@/lib/validation/sales";
import {
  addManualItem,
  addProduct,
  attachCustomerRecord,
  buildSaleInput,
  changeQuantity,
  computeCart,
  emptyCart,
  patchCustomer,
  removeLine,
  restoreLine,
} from "./cart";
import {
  initialRatePaise,
  filterQuickItems,
  lastRateStorageKey,
  parseLastRates,
  quickItemInput,
  quickItemTaxLabel,
  rememberRate,
  stepQuantity,
} from "./quick-items";
import { MAX_RECENT, cashChips, matchScannedCode, parseRecent, pushRecent, recentStorageKey, shortINR, sortByName, tileList } from "./quick-bill";
import { buildCatalogIndex } from "./search";
import { billLink, billShareText, waNumber, whatsappUrl } from "./share";
import type { CartResult, CartState, CatalogProduct, PosContext, QuickItem } from "./types";

const UUID = "0b9f4c2e-6f1d-4a57-9d55-2f0d3c7a1e11";

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

let seq = 0;
const product = (name: string, over: Partial<CatalogProduct> = {}): CatalogProduct => {
  seq += 1;
  return {
    id: `p-${String(seq).padStart(3, "0")}`,
    name,
    sku: null,
    barcode: null,
    hsn_code: null,
    unit_code: "PCS",
    allow_decimal: false,
    gst_rate: 5,
    cess_rate: 0,
    sale_price_paise: 100_00,
    price_includes_tax: true,
    track_inventory: true,
    stock: 10,
    ...over,
  };
};

function must(result: CartResult): CartState {
  if (!result.ok) throw new Error(result.error);
  return result.cart;
}

describe("product tiles", () => {
  const sugar = product("sugar 1kg", { sku: "SUG-1", barcode: "8901000000011" });
  const atta = product("Atta 5kg", { sku: "ATT-5" });
  const item10 = product("Item 10");
  const item2 = product("Item 2");
  const biscuit = product("Biscuit", { barcode: "036000291452" });
  const catalog = [sugar, atta, item10, item2, biscuit];
  const index = buildCatalogIndex(catalog);
  const alphabetical = sortByName(catalog);

  it("sorts A to Z ignoring case, with numbers in natural order, without touching the input", () => {
    expect(alphabetical.map((p) => p.name)).toEqual(["Atta 5kg", "Biscuit", "Item 2", "Item 10", "sugar 1kg"]);
    expect(catalog[0]).toBe(sugar);
  });

  it("shows recent items first (in recent order), then the rest A to Z, each product once", () => {
    const list = tileList(index, "", [item10.id, "gone-product", sugar.id, item10.id], alphabetical);
    expect(list.recentCount).toBe(2);
    expect(list.items.map((p) => p.name)).toEqual(["Item 10", "sugar 1kg", "Atta 5kg", "Biscuit", "Item 2"]);
  });

  it("with no recent items it is simply A to Z", () => {
    const list = tileList(index, "  ", [], alphabetical);
    expect(list.recentCount).toBe(0);
    expect(list.items).toEqual(alphabetical);
  });

  it("filters live by name, SKU or barcode, best match first, with no limit", () => {
    // Same ranking as the desktop search box, so both screens agree.
    expect(tileList(index, "item", [sugar.id], alphabetical)).toEqual({ items: [item10, item2], recentCount: 0 });
    expect(tileList(index, "att-5", [], alphabetical).items).toEqual([atta]);
    expect(tileList(index, "8901000000011", [], alphabetical).items).toEqual([sugar]);
    expect(tileList(index, "zzz", [], alphabetical).items).toEqual([]);
    const big = Array.from({ length: 120 }, (_, i) => product(`Pen ${i}`));
    const bigIndex = buildCatalogIndex(big);
    expect(tileList(bigIndex, "pen", [], sortByName(big)).items).toHaveLength(120);
  });
});

describe("recent items", () => {
  it("puts the products of the last bill first, without repeats, capped", () => {
    expect(pushRecent(["a", "b", "c"], ["c", null, "d", "d"])).toEqual(["c", "d", "a", "b"]);
    const many = Array.from({ length: 30 }, (_, i) => `id-${i}`);
    expect(pushRecent([], many)).toHaveLength(MAX_RECENT);
    expect(pushRecent(["x"], ["y"], 1)).toEqual(["y"]);
  });

  it("reads back only what makes sense", () => {
    expect(parseRecent(JSON.stringify(["a", "b", "a", 3, ""]))).toEqual(["a", "b"]);
    expect(parseRecent("{not json")).toEqual([]);
    expect(parseRecent(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent(JSON.stringify(Array.from({ length: 40 }, (_, i) => `id-${i}`)))).toHaveLength(MAX_RECENT);
  });

  it("is kept per business and outlet", () => {
    expect(recentStorageKey("biz", "out-1")).not.toBe(recentStorageKey("biz", "out-2"));
  });
});

describe("cash quick amounts", () => {
  it("offers the exact amount and the next ₹100, ₹500 and ₹2000", () => {
    expect(cashChips(1234_00)).toEqual([1234_00, 1300_00, 1500_00, 2000_00]);
    expect(cashChips(90_00)).toEqual([90_00, 100_00, 500_00, 2000_00]);
    expect(cashChips(123_50)).toEqual([123_50, 200_00, 500_00, 2000_00]);
  });

  it("never repeats an amount", () => {
    expect(cashChips(100_00)).toEqual([100_00, 500_00, 2000_00]);
    expect(cashChips(2450_00)).toEqual([2450_00, 2500_00, 4000_00]);
    expect(cashChips(2000_00)).toEqual([2000_00]);
  });

  it("labels the buttons without paise when there are none", () => {
    expect(shortINR(1300_00)).toBe("₹1,300");
    expect(shortINR(1_00_000_00)).toBe("₹1,00,000");
    expect(shortINR(1234_50)).toBe("₹1,234.50");
  });

  it("offers nothing for a zero or invalid total", () => {
    expect(cashChips(0)).toEqual([]);
    expect(cashChips(-5)).toEqual([]);
    expect(cashChips(10.5)).toEqual([]);
  });
});

describe("camera scan", () => {
  const kurta = product("Kurta", { barcode: "8901234567890", sku: "KUR-1" });
  const upc = product("Cola", { barcode: "036000291452" });
  const ean = product("Chips", { barcode: "0012345678905" });
  const fuzzy = product("8901234");
  const index = buildCatalogIndex([kurta, upc, ean, fuzzy]);

  it("adds by exact barcode, then exact SKU (case and spaces ignored)", () => {
    expect(matchScannedCode(index, "8901234567890")).toBe(kurta);
    expect(matchScannedCode(index, " kur-1 ")).toBe(kurta);
  });

  it("treats a UPC-A and the same code saved as EAN-13 as one", () => {
    expect(matchScannedCode(index, "0036000291452")).toBe(upc);
    expect(matchScannedCode(index, "012345678905")).toBe(ean);
  });

  it("never guesses from a partial or name match", () => {
    expect(matchScannedCode(index, "8901234")).toBeNull();
    expect(matchScannedCode(index, "Kurta")).toBeNull();
    expect(matchScannedCode(index, "")).toBeNull();
  });
});

describe("undo after removing a line", () => {
  const a = product("Tea", { id: "tea" });
  const b = product("Milk", { id: "milk" });

  it("puts the line back where it was", () => {
    let cart = must(addProduct(emptyCart(UUID), a, ctx));
    cart = must(addProduct(cart, b, ctx));
    cart = must(changeQuantity(cart, "tea", 2, ctx));
    const removed = { clientUuid: cart.clientUuid, line: cart.lines[0], index: 0 };
    const after = removeLine(cart, "tea");
    const restored = restoreLine(after, removed);
    expect(restored.lines.map((l) => [l.key, l.quantity])).toEqual([
      ["tea", "3"],
      ["milk", "1"],
    ]);
  });

  it("does nothing once the bill is saved or cleared, or when the item is already back", () => {
    const cart = must(addProduct(emptyCart(UUID), a, ctx));
    const removed = { clientUuid: cart.clientUuid, line: cart.lines[0], index: 0 };
    const newBill = emptyCart("another-uuid");
    expect(restoreLine(newBill, removed)).toBe(newBill);
    const readded = must(addProduct(removeLine(cart, "tea"), a, ctx));
    expect(restoreLine(readded, removed)).toBe(readded);
  });
});

describe("customer from the pay screen", () => {
  const record = {
    id: "c-1",
    name: "Ramesh",
    phone: "+919876543210",
    email: null,
    gstin: null,
    address: null,
    pincode: null,
    state_code: "27",
    whatsapp_opt_in: false,
  };

  it("attaches a saved customer found by mobile number, replacing a typed-in number", () => {
    const typed = patchCustomer(emptyCart(UUID), { phone: "9876543210" });
    const cart = attachCustomerRecord(typed, record);
    expect(cart.customer).toMatchObject({ id: "c-1", name: "Ramesh", phone: "+919876543210" });
  });

  it("keeps a customer typed in while offline as details on this bill only", () => {
    const cart = attachCustomerRecord(emptyCart(UUID), { ...record, id: "" });
    expect(cart.customer).toMatchObject({ id: null, name: "Ramesh", phone: "+919876543210" });
  });

  it("a number cleared again leaves no customer at all", () => {
    expect(patchCustomer(emptyCart(UUID), { phone: "" }).customer).toBeNull();
  });
});

describe("sharing a bill", () => {
  it("normalises Indian mobiles for wa.me", () => {
    expect(waNumber("98765 43210")).toBe("919876543210");
    expect(waNumber("+91-98765-43210")).toBe("919876543210");
    expect(waNumber("098765 43210")).toBe("919876543210");
    expect(waNumber("12345")).toBeNull();
    expect(waNumber("5876543210")).toBeNull();
    expect(waNumber(null)).toBeNull();
  });

  it("builds the public bill link", () => {
    expect(billLink("https://ekdum.app/", "tok_123")).toBe("https://ekdum.app/i/tok_123");
    expect(billLink("http://localhost:3000", "a b")).toBe("http://localhost:3000/i/a%20b");
  });

  it("writes a short plain message with the bill number, amount and link", () => {
    const text = billShareText({ businessName: " Sharma Store ", invoiceNumber: "A/2627/00042", totalPaise: 1234_50, link: "https://ekdum.app/i/t" });
    expect(text).toBe("Thank you for shopping at Sharma Store.\nBill A/2627/00042: ₹1,234.50\nSee your bill: https://ekdum.app/i/t");
    expect(text).not.toMatch(/[—–]/);
    expect(billShareText({ businessName: "", invoiceNumber: "A/1", totalPaise: 100 })).toBe("Thank you for shopping with us.\nBill A/1: ₹1.00");
  });

  it("opens the customer's chat when the number is known, else lets WhatsApp ask", () => {
    expect(whatsappUrl("Hi there\nBill A/1", "98765 43210")).toBe("https://wa.me/919876543210?text=Hi%20there%0ABill%20A%2F1");
    expect(whatsappUrl("Hi", "123")).toBe("https://wa.me/?text=Hi");
    expect(whatsappUrl("Hi")).toBe("https://wa.me/?text=Hi");
  });
});

describe("quick items", () => {
  const necklace: QuickItem = {
    id: "qi-necklace",
    name: "Necklace",
    gstRate: 3,
    hsnCode: "7117",
    unitCode: "PCS",
    allowDecimal: false,
    priceIncludesTax: false,
    defaultRatePaise: null,
  };
  const silver: QuickItem = { ...necklace, id: "qi-silver", name: "Silver (loose)", unitCode: "GMS", allowDecimal: true, hsnCode: null, priceIncludesTax: true, defaultRatePaise: 95_00 };

  it("becomes a manual line with the preset GST, HSN and unit, and the typed qty and rate", () => {
    const input = quickItemInput(necklace, { key: "manual-1", quantity: " 2 ", ratePaise: 1500_00 });
    expect(input).toEqual({
      key: "manual-1",
      name: "Necklace",
      quantity: "2",
      unitPricePaise: 1500_00,
      priceIncludesTax: false,
      gstRate: 3,
      hsnCode: "7117",
      unitCode: "PCS",
      allowDecimal: false,
    });
    const cart = must(addManualItem(emptyCart(UUID), input, ctx));
    expect(cart.lines[0]).toMatchObject({ productId: null, gstRate: 3, hsnCode: "7117", trackInventory: false, quantity: "2" });
    // 2 × ₹1500 + 3% GST
    expect(computeCart(cart, ctx).totals.totalPaise).toBe(3090_00);
    const built = buildSaleInput(cart, ctx, [{ mode: "cash", amountPaise: 3090_00, reference: "" }]);
    expect(built.ok).toBe(true);
    if (built.ok) expect(saleInputSchema.parse(built.input).lines[0]).toMatchObject({ product_id: null, hsn_code: "7117", gst_rate: 3 });
  });

  it("keeps decimals only for units that allow them, and charges no GST for sellers who do not", () => {
    expect(addManualItem(emptyCart(UUID), quickItemInput(necklace, { key: "manual-2", quantity: "1.5", ratePaise: 100_00 }), ctx).ok).toBe(false);
    const grams = must(addManualItem(emptyCart(UUID), quickItemInput(silver, { key: "manual-3", quantity: "12.345", ratePaise: 95_00 }), ctx));
    expect(grams.lines[0].quantity).toBe("12.345");
    const composition = { ...ctx, gstScheme: "composition" as const };
    const noGst = must(addManualItem(emptyCart(UUID), quickItemInput(necklace, { key: "manual-4", quantity: "1", ratePaise: 100_00 }), composition));
    expect(noGst.lines[0].gstRate).toBe(0);
  });

  it("remembers the last rate per item, and falls back to the default rate", () => {
    let rates = parseLastRates(null);
    expect(initialRatePaise(necklace, rates)).toBeNull();
    expect(initialRatePaise(silver, rates)).toBe(95_00);
    rates = rememberRate(rates, necklace.id, 1800_00);
    rates = rememberRate(rates, silver.id, 0);
    expect(initialRatePaise(necklace, rates)).toBe(1800_00);
    expect(initialRatePaise(silver, rates)).toBe(95_00);
    expect(parseLastRates(JSON.stringify(rates))).toEqual({ [necklace.id]: 1800_00 });
    expect(parseLastRates(JSON.stringify({ a: 12.5, b: -1, c: "x", d: 500 }))).toEqual({ d: 500 });
    expect(parseLastRates("[1,2]")).toEqual({});
    expect(parseLastRates("nope")).toEqual({});
    expect(lastRateStorageKey("b1")).not.toBe(lastRateStorageKey("b2"));
  });

  it("describes the tax in plain words", () => {
    expect(quickItemTaxLabel(necklace, true)).toBe("GST 3% extra · HSN 7117");
    expect(quickItemTaxLabel(silver, true)).toBe("GST 3% incl.");
    expect(quickItemTaxLabel(necklace, false)).toBe("No GST · HSN 7117");
  });

  it("steps the quantity without going to zero", () => {
    expect(stepQuantity("1", 1, false)).toBe("2");
    expect(stepQuantity("1", -1, false)).toBe("1");
    expect(stepQuantity("2.5", -1, true)).toBe("1.5");
    expect(stepQuantity("0.5", -1, true)).toBe("0.5");
    expect(stepQuantity("", 1, false)).toBe("1");
    expect(stepQuantity("abc", 1, false)).toBe("1");
    expect(stepQuantity("1.5", 1, false)).toBe("1");
  });

  it("filters by every typed word", () => {
    expect(filterQuickItems([necklace, silver], "")).toEqual([necklace, silver]);
    expect(filterQuickItems([necklace, silver], "LOOSE sil")).toEqual([silver]);
    expect(filterQuickItems([necklace, silver], "ring")).toEqual([]);
  });
});
