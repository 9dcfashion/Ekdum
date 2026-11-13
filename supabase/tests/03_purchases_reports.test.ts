import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { computeInvoice } from "@/lib/gst";
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
import { buildInvoicePayload } from "./payload";

let db: Db;
let owner: string, manager: string, cashier: string, dispatch: string;
let biz: TestBusiness;
let vendorId: string;
let pen: string, book: string;
let today: string, yesterday: string, fy: string;

function purchasePayload(over: Record<string, unknown> = {}, lines = [{ productId: pen as string | null, qty: 100, ratePaise: 5_00, gstRate: 18 }]) {
  const totals = computeInvoice({
    lines: lines.map((l) => ({ quantity: l.qty, unitPricePaise: l.ratePaise, priceIncludesTax: false, gstRate: l.gstRate })),
    chargeTax: true,
    isInterState: false,
    roundOff: false,
  });
  return {
    business_id: biz.id,
    outlet_id: biz.outletId,
    vendor_id: vendorId,
    vendor_invoice_number: `VB-${randomUUID().slice(0, 6)}`,
    vendor_invoice_date: today,
    place_of_supply_state: "27",
    is_inter_state: false,
    subtotal_paise: totals.subtotalPaise,
    discount_paise: 0,
    taxable_paise: totals.taxablePaise,
    cgst_paise: totals.cgstPaise,
    sgst_paise: totals.sgstPaise,
    igst_paise: 0,
    cess_paise: 0,
    round_off_paise: 0,
    total_paise: totals.totalPaise,
    attachment_paths: [`${biz.id}/bills/bill.jpg`],
    items: lines.map((l, i) => ({
      product_id: l.productId,
      description: `Line ${i + 1}`,
      hsn_code: "9608",
      quantity: l.qty,
      unit_code: "PCS",
      rate_paise: l.ratePaise,
      taxable_paise: totals.lines[i].taxablePaise,
      gst_rate: l.gstRate,
      cgst_paise: totals.lines[i].cgstPaise,
      sgst_paise: totals.lines[i].sgstPaise,
      igst_paise: 0,
      total_paise: totals.lines[i].totalPaise,
    })),
    ...over,
  };
}

const save = (actor: string, payload: Record<string, unknown>) =>
  asService(db, (s) => s.rpc<string>("save_purchase_bill", { p_actor: actor, p: JSON.stringify(payload) }));

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@p.in", "Owner");
  manager = await createUser(db, "manager@p.in", "Manager");
  cashier = await createUser(db, "cashier@p.in", "Cashier");
  dispatch = await createUser(db, "dispatch@p.in", "Dispatch");
  biz = await createBusiness(db, owner, { prefix: "P" });
  await addMember(db, biz, manager, "manager");
  await addMember(db, biz, cashier, "cashier");
  await addMember(db, biz, dispatch, "dispatch");
  vendorId = randomUUID();
  await db.query(`insert into public.vendors (id, business_id, name, gstin, state_code) values ($1, $2, 'Pen Wholesale', '27AAACC1206D1ZS', '27')`, [vendorId, biz.id]).catch(async () => {
    await db.query(`insert into public.vendors (id, business_id, name, state_code) values ($1, $2, 'Pen Wholesale', '27')`, [vendorId, biz.id]);
  });
  pen = await createProduct(db, biz, { name: "Pen", gst_rate: 18, sale_price_paise: 10_00, low_stock_threshold: 20 });
  book = await createProduct(db, biz, { name: "Notebook", gst_rate: 5, sale_price_paise: 60_00, opening: 5, low_stock_threshold: 10 });
  const d = (await db.query<{ t: string; y: string; fy: string }>(
    `select public.ist_today()::text as t, (public.ist_today() - 1)::text as y, public.financial_year(public.ist_today()) as fy`,
  )).rows[0];
  today = d.t;
  yesterday = d.y;
  fy = d.fy;
});

describe("purchases", () => {
  it("draft → edit → post increases stock, records cost and locks the bill", async () => {
    const payload = purchasePayload();
    const billId = await save(manager, payload);
    expect(await stockOf(db, pen, biz.outletId)).toBe(0); // a draft does not touch stock

    // Edit the draft: change quantity.
    const edited = purchasePayload({ id: billId, vendor_invoice_number: payload.vendor_invoice_number }, [{ productId: pen, qty: 120, ratePaise: 5_00, gstRate: 18 }]);
    await save(manager, edited);
    const items = await db.query(`select 1 from public.purchase_bill_items where purchase_bill_id = $1`, [billId]);
    expect(items.rows).toHaveLength(1);

    await asUser(db, manager, (s) => s.rpc("post_purchase_bill", { p_bill_id: billId }));
    expect(await stockOf(db, pen, biz.outletId)).toBe(120);
    const bill = (await db.query<any>(`select status, posted_by, financial_year, total_paise from public.purchase_bills where id = $1`, [billId])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(bill).toMatchObject({ status: "posted", posted_by: manager, financial_year: fy });
    expect(Number(bill.total_paise)).toBe(708_00);
    const cost = (await db.query<any>(`select purchase_price_paise from public.product_costs where product_id = $1`, [pen])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(Number(cost.purchase_price_paise)).toBe(5_00);

    // Locked.
    await expectError(save(manager, { ...edited, notes: "sneaky edit" }), /Only draft purchase bills can be edited/);
    await expectError(db.query(`update public.purchase_bills set total_paise = 1, taxable_paise = 1, cgst_paise = 0, sgst_paise = 0 where id = $1`, [billId]), /cannot be edited/);
    await expectError(db.query(`update public.purchase_bill_items set quantity = 1 where purchase_bill_id = $1`, [billId]), /cannot be changed/);
    await expectError(db.query(`delete from public.purchase_bills where id = $1`, [billId]), /cannot be deleted/);
    await expectError(asUser(db, manager, (s) => s.rpc("post_purchase_bill", { p_bill_id: billId })), /already posted/);
  });

  it("needs a vendor, a bill number and items before posting", async () => {
    const draft = await save(manager, purchasePayload({ vendor_id: null, vendor_invoice_number: null }));
    await expectError(asUser(db, manager, (s) => s.rpc("post_purchase_bill", { p_bill_id: draft })), /Select a vendor/);
    const noNumber = await save(manager, purchasePayload({ vendor_invoice_number: "" }));
    await expectError(asUser(db, manager, (s) => s.rpc("post_purchase_bill", { p_bill_id: noNumber })), /invoice number and date/);
    const empty = await save(manager, { ...purchasePayload({}, []), });
    await expectError(asUser(db, manager, (s) => s.rpc("post_purchase_bill", { p_bill_id: empty })), /at least one item/);
    await expectError(save(manager, purchasePayload({ vendor_invoice_date: "2999-01-01" })), /future/);
  });

  it("rejects totals that do not match the lines", async () => {
    const p = purchasePayload();
    p.taxable_paise += 1;
    p.total_paise += 1;
    await expectError(save(manager, p), /do not match its lines/);
  });

  it("the same vendor invoice number cannot be entered twice in a year", async () => {
    const number = "DUP-001";
    await save(manager, purchasePayload({ vendor_invoice_number: number }));
    await expectError(save(manager, purchasePayload({ vendor_invoice_number: "dup-001" })), /purchase_bills_vendor_invoice_uniq/);
  });

  it("cashiers cannot enter or see purchases; managers can", async () => {
    await expectError(save(cashier, purchasePayload()), /Not allowed/);
    await asUser(db, cashier, async (s) => expect(await s.query(`select 1 from public.purchase_bills`)).toHaveLength(0));
    await asUser(db, manager, async (s) => expect((await s.query(`select 1 from public.purchase_bills`)).length).toBeGreaterThan(0));
  });

  it("payments roll up into the payment status and cannot exceed the total", async () => {
    const billId = await save(manager, purchasePayload());
    await expectError(
      asUser(db, manager, (s) => s.query(`insert into public.purchase_payments (purchase_bill_id, business_id, amount_paise, mode) values ($1, $2, 100, 'cash')`, [billId, biz.id])),
      /posted purchase bill/,
    );
    await asUser(db, manager, (s) => s.rpc("post_purchase_bill", { p_bill_id: billId }));
    const status = async () => (await db.query<any>(`select payment_status, amount_paid_paise from public.purchase_bills where id = $1`, [billId])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any

    await asUser(db, manager, (s) => s.query(`insert into public.purchase_payments (purchase_bill_id, business_id, amount_paise, mode, reference) values ($1, $2, 200_00, 'upi', 'UTR1')`, [billId, biz.id]));
    expect(await status()).toMatchObject({ payment_status: "partial" });
    await expectError(
      asUser(db, manager, (s) => s.query(`insert into public.purchase_payments (purchase_bill_id, business_id, amount_paise, mode) values ($1, $2, 500_00, 'cash')`, [billId, biz.id])),
      /cannot be more than the bill total/,
    );
    await asUser(db, manager, (s) => s.query(`insert into public.purchase_payments (purchase_bill_id, business_id, amount_paise, mode) values ($1, $2, 390_00, 'bank_transfer')`, [billId, biz.id]));
    const paid = await status();
    expect(paid.payment_status).toBe("paid");
    expect(Number(paid.amount_paid_paise)).toBe(590_00);

    const payables = await asUser(db, manager, (s) => s.query<any>(`select * from public.vendor_payables($1)`, [biz.id])); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(payables).toHaveLength(1);
    expect(Number(payables[0].outstanding_paise)).toBe(708_00); // the first bill is still unpaid

    // Cannot cancel while payments exist.
    await expectError(asUser(db, manager, (s) => s.rpc("cancel_purchase_bill", { p_bill_id: billId, p_reason: "wrong bill" })), /Remove the recorded payments/);
  });

  it("cancelling a posted bill reverses its stock; cancelling a draft deletes it", async () => {
    const before = await stockOf(db, pen, biz.outletId);
    const billId = await save(manager, purchasePayload({}, [{ productId: pen, qty: 30, ratePaise: 5_00, gstRate: 18 }]));
    await asUser(db, manager, (s) => s.rpc("post_purchase_bill", { p_bill_id: billId }));
    expect(await stockOf(db, pen, biz.outletId)).toBe(before + 30);
    await expectError(asUser(db, manager, (s) => s.rpc("cancel_purchase_bill", { p_bill_id: billId, p_reason: "" })), /reason is required/);
    await asUser(db, manager, (s) => s.rpc("cancel_purchase_bill", { p_bill_id: billId, p_reason: "Entered twice" }));
    expect(await stockOf(db, pen, biz.outletId)).toBe(before);
    const moves = await db.query<any>(`select movement_type from public.stock_movements where source_id = $1`, [billId]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(moves.rows.map((m) => m.movement_type).sort()).toEqual(["purchase", "purchase_cancel"]);

    const draft = await save(manager, purchasePayload());
    await asUser(db, manager, (s) => s.rpc("cancel_purchase_bill", { p_bill_id: draft, p_reason: "" }));
    expect((await db.query(`select 1 from public.purchase_bills where id = $1`, [draft])).rows).toHaveLength(0);
  });
});

describe("inventory", () => {
  it("opening stock can be set once, before any other movement", async () => {
    const p = await createProduct(db, biz, { name: "Eraser" });
    await asUser(db, manager, (s) => s.rpc("set_opening_stock", { p_product_id: p, p_outlet_id: biz.outletId, p_quantity: 40 }));
    expect(await stockOf(db, p, biz.outletId)).toBe(40);
    await expectError(asUser(db, manager, (s) => s.rpc("set_opening_stock", { p_product_id: p, p_outlet_id: biz.outletId, p_quantity: 10 })), /Opening stock can only be set/);
    await expectError(asUser(db, cashier, (s) => s.rpc("set_opening_stock", { p_product_id: p, p_outlet_id: biz.outletId, p_quantity: 10 })), /Not allowed/);
  });

  it("adjustments need a reason and are audited with before/after", async () => {
    const before = await stockOf(db, book, biz.outletId);
    await expectError(asUser(db, manager, (s) => s.rpc("adjust_stock", { p_outlet_id: biz.outletId, p_product_id: book, p_quantity_delta: -1, p_reason: "because" })), /reason is required/);
    await expectError(asUser(db, manager, (s) => s.rpc("adjust_stock", { p_outlet_id: biz.outletId, p_product_id: book, p_quantity_delta: -1, p_reason: "other" })), /add a note/);
    await expectError(asUser(db, manager, (s) => s.rpc("adjust_stock", { p_outlet_id: biz.outletId, p_product_id: book, p_quantity_delta: 0, p_reason: "recount" })), /cannot be zero/);

    const moveId = await asUser(db, manager, (s) => s.rpc("adjust_stock", { p_outlet_id: biz.outletId, p_product_id: book, p_quantity_delta: -2, p_reason: "damage", p_note: "Water damage" }));
    expect(await stockOf(db, book, biz.outletId)).toBe(before - 2);
    const audit = (await db.query<any>(`select before, after, actor_id from public.audit_log where action = 'stock.adjusted' and entity_id = $1`, [moveId])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(audit.actor_id).toBe(manager);
    expect(Number(audit.before.quantity)).toBe(before);
    expect(Number(audit.after.quantity)).toBe(before - 2);
    expect(audit.after.reason).toBe("damage");
  });

  it("respects allow_negative_stock for adjustments", async () => {
    await asUser(db, owner, (s) => s.query(`update public.businesses set allow_negative_stock = false where id = $1`, [biz.id]));
    await expectError(asUser(db, manager, (s) => s.rpc("adjust_stock", { p_outlet_id: biz.outletId, p_product_id: book, p_quantity_delta: -999, p_reason: "theft" })), /Not enough stock/);
    await asUser(db, owner, (s) => s.query(`update public.businesses set allow_negative_stock = true where id = $1`, [biz.id]));
  });

  it("the ledger reconciles with stock levels after everything above", async () => {
    const r = await db.query(`
      select sl.product_id from public.stock_levels sl
      join (select product_id, outlet_id, sum(quantity_delta) as q from public.stock_movements group by 1, 2) m
        on m.product_id = sl.product_id and m.outlet_id = sl.outlet_id
      where m.q <> sl.quantity`);
    expect(r.rows).toHaveLength(0);
    const orphan = await db.query(`
      select 1 from (select product_id, outlet_id from public.stock_movements group by 1, 2) m
      left join public.stock_levels sl on sl.product_id = m.product_id and sl.outlet_id = m.outlet_id
      where sl.product_id is null`);
    expect(orphan.rows).toHaveLength(0);
  });
});

describe("shipments", () => {
  let shipmentId: string;
  let courierId: string;

  it("dispatch staff can create a shipment and every status change lands on the timeline", async () => {
    courierId = await asUser(db, owner, async (s) =>
      (await s.one<{ id: string }>(`insert into public.courier_partners (business_id, name, tracking_url_template) values ($1, 'Speedy', 'https://example.com/track?awb={awb}') returning id`, [biz.id])).id,
    );
    shipmentId = await asUser(db, dispatch, async (s) =>
      (await s.one<{ id: string }>(
        `insert into public.shipments (business_id, outlet_id, recipient_name, recipient_phone, pincode, state_code, courier_partner_id, tracking_number, receipt_photo_paths, created_by)
         values ($1, $2, 'Anita', '+919822334455', '560001', '29', $3, 'AWB123456', $4, $5) returning id`,
        [biz.id, biz.outletId, courierId, `{${biz.id}/receipts/a.jpg}`, dispatch],
      )).id,
    );
    await asUser(db, dispatch, (s) => s.query(`update public.shipments set status = 'in_transit', last_status_note = 'Handed to courier' where id = $1`, [shipmentId]));
    await asUser(db, dispatch, (s) => s.query(`update public.shipments set notes = 'fragile' where id = $1`, [shipmentId])); // not a status change
    await asUser(db, dispatch, (s) => s.query(`update public.shipments set status = 'delivered', last_status_note = null where id = $1`, [shipmentId]));

    const events = await asUser(db, dispatch, (s) => s.query<any>(`select status, note, created_by from public.shipment_events where shipment_id = $1 order by created_at`, [shipmentId])); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(events.map((e) => e.status)).toEqual(["booked", "in_transit", "delivered"]);
    expect(events[1].note).toBe("Handed to courier");
    expect(events.every((e) => e.created_by === dispatch)).toBe(true);
  });

  it("a cashier can create but not update; bad courier templates are refused", async () => {
    const id = await asUser(db, cashier, async (s) =>
      (await s.one<{ id: string }>(`insert into public.shipments (business_id, outlet_id, recipient_name) values ($1, $2, 'Walk-in parcel') returning id`, [biz.id, biz.outletId])).id,
    );
    await asUser(db, cashier, async (s) => {
      expect(await s.query(`update public.shipments set status = 'delivered' where id = $1 returning id`, [id])).toHaveLength(0);
    });
    await expectError(
      asUser(db, owner, (s) => s.query(`insert into public.courier_partners (business_id, name, tracking_url_template) values ($1, 'Bad', 'javascript:alert(1)')`, [biz.id])),
      /check constraint/,
    );
    await expectError(
      asUser(db, dispatch, (s) => s.query(`insert into public.courier_partners (business_id, name) values ($1, 'Mine')`, [biz.id])),
      /row-level security/,
    );
  });
});

describe("dashboard and reports", () => {
  let invToday: string;

  beforeAll(async () => {
    // Two bills today (one cancelled), one bill dated yesterday via an offline device.
    const post = (actor: string, extra: Record<string, unknown>) =>
      asService(db, (s) =>
        s.rpc("post_sales_invoice", {
          p_actor: actor,
          p: JSON.stringify(buildInvoicePayload({ businessId: biz.id, outletId: biz.outletId, lines: [{ productId: book, unitPricePaise: 60_00, gstRate: 5, quantity: 2 }], ...extra })),
        }),
      );
    invToday = (await post(cashier, { payments: [{ mode: "cash", amount_paise: 100_00 }, { mode: "upi", amount_paise: 20_00 }] })).invoice_id;
    const cancelled = (await post(owner, {})).invoice_id;
    await asUser(db, owner, (s) => s.rpc("cancel_sales_invoice", { p_invoice_id: cancelled, p_reason: "Test cancel" }));

    const device = await asUser(db, owner, (s) => s.rpc("register_pos_device", { p_outlet_id: biz.outletId, p_name: "Tab", p_prefix: "T1", p_device_key_hash: "t".repeat(64) }));
    const yfy = (await db.query<{ fy: string }>(`select public.financial_year($1::date) as fy`, [yesterday])).rows[0].fy;
    await post(cashier, { deviceId: device, invoiceNumber: `T1/${yfy}/00001`, source: "pos_offline", invoiceDate: yesterday });
  });

  it("dashboard figures match the raw data, per IST day", async () => {
    const d = await asUser(db, owner, (s) => s.rpc("dashboard_summary", { p_business_id: biz.id, p_outlet_id: null, p_from: today, p_to: today }));
    expect(Number(d.sales.total_paise)).toBe(120_00);
    expect(Number(d.sales.invoice_count)).toBe(1);
    expect(Number(d.sales.average_paise)).toBe(120_00);
    expect(Number(d.cancelled_count)).toBe(1);
    const raw = (await db.query<any>(`select sum(cgst_paise + sgst_paise + igst_paise + cess_paise) as tax from public.sales_invoices where id = $1`, [invToday])).rows[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(Number(d.sales.tax_paise)).toBe(Number(raw.tax));
    expect(d.payment_modes.map((m: any) => [m.mode, Number(m.amount_paise)]).sort()).toEqual([["cash", 100_00], ["upi", 20_00]]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(d.trend).toHaveLength(1);
    expect(d.top_by_revenue[0]).toMatchObject({ name: "Item" });
    expect(d.sales_by_staff).toHaveLength(1);
    expect(d.sales_by_staff[0].name).toBe("Cashier");
    expect(d.recent_cancellations).toHaveLength(1);
    expect(Number(d.purchases.total_paise)).toBeGreaterThan(0);

    // Yesterday's offline bill is counted on yesterday, not today.
    const y = await asUser(db, owner, (s) => s.rpc("dashboard_summary", { p_business_id: biz.id, p_outlet_id: null, p_from: yesterday, p_to: yesterday }));
    expect(Number(y.sales.invoice_count)).toBe(1);
    expect(Number(y.sales.total_paise)).toBe(120_00);
    const both = await asUser(db, owner, (s) => s.rpc("dashboard_summary", { p_business_id: biz.id, p_outlet_id: biz.outletId, p_from: yesterday, p_to: today }));
    expect(Number(both.sales.invoice_count)).toBe(2);
    expect(both.trend.map((t: any) => Number(t.total_paise))).toEqual([120_00, 120_00]); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it("shows low stock, pending and stuck shipments", async () => {
    await db.query(`insert into public.shipments (business_id, outlet_id, recipient_name, shipped_on, status) values ($1, $2, 'Old parcel', public.ist_today() - 9, 'in_transit')`, [biz.id, biz.outletId]);
    const d = await asUser(db, owner, (s) => s.rpc("dashboard_summary", { p_business_id: biz.id, p_outlet_id: null, p_from: today, p_to: today }));
    const names = d.low_stock.items.map((i: any) => i.name); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(names).toContain("Notebook"); // opening 5, sold some, damaged 2 → below 10
    expect(names).not.toContain("Pen"); // well stocked after purchases
    expect(Number(d.shipments.pending_count)).toBeGreaterThanOrEqual(2);
    expect(Number(d.shipments.stuck_count)).toBe(1);
    expect(d.shipments.stuck[0]).toMatchObject({ recipient_name: "Old parcel", days_open: 9 });
  });

  it("groups by the IST calendar day across the midnight boundary", async () => {
    // 23:59:59 IST on 31 March and 00:00:00 IST on 1 April are 18:29:59Z and 18:30:00Z on 31 March.
    const p = await createProduct(db, biz, { name: "Boundary" });
    await db.query(
      `insert into public.stock_movements (business_id, outlet_id, product_id, quantity_delta, movement_type, created_at)
       values ($1, $2, $3, 1, 'adjustment', '2026-03-31T18:29:59Z'), ($1, $2, $3, 2, 'adjustment', '2026-03-31T18:30:00Z')`,
      [biz.id, biz.outletId, p],
    );
    const march = await asUser(db, owner, (s) => s.query<any>(`select * from public.report_stock_movements($1, null, '2026-03-31', '2026-03-31')`, [biz.id])); // eslint-disable-line @typescript-eslint/no-explicit-any
    const april = await asUser(db, owner, (s) => s.query<any>(`select * from public.report_stock_movements($1, null, '2026-04-01', '2026-04-01')`, [biz.id])); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(march.map((m) => Number(m.quantity_delta))).toEqual([1]);
    expect(april.map((m) => Number(m.quantity_delta))).toEqual([2]);
  });

  it("every report runs and agrees with the tables", async () => {
    const penStock = await stockOf(db, pen, biz.outletId);
    await asUser(db, owner, async (s) => {
      const range = [biz.id, yesterday, today];
      const register = await s.query<any>(`select * from public.report_sales_register($1, null, $2, $3)`, range); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(register).toHaveLength(3);
      expect(register.filter((r) => r.status === "posted")).toHaveLength(2);
      expect(register.find((r) => r.invoice_id === invToday).payment_modes).toBe("cash, upi");

      const items = await s.query<any>(`select * from public.report_item_sales($1, null, $2, $3)`, range); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(items).toHaveLength(1);
      expect(Number(items[0].quantity)).toBe(4);
      expect(Number(items[0].total_paise)).toBe(240_00);

      const hsn = await s.query<any>(`select * from public.report_hsn_summary($1, null, $2, $3)`, range); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(hsn).toHaveLength(1);
      expect(hsn[0]).toMatchObject({ hsn_code: "6109" });
      expect(Number(hsn[0].taxable_paise) + Number(hsn[0].cgst_paise) + Number(hsn[0].sgst_paise)).toBe(240_00);

      const purchases = await s.query<any>(`select * from public.report_purchase_register($1, null, $2, $3)`, range); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(purchases.length).toBeGreaterThanOrEqual(3);

      const stock = await s.query<any>(`select * from public.report_stock_summary($1, null)`, [biz.id]); // eslint-disable-line @typescript-eslint/no-explicit-any
      const penRow = stock.find((r) => r.name === "Pen");
      expect(Number(penRow.quantity)).toBe(penStock);
      expect(Number(penRow.stock_value_paise)).toBe(Number(penRow.quantity) * 5_00);

      const modes = await s.query<any>(`select * from public.report_payment_modes($1, null, $2, $3)`, range); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(modes.reduce((a, m) => a + Number(m.amount_paise), 0)).toBe(240_00);

      expect((await s.query(`select * from public.report_shipments($1, null, $2, $3)`, range)).length).toBeGreaterThanOrEqual(2);
      expect(await s.query(`select * from public.report_credit_notes($1, null, $2, $3)`, range)).toHaveLength(0);
      expect((await s.query(`select * from public.report_stock_movements($1, null, $2, $3)`, range)).length).toBeGreaterThan(3);
    });
  });

  it("hides cost and purchases from roles without those permissions", async () => {
    // A custom role with reports.view only.
    const analyst = await createUser(db, "analyst@p.in");
    const roleId = await asUser(db, owner, async (s) => {
      const r = await s.one<{ id: string }>(`insert into public.roles (business_id, name) values ($1, 'Analyst') returning id`, [biz.id]);
      await s.query(`insert into public.role_permissions (role_id, permission) values ($1, 'reports.view')`, [r.id]);
      return r.id;
    });
    await addMember(db, biz, analyst, roleId);
    await asUser(db, analyst, async (s) => {
      const stock = await s.query<any>(`select * from public.report_stock_summary($1, null)`, [biz.id]); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(stock.length).toBeGreaterThan(0);
      expect(stock.every((r) => r.purchase_price_paise === null && r.stock_value_paise === null)).toBe(true);
    });
    await expectError(asUser(db, analyst, (s) => s.query(`select * from public.report_purchase_register($1, null, $2, $3)`, [biz.id, yesterday, today])), /not allowed to view purchases/);
    await expectError(asUser(db, cashier, (s) => s.query(`select * from public.report_sales_register($1, null, $2, $3)`, [biz.id, yesterday, today])), /not allowed to view reports/);
  });
});
