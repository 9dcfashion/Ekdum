import { beforeAll, describe, expect, it } from "vitest";
import { addMember, asUser, createBusiness, createDb, createUser, expectError, type Db, type TestBusiness } from "./harness";

let db: Db;
let owner: string, manager: string, cashier: string, outsider: string;
let biz: TestBusiness;

const insert = (business: string, name: string, extra: Record<string, unknown> = {}) => ({
  sql: `insert into public.quick_items (business_id, name, gst_rate, hsn_code, unit_code, price_includes_tax, sort_order)
        values ($1, $2, $3, $4, $5, $6, $7) returning id`,
  params: [business, name, extra.gst_rate ?? 3, extra.hsn_code ?? "7117", extra.unit_code ?? "PCS", extra.price_includes_tax ?? false, extra.sort_order ?? 0],
});

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@quick.in");
  manager = await createUser(db, "manager@quick.in");
  cashier = await createUser(db, "cashier@quick.in");
  outsider = await createUser(db, "outsider@quick.in");
  biz = await createBusiness(db, owner, { prefix: "J" });
  await createBusiness(db, outsider, { prefix: "X" });
  await addMember(db, biz, manager, "manager");
  await addMember(db, biz, cashier, "cashier");
});

describe("quick billing items", () => {
  it("owners and managers can set them up", async () => {
    for (const [user, name] of [[owner, "Necklace"], [manager, "Finger Ring"]] as const) {
      const q = insert(biz.id, name);
      await asUser(db, user, (s) => s.query(q.sql, q.params));
    }
    const rows = await db.query<{ name: string; gst_rate: string; hsn_code: string }>(`select name, gst_rate, hsn_code from public.quick_items order by name`);
    expect(rows.rows.map((r) => [r.name, Number(r.gst_rate), r.hsn_code])).toEqual([
      ["Finger Ring", 3, "7117"],
      ["Necklace", 3, "7117"],
    ]);
  });

  it("every member, including cashiers, can read them to bill", async () => {
    await asUser(db, cashier, async (s) => {
      expect(await s.query(`select name from public.quick_items`)).toHaveLength(2);
    });
  });

  it("cashiers cannot change them; other businesses cannot see them", async () => {
    const q = insert(biz.id, "Bracelet");
    await expectError(asUser(db, cashier, (s) => s.query(q.sql, q.params)), /row-level security/);
    await asUser(db, cashier, async (s) => {
      expect(await s.query(`update public.quick_items set gst_rate = 0 returning id`)).toHaveLength(0);
      expect(await s.query(`delete from public.quick_items returning id`)).toHaveLength(0);
    });
    await asUser(db, outsider, async (s) => {
      expect(await s.query(`select 1 from public.quick_items`)).toHaveLength(0);
    });
    await expectError(asUser(db, outsider, (s) => s.query(q.sql, q.params)), /row-level security/);
    await expectError(asUser(db, cashier, (s) => s.query(`truncate public.quick_items`)), /permission denied/);
  });

  it("validates names, HSN, units and duplicates", async () => {
    const dup = insert(biz.id, "  necklace ");
    await expectError(asUser(db, owner, (s) => s.query(dup.sql, dup.params)), /quick_items_name_uniq/);
    const badHsn = insert(biz.id, "Pendant", { hsn_code: "71" });
    await expectError(asUser(db, owner, (s) => s.query(badHsn.sql, badHsn.params)), /check constraint/);
    const badUnit = insert(biz.id, "Pendant", { unit_code: "XYZ" });
    await expectError(asUser(db, owner, (s) => s.query(badUnit.sql, badUnit.params)), /foreign key/);
  });

  it("caps the list at 60 items", async () => {
    await asUser(db, owner, async (s) => {
      for (let i = 0; i < 58; i++) {
        const q = insert(biz.id, `Item ${i}`);
        await s.query(q.sql, q.params);
      }
    });
    const q = insert(biz.id, "One too many");
    await expectError(asUser(db, owner, (s) => s.query(q.sql, q.params)), /at most 60 quick items/);
  });
});
