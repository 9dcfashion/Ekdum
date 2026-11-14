import { beforeAll, describe, expect, it } from "vitest";
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
let owner: string, manager: string, cashier1: string, cashier2: string, outsider: string;
let biz: TestBusiness, other: TestBusiness;
let shirt: string;
let billByCashier1: string, billByCashier2: string, otherBill: string;

async function post(actor: string, business: TestBusiness, lines: Parameters<typeof buildInvoicePayload>[0]["lines"]) {
  const payload = buildInvoicePayload({ businessId: business.id, outletId: business.outletId, lines });
  return asService(db, (s) => s.rpc("post_sales_invoice", { p_actor: actor, p: JSON.stringify(payload) }));
}

const photoPath = (business: TestBusiness, invoiceId: string, n = 1) => `${business.id}/${invoiceId}/photo-${n}.jpg`;

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@photos.in");
  manager = await createUser(db, "manager@photos.in");
  cashier1 = await createUser(db, "c1@photos.in");
  cashier2 = await createUser(db, "c2@photos.in");
  outsider = await createUser(db, "outsider@photos.in");
  biz = await createBusiness(db, owner, { prefix: "P" });
  other = await createBusiness(db, outsider, { prefix: "Q" });
  await addMember(db, biz, manager, "manager");
  await addMember(db, biz, cashier1, "cashier");
  await addMember(db, biz, cashier2, "cashier");
  shirt = await createProduct(db, biz, { name: "Shirt", gst_rate: 5, sale_price_paise: 499_00, opening: 10 });

  billByCashier1 = (await post(cashier1, biz, [{ productId: null, description: "Silk saree (not in list)", unitPricePaise: 2500_00, gstRate: 5 }])).invoice_id;
  billByCashier2 = (await post(cashier2, biz, [{ productId: shirt, unitPricePaise: 499_00, gstRate: 5 }])).invoice_id;
  const otherProduct = await createProduct(db, other, { sale_price_paise: 100_00, opening: 5 });
  otherBill = (await post(outsider, other, [{ productId: otherProduct, unitPricePaise: 100_00 }])).invoice_id;
});

describe("manual items (not in the product list)", () => {
  it("post with no product, keep the typed name and price, and touch no stock", async () => {
    const before = await stockOf(db, shirt, biz.outletId);
    const r = await post(cashier1, biz, [
      { productId: null, description: "Handmade basket", unitPricePaise: 350_00, gstRate: 18, quantity: 2, hsnCode: "4602" },
      { productId: shirt, unitPricePaise: 499_00, gstRate: 5 },
    ]);
    const items = (await db.query<any>(`select product_id, description, hsn_code, quantity, unit_price_paise from public.sales_invoice_items where invoice_id = $1 order by line_no`, [r.invoice_id])).rows; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(items[0]).toMatchObject({ product_id: null, description: "Handmade basket", hsn_code: "4602", unit_price_paise: 350_00 });
    expect(Number(items[0].quantity)).toBe(2);
    expect(items[1].product_id).toBe(shirt);
    // Only the catalog product moved stock.
    expect(await stockOf(db, shirt, biz.outletId)).toBe(before - 1);
    const moves = await db.query(`select 1 from public.stock_movements where source_id = $1`, [r.invoice_id]);
    expect(moves.rows).toHaveLength(1);
  });

  it("a cashier without price-override permission can still bill a manual item at any price", async () => {
    const r = await post(cashier2, biz, [{ productId: null, description: "Alteration charge", unitPricePaise: 75_00, gstRate: 18 }]);
    expect(r.invoice_number).toMatch(/^P\//);
    const audit = await db.query(`select 1 from public.audit_log where action = 'sale.price_override' and entity_id = $1`, [r.invoice_id]);
    expect(audit.rows).toHaveLength(0);
  });

  it("reports and the dashboard include manual items by their name", async () => {
    await asUser(db, owner, async (s) => {
      const items = await s.query<{ description: string }>(`select description from public.report_item_sales($1, null, public.ist_today(), public.ist_today())`, [biz.id]);
      expect(items.map((i) => i.description)).toContain("Silk saree (not in list)");
    });
  });
});

describe("photos of goods handed over", () => {
  it("the cashier who made the bill can attach photos to it", async () => {
    await asUser(db, cashier1, async (s) => {
      await s.query(`insert into storage.objects (bucket_id, name, owner) values ('sale-photos', $1, $2)`, [photoPath(biz, billByCashier1), cashier1]);
      await s.query(`insert into public.sales_invoice_photos (business_id, invoice_id, storage_path, created_by) values ($1, $2, $3, $4)`, [
        biz.id, billByCashier1, photoPath(biz, billByCashier1), cashier1,
      ]);
      expect(await s.query(`select 1 from public.sales_invoice_photos where invoice_id = $1`, [billByCashier1])).toHaveLength(1);
      expect(await s.query(`select 1 from storage.objects where bucket_id = 'sale-photos' and name = $1`, [photoPath(biz, billByCashier1)])).toHaveLength(1);
    });
  });

  it("a cashier cannot see or attach photos on another cashier's bill", async () => {
    await expectError(
      asUser(db, cashier1, (s) =>
        s.query(`insert into storage.objects (bucket_id, name, owner) values ('sale-photos', $1, $2)`, [photoPath(biz, billByCashier2), cashier1]),
      ),
      /row-level security/,
    );
    await expectError(
      asUser(db, cashier1, (s) =>
        s.query(`insert into public.sales_invoice_photos (business_id, invoice_id, storage_path, created_by) values ($1, $2, $3, $4)`, [
          biz.id, billByCashier2, photoPath(biz, billByCashier2), cashier1,
        ]),
      ),
      /row-level security/,
    );
    await asUser(db, cashier2, async (s) => {
      expect(await s.query(`select 1 from public.sales_invoice_photos where invoice_id = $1`, [billByCashier1])).toHaveLength(0);
      expect(await s.query(`select 1 from storage.objects where name = $1`, [photoPath(biz, billByCashier1)])).toHaveLength(0);
    });
  });

  it("another business sees nothing and cannot attach", async () => {
    await asUser(db, outsider, async (s) => {
      expect(await s.query(`select 1 from public.sales_invoice_photos`)).toHaveLength(0);
      expect(await s.query(`select 1 from storage.objects where bucket_id = 'sale-photos' and name like $1`, [`${biz.id}/%`])).toHaveLength(0);
    });
    await expectError(
      asUser(db, outsider, (s) =>
        s.query(`insert into storage.objects (bucket_id, name, owner) values ('sale-photos', $1, $2)`, [photoPath(biz, billByCashier1, 9), outsider]),
      ),
      /row-level security/,
    );
    // A path that names one business but points at another business's bill is refused too.
    await expectError(
      asUser(db, outsider, (s) =>
        s.query(`insert into public.sales_invoice_photos (business_id, invoice_id, storage_path, created_by) values ($1, $2, $3, $4)`, [
          other.id, billByCashier1, `${other.id}/${billByCashier1}/x.jpg`, outsider,
        ]),
      ),
      /row-level security|Bill not found/,
    );
  });

  it("the stored path must sit under the bill's own folder", async () => {
    await expectError(
      asUser(db, cashier1, (s) =>
        s.query(`insert into public.sales_invoice_photos (business_id, invoice_id, storage_path, created_by) values ($1, $2, $3, $4)`, [
          biz.id, billByCashier1, `${biz.id}/somewhere-else/x.jpg`, cashier1,
        ]),
      ),
      /sales_invoice_photos_path_scoped/,
    );
  });

  it("the manager sees every bill's photos; the owner of the shop too", async () => {
    for (const user of [manager, owner]) {
      await asUser(db, user, async (s) => {
        expect(await s.query(`select 1 from public.sales_invoice_photos where invoice_id = $1`, [billByCashier1])).toHaveLength(1);
        expect(await s.query(`select 1 from storage.objects where name = $1`, [photoPath(biz, billByCashier1)])).toHaveLength(1);
      });
    }
  });

  it("photos are append-only for cashiers; a manager's removal is audited", async () => {
    await asUser(db, cashier1, async (s) => {
      expect(await s.query(`delete from public.sales_invoice_photos where invoice_id = $1 returning id`, [billByCashier1])).toHaveLength(0);
      expect(await s.query(`delete from storage.objects where name = $1 returning id`, [photoPath(biz, billByCashier1)])).toHaveLength(0);
    });
    await expectError(asUser(db, manager, (s) => s.query(`update public.sales_invoice_photos set storage_path = storage_path`)), /permission denied|cannot be changed/);

    await asUser(db, manager, async (s) => {
      expect(await s.query(`delete from public.sales_invoice_photos where invoice_id = $1 returning id`, [billByCashier1])).toHaveLength(1);
      expect(await s.query(`delete from storage.objects where name = $1 returning id`, [photoPath(biz, billByCashier1)])).toHaveLength(1);
    });
    const audit = (await db.query<any>(`select actor_id, before from public.audit_log where action = 'sale.photo_removed' and entity_id = $1`, [billByCashier1])).rows; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_id).toBe(manager);
    expect(audit[0].before.storage_path).toBe(photoPath(biz, billByCashier1));
  });

  it("a bill holds at most 10 photos, and a cancelled bill takes no new ones", async () => {
    await asUser(db, cashier2, async (s) => {
      for (let n = 1; n <= 10; n++) {
        await s.query(`insert into public.sales_invoice_photos (business_id, invoice_id, storage_path, created_by) values ($1, $2, $3, $4)`, [
          biz.id, billByCashier2, photoPath(biz, billByCashier2, n), cashier2,
        ]);
      }
    });
    await expectError(
      asUser(db, cashier2, (s) =>
        s.query(`insert into public.sales_invoice_photos (business_id, invoice_id, storage_path, created_by) values ($1, $2, $3, $4)`, [
          biz.id, billByCashier2, photoPath(biz, billByCashier2, 11), cashier2,
        ]),
      ),
      /at most 10 photos/,
    );

    const r = await post(cashier2, biz, [{ productId: null, description: "Gift wrap", unitPricePaise: 20_00, gstRate: 18 }]);
    await asUser(db, owner, (s) => s.rpc("cancel_sales_invoice", { p_invoice_id: r.invoice_id, p_reason: "Wrong bill" }));
    await expectError(
      asUser(db, cashier2, (s) =>
        s.query(`insert into public.sales_invoice_photos (business_id, invoice_id, storage_path, created_by) values ($1, $2, $3, $4)`, [
          biz.id, r.invoice_id, photoPath(biz, r.invoice_id), cashier2,
        ]),
      ),
      /row-level security/,
    );
  });

  it("a user cannot add a photo in someone else's name", async () => {
    const fresh = (await post(cashier2, biz, [{ productId: null, description: "Bag", unitPricePaise: 10_00, gstRate: 18 }])).invoice_id;
    await expectError(
      asUser(db, cashier2, (s) =>
        s.query(`insert into public.sales_invoice_photos (business_id, invoice_id, storage_path, created_by) values ($1, $2, $3, $4)`, [
          biz.id, fresh, `${biz.id}/${fresh}/spoof.jpg`, owner,
        ]),
      ),
      /row-level security/,
    );
  });

  it("deleting the business's bills is still impossible, photos or not", async () => {
    await expectError(db.query(`delete from public.sales_invoices where id = $1`, [otherBill]), /cannot be deleted/);
  });
});
