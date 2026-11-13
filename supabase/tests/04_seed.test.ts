import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { amountInWords, computeInvoice } from "@/lib/gst";
import { asUser, createDb, createUser, type Db } from "./harness";

let db: Db;
let owner: string;
let businessId: string;

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, "seed-owner@test.in", "Seed Owner");
  const sql = readFileSync(path.resolve(__dirname, "../seed.sql"), "utf8").replace("owner@example.com", "seed-owner@test.in");
  await db.exec(sql);
  businessId = (await db.query<{ id: string }>(`select id from public.businesses limit 1`)).rows[0].id;
});

describe("demo seed", () => {
  it("fails with a clear message when the email is unknown", async () => {
    const sql = readFileSync(path.resolve(__dirname, "../seed.sql"), "utf8").replace("owner@example.com", "nobody@test.in");
    await expect(db.exec(sql)).rejects.toThrow(/Sign up in the app first/);
  });

  it("creates the business, 50 products, customers, vendors and a few days of sales", async () => {
    const count = async (table: string) =>
      (await db.query<{ n: number }>(`select count(*)::int as n from public.${table} where business_id = $1`, [businessId])).rows[0].n;
    expect(await count("products")).toBe(50);
    expect(await count("product_costs")).toBe(50);
    expect(await count("customers")).toBe(8);
    expect(await count("vendors")).toBe(4);
    expect(await count("purchase_bills")).toBe(3);
    expect(await count("sales_invoices")).toBeGreaterThanOrEqual(35);
    expect(await count("shipments")).toBe(3);
    const days = await db.query<{ n: number }>(`select count(distinct invoice_date)::int as n from public.sales_invoices`);
    expect(days.rows[0].n).toBe(5);
  });

  it("the owner can use it through RLS, and the dashboard runs", async () => {
    await asUser(db, owner, async (s) => {
      expect(await s.query(`select 1 from public.products`)).toHaveLength(50);
      const d = await s.rpc("dashboard_summary", {
        p_business_id: businessId,
        p_outlet_id: null,
        p_from: (await s.one<{ d: string }>(`select (public.ist_today() - 6)::text as d`)).d,
        p_to: (await s.one<{ d: string }>(`select public.ist_today()::text as d`)).d,
      });
      expect(Number(d.sales.invoice_count)).toBeGreaterThanOrEqual(35);
      expect(d.trend).toHaveLength(7);
      expect(Number(d.low_stock.count)).toBeGreaterThanOrEqual(1); // LED Bulb is seeded below its threshold
      expect(Number(d.shipments.stuck_count)).toBe(1);
    });
  });

  it("seeded bills match the app's GST engine to the paisa, including amount in words", async () => {
    const invoices = (await db.query<any>(`select * from public.sales_invoices order by invoice_number`)).rows; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const inv of invoices) {
      const items = (await db.query<any>(`select * from public.sales_invoice_items where invoice_id = $1 order by line_no`, [inv.id])).rows; // eslint-disable-line @typescript-eslint/no-explicit-any
      const totals = computeInvoice({
        lines: items.map((i) => ({
          quantity: String(i.quantity),
          unitPricePaise: Number(i.unit_price_paise),
          priceIncludesTax: i.price_includes_tax,
          gstRate: String(i.gst_rate),
        })),
        chargeTax: true,
        isInterState: false,
        roundOff: true,
      });
      expect(Number(inv.taxable_paise), inv.invoice_number).toBe(totals.taxablePaise);
      expect(Number(inv.cgst_paise), inv.invoice_number).toBe(totals.cgstPaise);
      expect(Number(inv.sgst_paise), inv.invoice_number).toBe(totals.sgstPaise);
      expect(Number(inv.round_off_paise), inv.invoice_number).toBe(totals.roundOffPaise);
      expect(Number(inv.total_paise), inv.invoice_number).toBe(totals.totalPaise);
      expect(inv.amount_in_words, inv.invoice_number).toBe(amountInWords(totals.totalPaise));
      const paid = (await db.query<{ s: string }>(`select coalesce(sum(amount_paise), 0) as s from public.sales_payments where invoice_id = $1`, [inv.id])).rows[0].s;
      expect(Number(paid), inv.invoice_number).toBe(totals.totalPaise);
    }
  });

  it("numbers are consecutive and the series continues after them", async () => {
    const rows = (await db.query<{ invoice_number: string }>(`select invoice_number from public.sales_invoices order by invoice_number`)).rows;
    rows.forEach((r, i) => expect(r.invoice_number.endsWith(String(i + 1).padStart(5, "0"))).toBe(true));
    const next = (await db.query<{ next_number: string }>(`select next_number from public.invoice_series where document_type = 'invoice'`)).rows[0];
    expect(Number(next.next_number)).toBe(rows.length + 1);
  });

  it("stock levels reconcile with the ledger and purchases roll up", async () => {
    const bad = await db.query(`
      select 1 from public.stock_levels sl
      join (select product_id, outlet_id, sum(quantity_delta) q from public.stock_movements group by 1, 2) m
        on m.product_id = sl.product_id and m.outlet_id = sl.outlet_id
      where m.q <> sl.quantity`);
    expect(bad.rows).toHaveLength(0);
    const bills = (await db.query<{ payment_status: string }>(`select payment_status from public.purchase_bills order by vendor_invoice_number`)).rows;
    expect(bills.map((b) => b.payment_status)).toEqual(["paid", "partial", "unpaid"]);
    const events = await db.query<{ n: number }>(`select count(*)::int as n from public.shipment_events`);
    expect(events.rows[0].n).toBe(5);
  });
});
