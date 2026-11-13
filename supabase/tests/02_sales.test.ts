import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  addMember,
  asService,
  asUser,
  createBusiness,
  createDb,
  createProduct,
  createUser,
  expectError,
  stockOf,
  type Db,
  type TestBusiness,
} from "./harness";
import { buildInvoicePayload, type PayloadOptions } from "./payload";

let db: Db;
let owner: string, cashier: string;
let biz: TestBusiness;
let shirt: string, rice: string, service: string;
let fy: string;

async function post(actor: string, opts: Omit<PayloadOptions, "businessId" | "outletId"> & { outletId?: string; businessId?: string }) {
  const payload = buildInvoicePayload({ businessId: biz.id, outletId: biz.outletId, ...opts });
  const result = await asService(db, (s) => s.rpc("post_sales_invoice", { p_actor: actor, p: JSON.stringify(payload) }));
  return { ...result, payload } as { invoice_id: string; invoice_number: string; duplicate: boolean; warnings: any[]; payload: ReturnType<typeof buildInvoicePayload> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@shop.in", "Owner");
  cashier = await createUser(db, "cashier@shop.in", "Cashier");
  biz = await createBusiness(db, owner, { prefix: "A" });
  await addMember(db, biz, cashier, "cashier");
  shirt = await createProduct(db, biz, { name: "Shirt", gst_rate: 5, sale_price_paise: 499_00, opening: 50 });
  rice = await createProduct(db, biz, { name: "Rice 1kg", gst_rate: 0, sale_price_paise: 80_00, opening: 20, price_includes_tax: false });
  service = await createProduct(db, biz, { name: "Alteration", gst_rate: 18, sale_price_paise: 100_00, track_inventory: false, price_includes_tax: false });
  fy = (await db.query<{ fy: string }>(`select public.financial_year(public.ist_today()) as fy`)).rows[0].fy;
});

describe("posting an invoice", () => {
  it("B2C intra-state: stores totals, lines, payments, stock and number in one go", async () => {
    const before = await stockOf(db, shirt, biz.outletId);
    const r = await post(cashier, {
      lines: [
        { productId: shirt, unitPricePaise: 499_00, gstRate: 5, quantity: 2, description: "Shirt" },
        { productId: service, unitPricePaise: 100_00, gstRate: 18, priceIncludesTax: false, description: "Alteration" },
      ],
    });
    expect(r.invoice_number).toMatch(new RegExp(`^A/${fy}/\\d{5}$`));
    expect(r.duplicate).toBe(false);

    const inv = (await db.query<any>(`select * from public.sales_invoices where id = $1`, [r.invoice_id])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(inv.document_type).toBe("tax_invoice");
    expect(inv.is_inter_state).toBe(false);
    expect(Number(inv.igst_paise)).toBe(0);
    expect(Number(inv.cgst_paise)).toBeGreaterThan(0);
    expect(Number(inv.total_paise)).toBe(r.payload.total_paise);
    expect(Number(inv.total_paise) % 100).toBe(0);
    expect(inv.seller_gstin).toBe("27AAPFU0939F1ZV");
    expect(inv.seller_state_code).toBe("27");
    expect(inv.status).toBe("posted");
    expect(inv.created_by).toBe(cashier);
    expect(inv.public_token).toMatch(/^[0-9a-f]{64}$/);
    expect(inv.amount_in_words).toMatch(/^Rupees .* Only$/);

    const items = (await db.query<any>(`select * from public.sales_invoice_items where invoice_id = $1 order by line_no`, [r.invoice_id])).rows; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.line_no)).toEqual([1, 2]);
    const pays = (await db.query<any>(`select * from public.sales_payments where invoice_id = $1`, [r.invoice_id])).rows; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(pays).toHaveLength(1);
    expect(Number(pays[0].amount_paise)).toBe(r.payload.total_paise);

    // Stock moved for the tracked product only.
    expect(await stockOf(db, shirt, biz.outletId)).toBe(before - 2);
    const moves = (await db.query<any>(`select * from public.stock_movements where source_id = $1`, [r.invoice_id])).rows; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(moves).toHaveLength(1);
    expect(moves[0].movement_type).toBe("sale");
    expect(Number(moves[0].quantity_delta)).toBe(-2);
  });

  it("B2B inter-state: charges IGST and requires the customer GSTIN", async () => {
    const customer = { name: "Gujarat Retail LLP", gstin: "24AAACC1206D1ZM", state_code: "24", address: "Ahmedabad" };
    await expectError(
      post(owner, { lines: [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5 }], supplyType: "b2b", placeOfSupply: "24", customer: { name: "No GSTIN" } }),
      /needs the customer's GSTIN/,
    );
    const r = await post(owner, {
      lines: [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5 }],
      supplyType: "b2b",
      placeOfSupply: "24",
      customer,
    });
    const inv = (await db.query<any>(`select * from public.sales_invoices where id = $1`, [r.invoice_id])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(inv.is_inter_state).toBe(true);
    expect(Number(inv.cgst_paise)).toBe(0);
    expect(Number(inv.sgst_paise)).toBe(0);
    expect(Number(inv.igst_paise)).toBe(r.payload.igst_paise);
    expect(Number(inv.igst_paise)).toBeGreaterThan(0);
    expect(inv.customer_gstin).toBe(customer.gstin);
    expect(inv.place_of_supply_state).toBe("24");
    expect(inv.supply_type).toBe("b2b");
  });

  it("rejects an inter-state flag that contradicts the place of supply", async () => {
    const payload = buildInvoicePayload({ businessId: biz.id, outletId: biz.outletId, lines: [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5 }] });
    payload.place_of_supply_state = "24"; // but is_inter_state is still false
    await expectError(asService(db, (s) => s.rpc("post_sales_invoice", { p_actor: owner, p: JSON.stringify(payload) })), /Inter-state flag/);
  });

  it("rejects totals that do not match the lines, and payments that do not match the total", async () => {
    const tampered = buildInvoicePayload({ businessId: biz.id, outletId: biz.outletId, lines: [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5 }] });
    tampered.taxable_paise -= 100;
    await expectError(asService(db, (s) => s.rpc("post_sales_invoice", { p_actor: owner, p: JSON.stringify(tampered) })), /do not match its lines/);

    await expectError(
      post(owner, { lines: [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5 }], payments: [{ mode: "cash", amount_paise: 100_00 }] }),
      /do not add up/,
    );
    await expectError(post(owner, { lines: [] }), /at least one item/);
  });

  it("split payments work; credit needs a customer and sets the amount due", async () => {
    await expectError(
      post(owner, { lines: [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5 }], payments: [{ mode: "credit", amount_paise: 499_00 }] }),
      /Select a customer/,
    );
    const customerId = randomUUID();
    await db.query(`insert into public.customers (id, business_id, name, phone) values ($1, $2, 'Ravi', '+919812345678')`, [customerId, biz.id]);
    const r = await post(owner, {
      lines: [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5 }],
      customerId,
      customer: { name: "Ravi", phone: "+919812345678" },
      payments: [
        { mode: "cash", amount_paise: 200_00 },
        { mode: "upi", amount_paise: 99_00, reference: "UTR123" },
        { mode: "credit", amount_paise: 200_00 },
      ],
    });
    const inv = (await db.query<any>(`select amount_due_paise from public.sales_invoices where id = $1`, [r.invoice_id])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(Number(inv.amount_due_paise)).toBe(200_00);

    // Collect part of the credit later.
    await expectError(
      asUser(db, owner, (s) => s.rpc("record_sale_collection", { p_invoice_id: r.invoice_id, p_mode: "upi", p_amount_paise: 300_00 })),
      /Only 200.00 is due/,
    );
    await asUser(db, owner, (s) => s.rpc("record_sale_collection", { p_invoice_id: r.invoice_id, p_mode: "upi", p_amount_paise: 150_00 }));
    const after = (await db.query<any>(`select amount_due_paise from public.sales_invoices where id = $1`, [r.invoice_id])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(Number(after.amount_due_paise)).toBe(50_00);
  });

  it("is idempotent on client_uuid", async () => {
    const clientUuid = randomUUID();
    const before = await stockOf(db, shirt, biz.outletId);
    const first = await post(cashier, { clientUuid, lines: [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5 }] });
    const second = await post(cashier, { clientUuid, lines: [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5 }] });
    expect(second.duplicate).toBe(true);
    expect(second.invoice_id).toBe(first.invoice_id);
    expect(second.invoice_number).toBe(first.invoice_number);
    expect(await stockOf(db, shirt, biz.outletId)).toBe(before - 1); // stock moved once only
  });
});

describe("permissions enforced while posting", () => {
  it("a cashier cannot change the price; an owner can and it is audited", async () => {
    await expectError(post(cashier, { lines: [{ productId: shirt, unitPricePaise: 400_00, gstRate: 5 }] }), /not allowed to change the price/);
    const r = await post(owner, { lines: [{ productId: shirt, unitPricePaise: 400_00, gstRate: 5 }] });
    const audit = await db.query(`select 1 from public.audit_log where action = 'sale.price_override' and entity_id = $1`, [r.invoice_id]);
    expect(audit.rows).toHaveLength(1);
  });

  it("enforces the role's max discount percent", async () => {
    // Cashier role: 0% → any discount is refused.
    await expectError(
      post(cashier, { lines: [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5, discountPaise: 10_00 }] }),
      /above your limit/,
    );
    // Give cashiers 10% and try 5% (ok) and 20% (refused, bill-level).
    await asUser(db, owner, (s) => s.query(`update public.roles set max_discount_percent = 10 where id = $1`, [biz.roles.cashier]));
    // …still refused: the Cashier system role has no sales.discount permission.
    await expectError(
      post(cashier, { lines: [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5, discountPaise: 10_00 }] }),
      /above your limit/,
    );
    // A custom role with sales.discount and a 10% ceiling.
    const senior = await createUser(db, "senior@shop.in");
    const roleId = await asUser(db, owner, async (s) => {
      const role = await s.one<{ id: string }>(
        `insert into public.roles (business_id, name, max_discount_percent) values ($1, 'Senior Cashier', 10) returning id`,
        [biz.id],
      );
      for (const perm of ["sales.create", "sales.view_own", "sales.discount", "products.view"]) {
        await s.query(`insert into public.role_permissions (role_id, permission) values ($1, $2)`, [role.id, perm]);
      }
      return role.id;
    });
    await addMember(db, biz, senior, roleId);
    const ok = await post(senior, { lines: [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5, quantity: 2 }], billDiscountPaise: 49_90 });
    expect(ok.payload.discount_paise).toBe(49_90);
    await expectError(
      post(senior, { lines: [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5, quantity: 2 }], billDiscountPaise: 199_60 }),
      /Discount of 20.00% is above your limit of 10.00%/,
    );
  });

  it("logs a place-of-supply override", async () => {
    const r = await post(owner, {
      lines: [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5 }],
      placeOfSupply: "29",
      posOverrideReason: "Customer taking delivery in Bengaluru",
    });
    const audit = await db.query<any>(`select after from public.audit_log where action = 'sale.place_of_supply_override' and entity_id = $1`, [r.invoice_id]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(audit.rows[0].after.place_of_supply_state).toBe("29");
  });
});

describe("document type by GST scheme", () => {
  it("composition → bill of supply with no tax; a tax invoice is refused", async () => {
    const o = await createUser(db, "comp@shop.in");
    const comp = await createBusiness(db, o, { scheme: "composition", prefix: "K" });
    const p = await createProduct(db, comp, { gst_rate: 5, sale_price_paise: 100_00, opening: 5 });
    const payload = buildInvoicePayload({ businessId: comp.id, outletId: comp.outletId, chargeTax: false, lines: [{ productId: p, unitPricePaise: 100_00, gstRate: 5 }] });
    const r = await asService(db, (s) => s.rpc("post_sales_invoice", { p_actor: o, p: JSON.stringify(payload) }));
    const inv = (await db.query<any>(`select * from public.sales_invoices where id = $1`, [r.invoice_id])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(inv.document_type).toBe("bill_of_supply");
    expect(Number(inv.cgst_paise) + Number(inv.sgst_paise) + Number(inv.igst_paise)).toBe(0);
    expect(Number(inv.total_paise)).toBe(100_00);

    const bad = buildInvoicePayload({ businessId: comp.id, outletId: comp.outletId, chargeTax: true, documentType: "tax_invoice", lines: [{ productId: p, unitPricePaise: 100_00, gstRate: 5 }] });
    await expectError(asService(db, (s) => s.rpc("post_sales_invoice", { p_actor: o, p: JSON.stringify(bad) })), /not valid for a composition business/);
  });

  it("unregistered → cash memo with no GSTIN on the document", async () => {
    const o = await createUser(db, "unreg@shop.in");
    const unreg = await createBusiness(db, o, { scheme: "unregistered", prefix: "U" });
    const p = await createProduct(db, unreg, { gst_rate: 18, sale_price_paise: 250_00, opening: 5 });
    const payload = buildInvoicePayload({ businessId: unreg.id, outletId: unreg.outletId, chargeTax: false, documentType: "cash_memo", lines: [{ productId: p, unitPricePaise: 250_00 }] });
    const r = await asService(db, (s) => s.rpc("post_sales_invoice", { p_actor: o, p: JSON.stringify(payload) }));
    const inv = (await db.query<any>(`select * from public.sales_invoices where id = $1`, [r.invoice_id])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(inv.document_type).toBe("cash_memo");
    expect(inv.seller_gstin).toBeNull();
  });

  it("a non-tax document can never carry tax (database constraint)", async () => {
    const payload = buildInvoicePayload({ businessId: biz.id, outletId: biz.outletId, documentType: "bill_of_supply", lines: [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5 }] });
    await expectError(asService(db, (s) => s.rpc("post_sales_invoice", { p_actor: owner, p: JSON.stringify(payload) })), /sales_invoices_no_tax_unless_tax_invoice/);
  });
});

describe("invoice numbering", () => {
  it("allocates consecutive numbers with no gaps or duplicates, even when requests race", async () => {
    const o = await createUser(db, "seq@shop.in");
    const b = await createBusiness(db, o, { prefix: "S" });
    const p = await createProduct(db, b, { sale_price_paise: 10_00, opening: 1000 });
    const results = await Promise.all(
      Array.from({ length: 40 }, () =>
        asService(db, (s) =>
          s.rpc("post_sales_invoice", {
            p_actor: o,
            p: JSON.stringify(buildInvoicePayload({ businessId: b.id, outletId: b.outletId, lines: [{ productId: p, unitPricePaise: 10_00 }] })),
          }),
        ),
      ),
    );
    const numbers = results.map((r) => r.invoice_number as string).sort();
    expect(new Set(numbers).size).toBe(40);
    expect(numbers[0]).toBe(`S/${fy}/00001`);
    expect(numbers[39]).toBe(`S/${fy}/00040`);
    const series = await db.query<{ next_number: string }>(`select next_number from public.invoice_series where business_id = $1 and document_type = 'invoice'`, [b.id]);
    expect(Number(series.rows[0].next_number)).toBe(41);
    expect(await stockOf(db, p, b.outletId)).toBe(960);
  });

  it("a failed post does not burn a number", async () => {
    const before = await db.query<{ next_number: string }>(`select next_number from public.invoice_series where business_id = $1 and prefix = 'A'`, [biz.id]);
    await expectError(post(cashier, { lines: [{ productId: shirt, unitPricePaise: 1_00, gstRate: 5 }] }), /not allowed to change the price/);
    const after = await db.query<{ next_number: string }>(`select next_number from public.invoice_series where business_id = $1 and prefix = 'A'`, [biz.id]);
    expect(after.rows[0].next_number).toBe(before.rows[0].next_number);
  });

  it("the series counter cannot be moved backwards, and a used series cannot be re-prefixed", async () => {
    await expectError(asUser(db, owner, (s) => s.query(`update public.invoice_series set next_number = 1 where business_id = $1 and prefix = 'A'`, [biz.id])), /cannot be moved backwards/);
    await expectError(asUser(db, owner, (s) => s.query(`update public.invoice_series set prefix = 'Z' where business_id = $1 and prefix = 'A'`, [biz.id])), /already issued numbers/);
    await expectError(
      asUser(db, owner, (s) => s.query(`insert into public.invoice_series (business_id, outlet_id, document_type, prefix, financial_year) values ($1, $2, 'invoice', 'TOOLONG', '2627')`, [biz.id, biz.outletId])),
      /check constraint/,
    );
  });

  it("refuses a number longer than 16 characters", async () => {
    await expectError(db.query(`select public.format_document_number('ABCD', '2627', 1000000)`), /longer than 16 characters/);
  });

  it("rolls the series over to a new financial year automatically", async () => {
    const o = await createUser(db, "fy@shop.in");
    const b = await createBusiness(db, o, { prefix: "F" });
    // Pretend the only series belongs to last year.
    await db.query(`update public.invoice_series set financial_year = '2021' where business_id = $1`, [b.id]);
    const p = await createProduct(db, b, { sale_price_paise: 10_00, opening: 10 });
    const r = await asService(db, (s) =>
      s.rpc("post_sales_invoice", { p_actor: o, p: JSON.stringify(buildInvoicePayload({ businessId: b.id, outletId: b.outletId, lines: [{ productId: p, unitPricePaise: 10_00 }] })) }),
    );
    expect(r.invoice_number).toBe(`F/${fy}/00001`);
  });
});

describe("POS device series (offline-capable)", () => {
  let deviceId: string;
  const key = "k".repeat(64);

  it("registers a device with its own prefix", async () => {
    deviceId = await asUser(db, owner, (s) => s.rpc("register_pos_device", { p_outlet_id: biz.outletId, p_name: "Counter 1", p_prefix: "c1", p_device_key_hash: key }));
    expect(deviceId).toBeTruthy();
    await expectError(
      asUser(db, owner, (s) => s.rpc("register_pos_device", { p_outlet_id: biz.outletId, p_name: "Counter 2", p_prefix: "C1", p_device_key_hash: "z".repeat(64) })),
      /already used/,
    );
    await expectError(
      asUser(db, cashier, (s) => s.rpc("register_pos_device", { p_outlet_id: biz.outletId, p_name: "Rogue", p_prefix: "R1", p_device_key_hash: "y".repeat(64) })),
      /Not allowed/,
    );
  });

  it("accepts device-issued numbers, validates them and flags gaps", async () => {
    const line = [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5 }];
    const r1 = await post(cashier, { deviceId, invoiceNumber: `C1/${fy}/00001`, source: "pos_offline", lines: line });
    expect(r1.invoice_number).toBe(`C1/${fy}/00001`);
    expect(r1.warnings).toEqual([]);

    // Same number from a different bill → conflict, never silently dropped or renumbered.
    await expectError(post(cashier, { deviceId, invoiceNumber: `C1/${fy}/00001`, source: "pos_offline", lines: line }), /already been used/);
    // Wrong prefix / wrong year / malformed.
    await expectError(post(cashier, { deviceId, invoiceNumber: `A/${fy}/00099`, source: "pos_offline", lines: line }), /does not belong to this device/);
    await expectError(post(cashier, { deviceId, invoiceNumber: `C1/2021/00002`, source: "pos_offline", lines: line }), /does not belong to this device/);
    await expectError(post(cashier, { deviceId, invoiceNumber: `C1/${fy}/2`, source: "pos_offline", lines: line }), /does not belong to this device/);

    // Skipping 00002 is accepted (the bill is already printed) but flagged for the owner.
    const r3 = await post(cashier, { deviceId, invoiceNumber: `C1/${fy}/00003`, source: "pos_offline", lines: line });
    expect(r3.warnings.map((w: { code: string }) => w.code)).toContain("series_gap");
    const gap = await db.query(`select 1 from public.audit_log where action = 'series.gap' and business_id = $1`, [biz.id]);
    expect(gap.rows).toHaveLength(1);

    // The late bill 00002 can still sync afterwards.
    const r2 = await post(cashier, { deviceId, invoiceNumber: `C1/${fy}/00002`, source: "pos_offline", lines: line });
    expect(r2.invoice_number).toBe(`C1/${fy}/00002`);
    const series = await db.query<{ next_number: string }>(`select next_number from public.invoice_series where pos_device_id = $1`, [deviceId]);
    expect(Number(series.rows[0].next_number)).toBe(4);
  });

  it("offline bills keep their own date and price, and the differences are logged, not rejected", async () => {
    const yesterday = (await db.query<{ d: string }>(`select (public.ist_today() - 1)::text as d`)).rows[0].d;
    const r = await post(cashier, {
      deviceId,
      invoiceNumber: `C1/${fy}/00004`,
      source: "pos_offline",
      invoiceDate: yesterday,
      lines: [{ productId: shirt, unitPricePaise: 450_00, gstRate: 5, discountPaise: 100_00 }], // stale price + discount over limit
    });
    const inv = (await db.query<any>(`select invoice_date::text as d, source from public.sales_invoices where id = $1`, [r.invoice_id])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(inv.d).toBe(yesterday);
    expect(inv.source).toBe("pos_offline");
    expect(r.warnings.map((w: { code: string }) => w.code)).toContain("discount_over_limit");
    const audit = await db.query(`select action from public.audit_log where business_id = $1 and action like 'sale.offline%'`, [biz.id]);
    expect(audit.rows.map((x: any) => x.action).sort()).toEqual(["sale.offline_discount_over_limit", "sale.offline_price_mismatch"]); // eslint-disable-line @typescript-eslint/no-explicit-any

    const tomorrow = (await db.query<{ d: string }>(`select (public.ist_today() + 1)::text as d`)).rows[0].d;
    await expectError(
      post(cashier, { deviceId, invoiceNumber: `C1/${fy}/00005`, source: "pos_offline", invoiceDate: tomorrow, lines: [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5 }] }),
      /future/,
    );
  });

  it("a deactivated device cannot post", async () => {
    await asUser(db, owner, (s) => s.query(`update public.pos_devices set is_active = false where id = $1`, [deviceId]));
    await expectError(
      post(cashier, { deviceId, invoiceNumber: `C1/${fy}/00005`, source: "pos_offline", lines: [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5 }] }),
      /deactivated/,
    );
  });
});

describe("stock rules", () => {
  it("blocks an online sale that would go negative when negative stock is off, and allows it when on", async () => {
    const o = await createUser(db, "stock@shop.in");
    const b = await createBusiness(db, o, { prefix: "N" });
    const p = await createProduct(db, b, { name: "Scarce", sale_price_paise: 10_00, opening: 2 });
    const payload = () => JSON.stringify(buildInvoicePayload({ businessId: b.id, outletId: b.outletId, lines: [{ productId: p, unitPricePaise: 10_00, quantity: 3 }] }));

    await asUser(db, o, (s) => s.query(`update public.businesses set allow_negative_stock = false where id = $1`, [b.id]));
    await expectError(asService(db, (s) => s.rpc("post_sales_invoice", { p_actor: o, p: payload() })), /Not enough stock for "Scarce"/);
    expect(await stockOf(db, p, b.outletId)).toBe(2); // rolled back completely
    expect((await db.query(`select 1 from public.sales_invoices where business_id = $1`, [b.id])).rows).toHaveLength(0);

    await asUser(db, o, (s) => s.query(`update public.businesses set allow_negative_stock = true where id = $1`, [b.id]));
    await asService(db, (s) => s.rpc("post_sales_invoice", { p_actor: o, p: payload() }));
    expect(await stockOf(db, p, b.outletId)).toBe(-1);
  });

  it("stock_levels always equals the sum of the ledger", async () => {
    const r = await db.query(`
      select sl.product_id from public.stock_levels sl
      join (select product_id, outlet_id, sum(quantity_delta) as q from public.stock_movements group by 1, 2) m
        on m.product_id = sl.product_id and m.outlet_id = sl.outlet_id
      where m.q <> sl.quantity`);
    expect(r.rows).toHaveLength(0);
  });

  it("the ledger is append-only", async () => {
    await expectError(db.query(`update public.stock_movements set quantity_delta = 1`), /append-only/);
    await expectError(db.query(`delete from public.stock_movements`), /append-only/);
  });
});

describe("posted invoices are immutable", () => {
  it("amounts cannot be updated or deleted, even by the database owner", async () => {
    const r = await post(owner, { lines: [{ productId: rice, unitPricePaise: 80_00, gstRate: 0, priceIncludesTax: false }] });
    await expectError(db.query(`update public.sales_invoices set total_paise = 1, taxable_paise = 1 where id = $1`, [r.invoice_id]), /cannot be edited/);
    await expectError(db.query(`update public.sales_invoices set customer_name = 'x' where id = $1`, [r.invoice_id]), /cannot be edited/);
    await expectError(db.query(`delete from public.sales_invoices where id = $1`, [r.invoice_id]), /cannot be deleted/);
    await expectError(db.query(`update public.sales_invoice_items set quantity = 99 where invoice_id = $1`, [r.invoice_id]), /append-only/);
    await expectError(db.query(`delete from public.sales_payments where invoice_id = $1`, [r.invoice_id]), /append-only/);
  });
});

describe("deleting a customer", () => {
  it("unlinks their bills but keeps the printed details; relinking is refused", async () => {
    const customerId = randomUUID();
    await db.query(`insert into public.customers (id, business_id, name, phone) values ($1, $2, 'Temp Customer', '+919700000001')`, [customerId, biz.id]);
    const r = await post(owner, { lines: [{ productId: rice, unitPricePaise: 80_00, gstRate: 0, priceIncludesTax: false }], customerId, customer: { name: "Temp Customer", phone: "+919700000001" } });
    await asUser(db, owner, (s) => s.query(`delete from public.customers where id = $1`, [customerId]));
    const inv = (await db.query<any>(`select customer_id, customer_name from public.sales_invoices where id = $1`, [r.invoice_id])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(inv).toEqual({ customer_id: null, customer_name: "Temp Customer" });
    const other = randomUUID();
    await db.query(`insert into public.customers (id, business_id, name) values ($1, $2, 'Other')`, [other, biz.id]);
    await expectError(db.query(`update public.sales_invoices set customer_id = $1 where id = $2`, [other, r.invoice_id]), /cannot be edited/);
  });
});

describe("cancellation", () => {
  it("needs permission and a reason, restores stock, keeps the number and is audited", async () => {
    const before = await stockOf(db, shirt, biz.outletId);
    const r = await post(cashier, { lines: [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5, quantity: 3 }] });
    expect(await stockOf(db, shirt, biz.outletId)).toBe(before - 3);

    await expectError(asUser(db, cashier, (s) => s.rpc("cancel_sales_invoice", { p_invoice_id: r.invoice_id, p_reason: "wrong item" })), /not allowed/i);
    await expectError(asUser(db, owner, (s) => s.rpc("cancel_sales_invoice", { p_invoice_id: r.invoice_id, p_reason: " " })), /reason is required/);

    await asUser(db, owner, (s) => s.rpc("cancel_sales_invoice", { p_invoice_id: r.invoice_id, p_reason: "Customer changed mind" }));
    expect(await stockOf(db, shirt, biz.outletId)).toBe(before);
    const inv = (await db.query<any>(`select status, invoice_number, cancel_reason, cancelled_by from public.sales_invoices where id = $1`, [r.invoice_id])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(inv).toMatchObject({ status: "cancelled", invoice_number: r.invoice_number, cancel_reason: "Customer changed mind", cancelled_by: owner });
    const moves = await db.query<any>(`select movement_type from public.stock_movements where source_id = $1 order by created_at`, [r.invoice_id]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(moves.rows.map((m) => m.movement_type).sort()).toEqual(["sale", "sale_cancel"]);
    expect((await db.query(`select 1 from public.audit_log where action = 'sale.cancelled' and entity_id = $1`, [r.invoice_id])).rows).toHaveLength(1);

    await expectError(asUser(db, owner, (s) => s.rpc("cancel_sales_invoice", { p_invoice_id: r.invoice_id, p_reason: "again" })), /already cancelled/);

    // The number is never reused: the next bill gets the next number.
    const next = await post(cashier, { lines: [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5 }] });
    expect(next.invoice_number > r.invoice_number).toBe(true);
  });

  it("is limited to the same day by default, and the window is configurable", async () => {
    const o = await createUser(db, "window@shop.in");
    const b = await createBusiness(db, o, { prefix: "W" });
    const p = await createProduct(db, b, { sale_price_paise: 10_00, opening: 10 });
    const device = await asUser(db, o, (s) => s.rpc("register_pos_device", { p_outlet_id: b.outletId, p_name: "T", p_prefix: "W1", p_device_key_hash: "w".repeat(64) }));
    const twoDaysAgo = (await db.query<{ d: string }>(`select (public.ist_today() - 2)::text as d`)).rows[0].d;
    const oldFy = (await db.query<{ fy: string }>(`select public.financial_year(public.ist_today() - 2) as fy`)).rows[0].fy;
    const r = await asService(db, (s) =>
      s.rpc("post_sales_invoice", {
        p_actor: o,
        p: JSON.stringify(buildInvoicePayload({ businessId: b.id, outletId: b.outletId, deviceId: device, invoiceNumber: `W1/${oldFy}/00001`, source: "pos_offline", invoiceDate: twoDaysAgo, lines: [{ productId: p, unitPricePaise: 10_00 }] })),
      }),
    );
    await expectError(asUser(db, o, (s) => s.rpc("cancel_sales_invoice", { p_invoice_id: r.invoice_id, p_reason: "too late" })), /too old to cancel/);
    await asUser(db, o, (s) => s.query(`update public.businesses set cancel_window_days = 7 where id = $1`, [b.id]));
    await asUser(db, o, (s) => s.rpc("cancel_sales_invoice", { p_invoice_id: r.invoice_id, p_reason: "within a week" }));
  });
});

describe("credit notes", () => {
  it("partial then final return: amounts never drift and stock comes back", async () => {
    const before = await stockOf(db, shirt, biz.outletId);
    const r = await post(owner, { lines: [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5, quantity: 3 }] });
    const inv = (await db.query<any>(`select * from public.sales_invoices where id = $1`, [r.invoice_id])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    const item = (await db.query<any>(`select * from public.sales_invoice_items where invoice_id = $1`, [r.invoice_id])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any

    await expectError(
      asUser(db, cashier, (s) => s.rpc("create_credit_note", { p_invoice_id: r.invoice_id, p_items: JSON.stringify([{ invoice_item_id: item.id, quantity: 1 }]), p_reason: "size issue" })),
      /not allowed/i,
    );
    await expectError(
      asUser(db, owner, (s) => s.rpc("create_credit_note", { p_invoice_id: r.invoice_id, p_items: JSON.stringify([{ invoice_item_id: item.id, quantity: 4 }]), p_reason: "size issue" })),
      /Only 3 of/,
    );

    const cn1 = await asUser(db, owner, (s) =>
      s.rpc("create_credit_note", { p_invoice_id: r.invoice_id, p_items: JSON.stringify([{ invoice_item_id: item.id, quantity: 1 }]), p_reason: "size issue", p_restock: true }),
    );
    expect(await stockOf(db, shirt, biz.outletId)).toBe(before - 2);
    const note1 = (await db.query<any>(`select * from public.credit_notes where id = $1`, [cn1])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(note1.credit_note_number).toBe(`ACN/${fy}/00001`);
    expect(Number(note1.round_off_paise)).toBe(0);
    expect(Number(note1.refund_paise)).toBe(Number(note1.total_paise));

    const cn2 = await asUser(db, owner, (s) =>
      s.rpc("create_credit_note", { p_invoice_id: r.invoice_id, p_items: JSON.stringify([{ invoice_item_id: item.id, quantity: 2 }]), p_reason: "returned rest", p_restock: false }),
    );
    expect(await stockOf(db, shirt, biz.outletId)).toBe(before - 2); // restock = false → stock unchanged
    const note2 = (await db.query<any>(`select * from public.credit_notes where id = $1`, [cn2])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(note2.credit_note_number).toBe(`ACN/${fy}/00002`);

    // Everything returned → the two notes add up to the invoice exactly, including round-off.
    const sum = (k: string) => Number(note1[k]) + Number(note2[k]);
    expect(sum("taxable_paise")).toBe(Number(inv.taxable_paise));
    expect(sum("cgst_paise")).toBe(Number(inv.cgst_paise));
    expect(sum("sgst_paise")).toBe(Number(inv.sgst_paise));
    expect(sum("round_off_paise")).toBe(Number(inv.round_off_paise));
    expect(sum("total_paise")).toBe(Number(inv.total_paise));

    await expectError(
      asUser(db, owner, (s) => s.rpc("create_credit_note", { p_invoice_id: r.invoice_id, p_items: JSON.stringify([{ invoice_item_id: item.id, quantity: 1 }]), p_reason: "one more" })),
      /Only 0 of/,
    );
    // A bill with a credit note can no longer be cancelled.
    await expectError(asUser(db, owner, (s) => s.rpc("cancel_sales_invoice", { p_invoice_id: r.invoice_id, p_reason: "cancel anyway" })), /credit note against it/);
    expect((await db.query(`select 1 from public.audit_log where action = 'sale.credit_note' and business_id = $1`, [biz.id])).rows.length).toBeGreaterThanOrEqual(2);
  });

  it("adjusts against the customer's outstanding credit before refunding", async () => {
    const customerId = randomUUID();
    await db.query(`insert into public.customers (id, business_id, name) values ($1, $2, 'Udhaar Customer')`, [customerId, biz.id]);
    const r = await post(owner, {
      lines: [{ productId: rice, unitPricePaise: 80_00, gstRate: 0, priceIncludesTax: false, quantity: 5 }],
      customerId,
      customer: { name: "Udhaar Customer" },
      payments: [{ mode: "cash", amount_paise: 100_00 }, { mode: "credit", amount_paise: 300_00 }],
    });
    const item = (await db.query<any>(`select id from public.sales_invoice_items where invoice_id = $1`, [r.invoice_id])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    const cn = await asUser(db, owner, (s) =>
      s.rpc("create_credit_note", { p_invoice_id: r.invoice_id, p_items: JSON.stringify([{ invoice_item_id: item.id, quantity: 5 }]), p_reason: "all returned", p_refund_mode: "upi" }),
    );
    const note = (await db.query<any>(`select * from public.credit_notes where id = $1`, [cn])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(Number(note.total_paise)).toBe(400_00);
    expect(Number(note.adjusted_against_due_paise)).toBe(300_00);
    expect(Number(note.refund_paise)).toBe(100_00);
    expect(note.refund_mode).toBe("upi");
    const inv = (await db.query<any>(`select amount_due_paise from public.sales_invoices where id = $1`, [r.invoice_id])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(Number(inv.amount_due_paise)).toBe(0);
  });

  it("cannot be issued against a cancelled bill", async () => {
    const r = await post(owner, { lines: [{ productId: rice, unitPricePaise: 80_00, gstRate: 0, priceIncludesTax: false }] });
    const item = (await db.query<any>(`select id from public.sales_invoice_items where invoice_id = $1`, [r.invoice_id])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    await asUser(db, owner, (s) => s.rpc("cancel_sales_invoice", { p_invoice_id: r.invoice_id, p_reason: "mistake" }));
    await expectError(
      asUser(db, owner, (s) => s.rpc("create_credit_note", { p_invoice_id: r.invoice_id, p_items: JSON.stringify([{ invoice_item_id: item.id, quantity: 1 }]), p_reason: "return" })),
      /cancelled/,
    );
  });
});

describe("receipts outbox", () => {
  it("queues jobs in the same transaction, respects opt-in, and retries with backoff", async () => {
    const customerId = randomUUID();
    await db.query(`insert into public.customers (id, business_id, name, phone, email) values ($1, $2, 'Meena', '+919900112233', 'meena@example.com')`, [customerId, biz.id]);
    const customer = { name: "Meena", phone: "+919900112233", email: "meena@example.com" };

    // Not opted in → email only, even though WhatsApp was requested.
    const r1 = await post(cashier, { lines: [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5 }], customerId, customer, notify: { email: true, whatsapp: true } });
    let jobs = (await db.query<any>(`select channel, recipient, status from public.notification_jobs where related_id = $1`, [r1.invoice_id])).rows; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(jobs).toEqual([{ channel: "email", recipient: "meena@example.com", status: "queued" }]);

    // Opt-in captured at the counter → WhatsApp is queued and the consent is stored with a timestamp.
    const r2 = await post(cashier, { lines: [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5 }], customerId, customer, notify: { whatsapp: true }, whatsappOptIn: true });
    jobs = (await db.query<any>(`select channel, recipient from public.notification_jobs where related_id = $1`, [r2.invoice_id])).rows; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(jobs).toEqual([{ channel: "whatsapp", recipient: "+919900112233" }]);
    const c = (await db.query<any>(`select whatsapp_opt_in, whatsapp_opt_in_at from public.customers where id = $1`, [customerId])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(c.whatsapp_opt_in).toBe(true);
    expect(c.whatsapp_opt_in_at).not.toBeNull();

    // A failed post queues nothing.
    const countBefore = (await db.query<{ n: number }>(`select count(*)::int as n from public.notification_jobs`)).rows[0].n;
    await expectError(post(cashier, { lines: [{ productId: shirt, unitPricePaise: 1_00, gstRate: 5 }], customerId, customer, notify: { email: true } }), /price/);
    expect((await db.query<{ n: number }>(`select count(*)::int as n from public.notification_jobs`)).rows[0].n).toBe(countBefore);

    // Worker: claim → fail → backoff → … → give up after 5 attempts.
    const claimed = await asService(db, (s) => s.query<any>(`select * from public.claim_notification_jobs(50)`)); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(claimed.length).toBeGreaterThanOrEqual(2);
    expect(claimed.every((j) => j.status === "sending" && j.attempts === 1)).toBe(true);
    // Nothing left to claim while those are in flight.
    expect(await asService(db, (s) => s.query(`select * from public.claim_notification_jobs(50)`))).toHaveLength(0);

    const [first, second] = claimed;
    await asService(db, (s) => s.rpc("complete_notification_job", { p_job_id: first.id, p_success: true, p_provider_message_id: "msg_1" }));
    await asService(db, (s) => s.rpc("complete_notification_job", { p_job_id: second.id, p_success: false, p_error: "timeout" }));
    const sent = (await db.query<any>(`select status, provider_message_id, sent_at from public.notification_jobs where id = $1`, [first.id])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(sent.status).toBe("sent");
    expect(sent.provider_message_id).toBe("msg_1");
    let failed = (await db.query<any>(`select status, attempts, last_error, next_attempt_at > now() + interval '1 minute' as backed_off from public.notification_jobs where id = $1`, [second.id])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(failed).toMatchObject({ status: "queued", attempts: 1, last_error: "timeout", backed_off: true });

    for (let attempt = 2; attempt <= 5; attempt++) {
      await db.query(`update public.notification_jobs set next_attempt_at = now() where id = $1`, [second.id]);
      const again = await asService(db, (s) => s.query<any>(`select * from public.claim_notification_jobs(50)`)); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(again.map((j) => j.id)).toContain(second.id);
      for (const j of again) {
        await asService(db, (s) => s.rpc("complete_notification_job", { p_job_id: j.id, p_success: j.id !== second.id, p_error: "timeout" }));
      }
    }
    failed = (await db.query<any>(`select status, attempts from public.notification_jobs where id = $1`, [second.id])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(failed).toMatchObject({ status: "failed", attempts: 5 });

    // Resend from the invoice page puts it back in the queue.
    await asUser(db, owner, (s) => s.rpc("retry_notification_job", { p_job_id: second.id }));
    failed = (await db.query<any>(`select status, attempts from public.notification_jobs where id = $1`, [second.id])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(failed).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("manual send: WhatsApp only with opt-in; email to any address", async () => {
    const r = await post(cashier, { lines: [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5 }], customer: { name: "Walk-in", phone: "+919811111111" } });
    await expectError(asUser(db, cashier, (s) => s.rpc("send_invoice_notification", { p_invoice_id: r.invoice_id, p_channel: "whatsapp" })), /not opted in/);
    await expectError(asUser(db, cashier, (s) => s.rpc("send_invoice_notification", { p_invoice_id: r.invoice_id, p_channel: "email" })), /Enter an email/);
    const job = await asUser(db, cashier, (s) => s.rpc("send_invoice_notification", { p_invoice_id: r.invoice_id, p_channel: "email", p_recipient: "a@b.in" }));
    expect(job).toBeTruthy();
  });

  it("the owner can revoke and restore the public link", async () => {
    const r = await post(cashier, { lines: [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5 }] });
    await expectError(asUser(db, cashier, (s) => s.rpc("set_invoice_public_link", { p_invoice_id: r.invoice_id, p_enabled: false })), /owner/i);
    await asUser(db, owner, (s) => s.rpc("set_invoice_public_link", { p_invoice_id: r.invoice_id, p_enabled: false }));
    let inv = (await db.query<any>(`select public_token_revoked_at from public.sales_invoices where id = $1`, [r.invoice_id])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(inv.public_token_revoked_at).not.toBeNull();
    await asUser(db, owner, (s) => s.rpc("set_invoice_public_link", { p_invoice_id: r.invoice_id, p_enabled: true }));
    inv = (await db.query<any>(`select public_token_revoked_at from public.sales_invoices where id = $1`, [r.invoice_id])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(inv.public_token_revoked_at).toBeNull();
  });
});

describe("rate limiter", () => {
  it("allows up to the limit per window", async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(await asService(db, (s) => s.rpc("check_rate_limit", { p_key: "test:1.2.3.4", p_limit: 3, p_window_seconds: 3600 })));
    }
    expect(results).toEqual([true, true, true, false, false]);
    expect(await asService(db, (s) => s.rpc("check_rate_limit", { p_key: "test:5.6.7.8", p_limit: 3, p_window_seconds: 3600 }))).toBe(true);
  });
});
