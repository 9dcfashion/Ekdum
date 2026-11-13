/**
 * POS cart logic. Pure functions only (no React, no network, no storage), so
 * the online POS, the offline POS and the unit tests all run the same code.
 * Every function returns a new cart; nothing is mutated.
 */
import {
  GstEngineError,
  chargesTax,
  computeInvoice,
  discountPercent,
  isInterState,
  lineGross,
  normaliseMobile,
  percentOf,
  resolveDocumentType,
  resolvePlaceOfSupply,
  sellerStateCode,
  stateLabel,
  summariseByRate,
  validateGstin,
  type DocumentType,
  type GstScheme,
  type InvoiceTotals,
  type PlaceOfSupplySource,
  type RateSummaryRow,
} from "@/lib/gst";
import { Decimal } from "@/lib/money";
import type { SaleInput } from "@/lib/validation/sales";
import type {
  CartCustomer,
  CartIssue,
  CartLine,
  CartResult,
  CartState,
  CatalogProduct,
  Discount,
  PaymentEntry,
  PosContext,
  PosCustomer,
} from "./types";

export const NO_DISCOUNT: Discount = { kind: "amount", paise: 0 };
export const MAX_QUANTITY = 999_999_999;
export const MAX_LINES = 300;

// ── Context ─────────────────────────────────────────────────────────────────

/**
 * The seller side of the tax position, worked out exactly like the server does
 * in lib/sales/post.ts (an unregistered business ignores any GSTIN on file).
 */
export function buildPosContext(args: {
  business: {
    gst_scheme: GstScheme;
    gstin: string | null;
    round_off_enabled: boolean;
    bos_for_exempt_only: boolean;
    allow_negative_stock: boolean;
  };
  outlet: { id: string; gstin: string | null; state_code: string };
  canDiscount: boolean;
  maxDiscountPercent: number;
  canOverridePrice: boolean;
}): PosContext {
  const { business, outlet } = args;
  const usesGstin = business.gst_scheme !== "unregistered";
  return {
    outletId: outlet.id,
    sellerStateCode: sellerStateCode({
      gstin: usesGstin ? (outlet.gstin ?? business.gstin) : null,
      state_code: outlet.state_code,
    }),
    gstScheme: business.gst_scheme,
    roundOff: business.round_off_enabled,
    bosForExemptOnly: business.bos_for_exempt_only,
    allowNegativeStock: business.allow_negative_stock,
    canDiscount: args.canDiscount,
    maxDiscountPercent: args.canDiscount ? Number(args.maxDiscountPercent) || 0 : 0,
    canOverridePrice: args.canOverridePrice,
  };
}

// ── Cart basics ─────────────────────────────────────────────────────────────

export function emptyCart(clientUuid: string): CartState {
  return {
    clientUuid,
    lines: [],
    billDiscount: NO_DISCOUNT,
    supplyType: "b2c",
    customer: null,
    deliveryStateCode: null,
    placeOfSupplyOverride: null,
    notes: "",
  };
}

export function isCartEmpty(cart: CartState): boolean {
  return cart.lines.length === 0;
}

/** True when clearing the cart would lose something the cashier entered. */
export function hasUnsavedWork(cart: CartState): boolean {
  return cart.lines.length > 0 || cart.customer !== null;
}

const ok = (cart: CartState): CartResult => ({ ok: true, cart });
const fail = (error: string): CartResult => ({ ok: false, error });

/**
 * Parse a quantity typed by the cashier. Whole numbers only unless the unit
 * allows decimals; never more than 3 decimal places. Returns a plain decimal
 * string ("2", "0.25") or an error message.
 */
export function parseQuantity(
  input: string | number,
  allowDecimal: boolean,
): { ok: true; quantity: string } | { ok: false; error: string } {
  let d: Decimal;
  try {
    d = new Decimal(typeof input === "string" ? input.trim() : input);
  } catch {
    return { ok: false, error: "Enter a valid quantity" };
  }
  if (!d.isFinite() || d.lessThanOrEqualTo(0)) return { ok: false, error: "Quantity must be more than zero" };
  if (d.greaterThan(MAX_QUANTITY)) return { ok: false, error: "Quantity is too large" };
  if (!allowDecimal && !d.isInteger()) return { ok: false, error: "This item is sold in whole units only" };
  if (d.decimalPlaces() > 3) return { ok: false, error: "Quantity can have at most 3 decimal places" };
  return { ok: true, quantity: d.toFixed() };
}

function findLine(cart: CartState, key: string): CartLine | undefined {
  return cart.lines.find((l) => l.key === key);
}

function replaceLine(cart: CartState, line: CartLine): CartState {
  return { ...cart, lines: cart.lines.map((l) => (l.key === line.key ? line : l)) };
}

/** True when the line asks for more than the outlet has (only knowable for tracked items with known stock). */
export function exceedsStock(line: Pick<CartLine, "trackInventory" | "stock" | "quantity">): boolean {
  return line.trackInventory && line.stock !== null && new Decimal(line.quantity).greaterThan(line.stock);
}

function stockError(line: CartLine, ctx: PosContext): string | null {
  if (ctx.allowNegativeStock || !exceedsStock(line)) return null;
  const left = Math.max(line.stock ?? 0, 0);
  return left > 0
    ? `Only ${new Decimal(left).toFixed()} ${line.unitCode} of "${line.name}" in stock`
    : `"${line.name}" is out of stock`;
}

function lineFromProduct(product: CatalogProduct, quantity: string): CartLine {
  return {
    key: product.id,
    productId: product.id,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    hsnCode: product.hsn_code,
    unitCode: product.unit_code,
    allowDecimal: product.allow_decimal,
    gstRate: Number(product.gst_rate) || 0,
    cessRate: Number(product.cess_rate) || 0,
    listPricePaise: product.sale_price_paise,
    unitPricePaise: product.sale_price_paise,
    priceIncludesTax: product.price_includes_tax,
    trackInventory: product.track_inventory,
    stock: product.stock,
    quantity,
    discount: NO_DISCOUNT,
  };
}

/**
 * Add a product, or increase its quantity when it is already on the bill
 * (scanning the same barcode twice gives one line with quantity 2).
 */
export function addProduct(cart: CartState, product: CatalogProduct, ctx: PosContext, quantity: string | number = 1): CartResult {
  const parsed = parseQuantity(quantity, product.allow_decimal);
  if (!parsed.ok) return fail(parsed.error);

  const existing = cart.lines.find((l) => l.productId === product.id);
  if (existing) {
    const next = parseQuantity(new Decimal(existing.quantity).plus(parsed.quantity).toFixed(), existing.allowDecimal);
    if (!next.ok) return fail(next.error);
    const line = { ...existing, quantity: next.quantity };
    const error = stockError(line, ctx);
    return error ? fail(error) : ok(replaceLine(cart, line));
  }

  if (cart.lines.length >= MAX_LINES) return fail(`A bill can have at most ${MAX_LINES} lines`);
  const line = lineFromProduct(product, parsed.quantity);
  const error = stockError(line, ctx);
  return error ? fail(error) : ok({ ...cart, lines: [...cart.lines, line] });
}

export function setQuantity(cart: CartState, key: string, quantity: string | number, ctx: PosContext): CartResult {
  const line = findLine(cart, key);
  if (!line) return fail("That item is no longer on the bill");
  const parsed = parseQuantity(quantity, line.allowDecimal);
  if (!parsed.ok) return fail(parsed.error);
  const next = { ...line, quantity: parsed.quantity };
  // Lowering a quantity is always allowed, even when the line is already above stock.
  if (new Decimal(parsed.quantity).greaterThan(line.quantity)) {
    const error = stockError(next, ctx);
    if (error) return fail(error);
  }
  return ok(replaceLine(cart, next));
}

/** Plus / minus buttons and keys. Going down to zero is refused: use remove instead. */
export function changeQuantity(cart: CartState, key: string, delta: number, ctx: PosContext): CartResult {
  const line = findLine(cart, key);
  if (!line) return fail("That item is no longer on the bill");
  const next = new Decimal(line.quantity).plus(delta);
  if (next.lessThanOrEqualTo(0)) return fail("Quantity cannot go below one. Remove the item instead.");
  return setQuantity(cart, key, next.toFixed(), ctx);
}

export function removeLine(cart: CartState, key: string): CartState {
  return { ...cart, lines: cart.lines.filter((l) => l.key !== key) };
}

/** Change the price charged for a line. Needs the `sales.price_override` permission. */
export function setUnitPrice(cart: CartState, key: string, unitPricePaise: number, ctx: PosContext): CartResult {
  const line = findLine(cart, key);
  if (!line) return fail("That item is no longer on the bill");
  if (!Number.isInteger(unitPricePaise) || unitPricePaise < 0) return fail("Enter a valid price");
  if (unitPricePaise === line.unitPricePaise) return ok(cart);
  if (!ctx.canOverridePrice) return fail("You are not allowed to change prices");
  return ok(replaceLine(cart, { ...line, unitPricePaise }));
}

// ── Discounts ───────────────────────────────────────────────────────────────

export function isDiscountSet(discount: Discount): boolean {
  return discount.kind === "amount" ? discount.paise > 0 : discount.percent > 0;
}

function checkDiscountShape(discount: Discount): string | null {
  if (discount.kind === "amount") {
    return Number.isInteger(discount.paise) && discount.paise >= 0 ? null : "Enter a valid discount amount";
  }
  return Number.isFinite(discount.percent) && discount.percent >= 0 && discount.percent <= 100
    ? null
    : "Discount must be between 0% and 100%";
}

/** A discount in paise against `basePaise`, never more than the base itself. */
export function resolveDiscount(discount: Discount, basePaise: number): number {
  const paise = discount.kind === "amount" ? discount.paise : percentOf(basePaise, discount.percent);
  return Math.min(Math.max(paise, 0), Math.max(basePaise, 0));
}

export function lineGrossPaise(line: Pick<CartLine, "quantity" | "unitPricePaise">): number {
  return lineGross(line.quantity, line.unitPricePaise);
}

export function lineDiscountPaise(line: Pick<CartLine, "quantity" | "unitPricePaise" | "discount">): number {
  return resolveDiscount(line.discount, lineGrossPaise(line));
}

function discountLimitError(cart: CartState, ctx: PosContext): string | null {
  const summary = computeCart(cart, ctx);
  if (summary.totals.discountPaise === 0) return null;
  if (!ctx.canDiscount) return "You are not allowed to give discounts";
  if (summary.discountPercent > ctx.maxDiscountPercent) {
    return `Discount of ${summary.discountPercent}% is above your limit of ${ctx.maxDiscountPercent}%`;
  }
  return null;
}

/** Line discount as an amount or a percentage. Refused when the bill would go over the role's limit. */
export function setLineDiscount(cart: CartState, key: string, discount: Discount, ctx: PosContext): CartResult {
  const line = findLine(cart, key);
  if (!line) return fail("That item is no longer on the bill");
  const shape = checkDiscountShape(discount);
  if (shape) return fail(shape);
  if (discount.kind === "amount" && discount.paise > lineGrossPaise(line)) {
    return fail("Discount cannot be more than the line amount");
  }
  const next = replaceLine(cart, { ...line, discount });
  const error = isDiscountSet(discount) ? discountLimitError(next, ctx) : null;
  return error ? fail(error) : ok(next);
}

/** Bill-level discount, spread across the lines by the tax engine. */
export function setBillDiscount(cart: CartState, discount: Discount, ctx: PosContext): CartResult {
  const shape = checkDiscountShape(discount);
  if (shape) return fail(shape);
  const net = cart.lines.reduce((sum, l) => sum + lineGrossPaise(l) - lineDiscountPaise(l), 0);
  if (discount.kind === "amount" && discount.paise > net) return fail("Discount cannot be more than the bill amount");
  const next = { ...cart, billDiscount: discount };
  const error = isDiscountSet(discount) ? discountLimitError(next, ctx) : null;
  return error ? fail(error) : ok(next);
}

// ── Customer and place of supply ────────────────────────────────────────────

export function customerFromRecord(c: PosCustomer): CartCustomer {
  return {
    id: c.id,
    name: c.name ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
    gstin: c.gstin ?? "",
    address: c.address ?? "",
    pincode: c.pincode ?? "",
    state_code: c.state_code ?? "",
    whatsapp_opt_in: !!c.whatsapp_opt_in,
  };
}

/** A walk-in whose details are only printed on this bill (no customer record). */
export function walkInCustomer(details: Partial<Omit<CartCustomer, "id">> = {}): CartCustomer {
  return {
    id: null,
    name: details.name ?? "",
    phone: details.phone ?? "",
    email: details.email ?? "",
    gstin: details.gstin ?? "",
    address: details.address ?? "",
    pincode: details.pincode ?? "",
    state_code: details.state_code ?? "",
    whatsapp_opt_in: false,
  };
}

function isBlankCustomer(c: CartCustomer): boolean {
  return !c.id && ![c.name, c.phone, c.email, c.gstin, c.address, c.pincode, c.state_code].some((v) => v.trim());
}

export function setCustomer(cart: CartState, customer: CartCustomer | null): CartState {
  return { ...cart, customer: customer && !isBlankCustomer(customer) ? customer : null };
}

/** Edit fields of the customer on the bill (creates a walk-in snapshot when there is none). */
export function patchCustomer(cart: CartState, patch: Partial<Omit<CartCustomer, "id">>): CartState {
  return setCustomer(cart, { ...(cart.customer ?? walkInCustomer()), ...patch });
}

export function setSupplyType(cart: CartState, supplyType: "b2c" | "b2b"): CartState {
  return { ...cart, supplyType };
}

export function setDeliveryState(cart: CartState, stateCode: string | null): CartState {
  return { ...cart, deliveryStateCode: stateCode || null };
}

export function setPlaceOfSupplyOverride(cart: CartState, override: { stateCode: string; reason: string } | null): CartState {
  return { ...cart, placeOfSupplyOverride: override && override.stateCode ? override : null };
}

export function setNotes(cart: CartState, notes: string): CartState {
  return { ...cart, notes };
}

/** What is wrong with the customer for a B2B bill, or null when it is fine. */
export function b2bCustomerError(customer: CartCustomer | null): string | null {
  if (!customer) return "A B2B bill needs a customer with a GSTIN";
  if (!customer.name.trim()) return "A B2B bill needs the customer's name";
  if (!customer.gstin.trim()) return "A B2B bill needs the customer's GSTIN";
  const parsed = validateGstin(customer.gstin);
  return parsed.valid ? null : (parsed.message ?? "The customer's GSTIN is not valid");
}

// ── Totals ──────────────────────────────────────────────────────────────────

export interface CartSummary {
  totals: InvoiceTotals;
  /** Resolved line discounts in paise, in line order. */
  lineDiscountsPaise: number[];
  billDiscountPaise: number;
  placeOfSupply: { stateCode: string; source: PlaceOfSupplySource; label: string };
  interState: boolean;
  /** False for composition and unregistered businesses: no tax rows on the bill. */
  chargeTax: boolean;
  documentType: DocumentType;
  /** Total discount as a percentage of the subtotal (what the role limit applies to). */
  discountPercent: number;
  rateSummary: RateSummaryRow[];
  itemCount: number;
}

/** Live totals for the cart, with the same engine and inputs the server uses to re-check the bill. */
export function computeCart(cart: CartState, ctx: PosContext): CartSummary {
  const chargeTax = chargesTax(ctx.gstScheme);
  const pos = resolvePlaceOfSupply({
    sellerState: ctx.sellerStateCode,
    supplyType: cart.supplyType,
    customerGstin: cart.customer?.gstin,
    customerStateCode: cart.customer?.state_code,
    deliveryStateCode: cart.deliveryStateCode,
    overrideStateCode: cart.placeOfSupplyOverride?.stateCode,
  });
  const interState = isInterState(ctx.sellerStateCode, pos.stateCode);

  const lineDiscountsPaise = cart.lines.map(lineDiscountPaise);
  const net = cart.lines.reduce((sum, l, i) => sum + lineGrossPaise(l) - lineDiscountsPaise[i], 0);
  const billDiscountPaise = resolveDiscount(cart.billDiscount, net);

  const totals = computeInvoice({
    lines: cart.lines.map((l, i) => ({
      quantity: l.quantity,
      unitPricePaise: l.unitPricePaise,
      priceIncludesTax: l.priceIncludesTax,
      discountPaise: lineDiscountsPaise[i],
      gstRate: l.gstRate,
      cessRate: l.cessRate,
    })),
    billDiscountPaise,
    chargeTax,
    isInterState: interState,
    roundOff: ctx.roundOff,
  });

  return {
    totals,
    lineDiscountsPaise,
    billDiscountPaise,
    placeOfSupply: { ...pos, label: stateLabel(pos.stateCode) },
    interState,
    chargeTax,
    documentType: resolveDocumentType({
      scheme: ctx.gstScheme,
      lineGstRates: totals.lines.map((l) => l.gstRate),
      bosForExemptOnly: ctx.bosForExemptOnly,
    }),
    discountPercent: discountPercent(totals.discountPaise, totals.subtotalPaise),
    rateSummary: chargeTax ? summariseByRate(totals.lines) : [],
    itemCount: cart.lines.length,
  };
}

/** Everything that would stop this bill from being posted. Empty array = ready to pay. */
export function cartIssues(cart: CartState, ctx: PosContext, summary: CartSummary = computeCart(cart, ctx)): CartIssue[] {
  const issues: CartIssue[] = [];
  if (cart.lines.length === 0) issues.push({ code: "empty", message: "Add at least one item" });

  if (cart.supplyType === "b2b") {
    const error = b2bCustomerError(cart.customer);
    if (error) issues.push({ code: "b2b_customer", message: error });
  }

  if (summary.totals.discountPaise > 0) {
    if (!ctx.canDiscount) {
      issues.push({ code: "discount_not_allowed", message: "You are not allowed to give discounts" });
    } else if (summary.discountPercent > ctx.maxDiscountPercent) {
      issues.push({
        code: "discount_over_limit",
        message: `Discount of ${summary.discountPercent}% is above your limit of ${ctx.maxDiscountPercent}%`,
      });
    }
  }

  if (cart.placeOfSupplyOverride && cart.placeOfSupplyOverride.reason.trim().length < 3) {
    issues.push({ code: "override_reason", message: "Give a reason for changing the place of supply" });
  }

  for (const line of cart.lines) {
    const error = stockError(line, ctx);
    if (error) issues.push({ code: "insufficient_stock", message: error, lineKey: line.key });
    if (line.unitPricePaise !== line.listPricePaise && !ctx.canOverridePrice) {
      issues.push({
        code: "price_override_denied",
        message: `You are not allowed to change the price of "${line.name}"`,
        lineKey: line.key,
      });
    }
  }
  return issues;
}

// ── Catalog refresh ─────────────────────────────────────────────────────────

/**
 * Bring cart lines up to date with a newer catalog: stock, tax rates and list
 * price. A line still at its list price follows the new price; an overridden
 * price is kept. Returns the same cart object when nothing changed.
 */
export function syncCartWithCatalog(
  cart: CartState,
  lookup: (productId: string) => CatalogProduct | undefined,
  /** Quantity sold from this device since the catalog was loaded, per product. */
  soldSinceLoad: (productId: string) => number = () => 0,
): CartState {
  let changed = false;
  const lines = cart.lines.map((line) => {
    const p = lookup(line.productId);
    if (!p) return line;
    const stock = p.stock === null ? null : new Decimal(p.stock).minus(soldSinceLoad(p.id)).toNumber();
    const next: CartLine = {
      ...line,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      hsnCode: p.hsn_code,
      unitCode: p.unit_code,
      allowDecimal: p.allow_decimal,
      gstRate: Number(p.gst_rate) || 0,
      cessRate: Number(p.cess_rate) || 0,
      listPricePaise: p.sale_price_paise,
      unitPricePaise: line.unitPricePaise === line.listPricePaise ? p.sale_price_paise : line.unitPricePaise,
      priceIncludesTax: p.price_includes_tax,
      trackInventory: p.track_inventory,
      stock,
    };
    const same = (Object.keys(next) as Array<keyof CartLine>).every((k) => next[k] === line[k]);
    if (same) return line;
    changed = true;
    return next;
  });
  return changed ? { ...cart, lines } : cart;
}

// ── Payments ────────────────────────────────────────────────────────────────

export interface PaymentCheck {
  ok: boolean;
  error: string | null;
  paidPaise: number;
  /** Positive: still to be entered. Negative: entered too much. */
  remainingPaise: number;
}

/** Split payments must add up to exactly the bill total; credit needs a saved customer. */
export function checkPayments(totalPaise: number, payments: PaymentEntry[], opts: { hasCustomerRecord: boolean }): PaymentCheck {
  const used = payments.filter((p) => p.amountPaise !== 0);
  const paidPaise = used.reduce((sum, p) => sum + p.amountPaise, 0);
  const remainingPaise = totalPaise - paidPaise;
  const result = (error: string | null): PaymentCheck => ({ ok: error === null, error, paidPaise, remainingPaise });

  if (used.some((p) => !Number.isInteger(p.amountPaise) || p.amountPaise < 0)) return result("Enter valid payment amounts");
  if (used.length > 10) return result("Too many payment lines on one bill");
  if (used.some((p) => p.mode === "credit") && !opts.hasCustomerRecord) return result("Select a customer to give credit");
  if (remainingPaise > 0) return result("Payments are less than the bill total");
  if (remainingPaise < 0) return result("Payments are more than the bill total");
  return result(null);
}

/**
 * Cash handed over against the cash part of the bill. Only `cashDuePaise`
 * (the net cash that settles the bill) is stored; the change goes back to the customer.
 */
export function cashSettlement(cashDuePaise: number, tenderedPaise: number): { changePaise: number; shortPaise: number } {
  return {
    changePaise: Math.max(tenderedPaise - cashDuePaise, 0),
    shortPaise: Math.max(cashDuePaise - tenderedPaise, 0),
  };
}

// ── The payload ─────────────────────────────────────────────────────────────

export interface BuildSaleOptions {
  /** Queue an email receipt (uses the customer's email on the bill). */
  notifyEmail?: boolean;
  /** Queue a WhatsApp receipt (saved customers with a phone number only). */
  notifyWhatsapp?: boolean;
  /** The customer agreed at the counter to receive bills on WhatsApp. */
  whatsappOptIn?: boolean;
}

export type BuildSaleResult =
  | { ok: true; input: SaleInput; summary: CartSummary }
  | { ok: false; error: string; issues: CartIssue[] };

/**
 * Turn the cart into the exact payload the server accepts (saleInputSchema),
 * including the totals from the shared engine that the server will re-check.
 */
export function buildSaleInput(cart: CartState, ctx: PosContext, payments: PaymentEntry[], options: BuildSaleOptions = {}): BuildSaleResult {
  let summary: CartSummary;
  try {
    summary = computeCart(cart, ctx);
  } catch (error) {
    if (error instanceof GstEngineError) {
      const where = error.lineIndex !== undefined ? `Line ${error.lineIndex + 1}: ` : "";
      const message = `${where}${error.message}`;
      return { ok: false, error: message, issues: [{ code: "invalid_line", message }] };
    }
    throw error;
  }

  const issues = cartIssues(cart, ctx, summary);
  if (issues.length > 0) return { ok: false, error: issues[0].message, issues };

  const customer = cart.customer;
  const phone = customer?.phone.trim() ? normaliseMobile(customer.phone) : null;
  if (customer?.phone.trim() && !phone) {
    return { ok: false, error: "The customer's mobile number is not valid", issues: [] };
  }
  const email = customer?.email.trim().toLowerCase() || null;

  const paid = checkPayments(summary.totals.totalPaise, payments, { hasCustomerRecord: !!customer?.id });
  if (!paid.ok) return { ok: false, error: paid.error ?? "Check the payments", issues: [] };

  const notifyEmail = !!options.notifyEmail && !!email;
  const canWhatsapp = !!customer?.id && !!phone && (customer.whatsapp_opt_in || !!options.whatsappOptIn);
  const { totals } = summary;

  const input: SaleInput = {
    client_uuid: cart.clientUuid,
    outlet_id: ctx.outletId,
    supply_type: cart.supplyType,
    customer_id: customer?.id ?? null,
    customer: {
      name: customer?.name.trim() || null,
      phone,
      email,
      gstin: customer?.gstin.trim() ? validateGstin(customer.gstin).gstin : null,
      address: customer?.address.trim() || null,
      pincode: customer?.pincode.trim() || null,
      state_code: customer?.state_code || null,
    },
    delivery_state_code: cart.deliveryStateCode,
    place_of_supply_override: cart.placeOfSupplyOverride
      ? { state_code: cart.placeOfSupplyOverride.stateCode, reason: cart.placeOfSupplyOverride.reason.trim() }
      : null,
    lines: cart.lines.map((l, i) => ({
      product_id: l.productId,
      description: l.name,
      hsn_code: l.hsnCode,
      quantity: l.quantity,
      unit_code: l.unitCode,
      unit_price_paise: l.unitPricePaise,
      price_includes_tax: l.priceIncludesTax,
      discount_paise: summary.lineDiscountsPaise[i],
      gst_rate: l.gstRate,
      cess_rate: l.cessRate,
    })),
    bill_discount_paise: summary.billDiscountPaise,
    payments: payments
      .filter((p) => p.amountPaise > 0)
      .map((p) => ({ mode: p.mode, amount_paise: p.amountPaise, reference: p.reference.trim() || null })),
    notify: { email: notifyEmail, whatsapp: !!options.notifyWhatsapp && canWhatsapp },
    whatsapp_opt_in: !!options.whatsappOptIn && !!customer?.id && !customer.whatsapp_opt_in,
    notes: cart.notes.trim() || null,
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
  return { ok: true, input, summary };
}
