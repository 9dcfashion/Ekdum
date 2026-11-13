import { beforeAll, describe, expect, it } from "vitest";
import {
  addMember,
  asAnon,
  asService,
  asUser,
  createBusiness,
  createDb,
  createProduct,
  createUser,
  expectError,
  type Db,
  type TestBusiness,
} from "./harness";
import { buildInvoicePayload } from "./payload";

let db: Db;
let ownerA: string, ownerB: string, managerA: string, cashier1: string, cashier2: string, dispatchA: string;
let A: TestBusiness, B: TestBusiness;
let outletA2: string;
let productA: string, productB: string;
let invoiceByCashier1: string, invoiceByCashier2: string, invoiceOutlet2: string, invoiceB: string;

beforeAll(async () => {
  db = await createDb();
  ownerA = await createUser(db, "owner-a@test.in", "Asha Owner");
  ownerB = await createUser(db, "owner-b@test.in", "Bala Owner");
  managerA = await createUser(db, "manager-a@test.in");
  cashier1 = await createUser(db, "cashier1@test.in");
  cashier2 = await createUser(db, "cashier2@test.in");
  dispatchA = await createUser(db, "dispatch@test.in");

  A = await createBusiness(db, ownerA, { name: "A Traders", prefix: "A" });
  B = await createBusiness(db, ownerB, { name: "B Stores", prefix: "B" });

  outletA2 = await asUser(db, ownerA, async (s) => {
    const o = await s.one<{ id: string }>(
      `insert into public.outlets (business_id, name, state_code) values ($1, 'Second Shop', '27') returning id`,
      [A.id],
    );
    await s.query(
      `insert into public.invoice_series (business_id, outlet_id, document_type, prefix, financial_year)
       values ($1, $2, 'invoice', 'A2', public.financial_year(public.ist_today()))`,
      [A.id, o.id],
    );
    return o.id;
  });

  await addMember(db, A, managerA, "manager");
  await addMember(db, A, cashier1, "cashier", { outletIds: [A.outletId] });
  await addMember(db, A, cashier2, "cashier"); // all outlets
  await addMember(db, A, dispatchA, "dispatch");

  productA = await createProduct(db, A, { name: "A Shirt", opening: 100, cost_paise: 60_00 });
  productB = await createProduct(db, B, { name: "B Shirt", opening: 100, cost_paise: 70_00 });

  const post = async (business: TestBusiness, actor: string, outletId: string, productId: string) =>
    asService(db, async (s) => {
      const r = await s.rpc("post_sales_invoice", {
        p_actor: actor,
        p: JSON.stringify(
          buildInvoicePayload({ businessId: business.id, outletId, lines: [{ productId, unitPricePaise: 118_00 }] }),
        ),
      });
      return r.invoice_id as string;
    });

  invoiceByCashier1 = await post(A, cashier1, A.outletId, productA);
  invoiceByCashier2 = await post(A, cashier2, A.outletId, productA);
  invoiceOutlet2 = await post(A, cashier2, outletA2, productA);
  invoiceB = await post(B, ownerB, B.outletId, productB);
});

describe("tenant isolation: business A cannot read or write business B", () => {
  const tables = [
    "businesses", "outlets", "roles", "business_members", "products", "product_costs", "customers", "vendors",
    "stock_levels", "stock_movements", "sales_invoices", "sales_invoice_items", "sales_payments",
    "invoice_series", "audit_log", "purchase_bills", "shipments", "notification_jobs", "courier_partners",
    "credit_notes", "invitations", "pos_devices", "product_categories",
  ];

  it("owner A sees no rows of business B in any table", async () => {
    await asUser(db, ownerA, async (s) => {
      for (const table of tables) {
        const col = table === "businesses" ? "id" : "business_id";
        const rows = await s.query(`select 1 from public.${table} where ${col} = $1`, [B.id]);
        expect(rows, table).toHaveLength(0);
      }
      // …and child tables without a business_id of their own.
      expect(await s.query(`select 1 from public.role_permissions where role_id = $1`, [B.roles.owner])).toHaveLength(0);
    });
  });

  it("owner A does see their own data (the test is not vacuous)", async () => {
    await asUser(db, ownerA, async (s) => {
      expect(await s.query(`select 1 from public.businesses`)).toHaveLength(1);
      expect(await s.query(`select 1 from public.products`)).toHaveLength(1);
      expect(await s.query(`select 1 from public.sales_invoices`)).toHaveLength(3);
      expect(await s.query(`select 1 from public.product_costs`)).toHaveLength(1);
    });
  });

  it("owner A cannot write into business B", async () => {
    await expectError(
      asUser(db, ownerA, (s) =>
        s.query(`insert into public.products (business_id, name) values ($1, 'Injected')`, [B.id]),
      ),
      /row-level security/,
    );
    await expectError(
      asUser(db, ownerA, (s) =>
        s.query(`insert into public.customers (business_id, name) values ($1, 'Injected')`, [B.id]),
      ),
      /row-level security/,
    );
    await expectError(
      asUser(db, ownerA, (s) =>
        s.query(`insert into public.outlets (business_id, name, state_code) values ($1, 'X', '27')`, [B.id]),
      ),
      /row-level security/,
    );
    await asUser(db, ownerA, async (s) => {
      // Updates and deletes silently match zero rows.
      expect(await s.query(`update public.products set name = 'Hacked' where id = $1 returning id`, [productB])).toHaveLength(0);
      expect(await s.query(`update public.businesses set legal_name = 'Hacked' where id = $1 returning id`, [B.id])).toHaveLength(0);
      expect(await s.query(`delete from public.products where id = $1 returning id`, [productB])).toHaveLength(0);
    });
    const check = await db.query<{ name: string }>(`select name from public.products where id = $1`, [productB]);
    expect(check.rows[0].name).toBe("B Shirt");
  });

  it("owner A cannot run RPCs against business B", async () => {
    await expectError(
      asUser(db, ownerA, (s) =>
        s.rpc("adjust_stock", { p_outlet_id: B.outletId, p_product_id: productB, p_quantity_delta: -5, p_reason: "theft" }),
      ),
      /Not allowed/,
    );
    await expectError(
      asUser(db, ownerA, (s) => s.rpc("cancel_sales_invoice", { p_invoice_id: invoiceB, p_reason: "malicious" })),
      /not allowed/i,
    );
    await expectError(
      asUser(db, ownerA, (s) =>
        s.rpc("dashboard_summary", { p_business_id: B.id, p_outlet_id: null, p_from: "2026-01-01", p_to: "2026-01-02" }),
      ),
      /not allowed/i,
    );
    await expectError(
      asUser(db, ownerA, (s) =>
        s.rpc("report_sales_register", { p_business_id: B.id, p_outlet_id: null, p_from: "2026-01-01", p_to: "2026-12-31" }),
      ),
      /not allowed/i,
    );
    await expectError(
      asUser(db, ownerA, (s) => s.rpc("set_invoice_public_link", { p_invoice_id: invoiceB, p_enabled: false })),
      /owner/i,
    );
  });

  it("the server refuses to post a bill for an actor from another business", async () => {
    await expectError(
      asService(db, (s) =>
        s.rpc("post_sales_invoice", {
          p_actor: ownerA,
          p: JSON.stringify(
            buildInvoicePayload({ businessId: B.id, outletId: B.outletId, lines: [{ productId: productB, unitPricePaise: 118_00 }] }),
          ),
        }),
      ),
      /not allowed/i,
    );
  });

  it("a signed-in user cannot call server-only functions", async () => {
    await expectError(
      asUser(db, ownerA, (s) =>
        s.rpc("post_sales_invoice", {
          p_actor: ownerA,
          p: JSON.stringify(
            buildInvoicePayload({ businessId: A.id, outletId: A.outletId, lines: [{ productId: productA, unitPricePaise: 1 }] }),
          ),
        }),
      ),
      /permission denied/,
    );
    await expectError(asUser(db, ownerA, (s) => s.rpc("check_rate_limit", { p_key: "x", p_limit: 1, p_window_seconds: 60 })), /permission denied/);
  });

  it("anonymous visitors can read nothing", async () => {
    for (const table of ["businesses", "sales_invoices", "products", "customers", "profiles", "gst_rates"]) {
      await expectError(asAnon(db, (s) => s.query(`select 1 from public.${table}`)), /permission denied/);
    }
  });
});

describe("cashier restrictions", () => {
  it("cannot see purchase cost prices", async () => {
    await asUser(db, cashier1, async (s) => {
      expect(await s.query(`select 1 from public.products`)).toHaveLength(1); // can see the product…
      expect(await s.query(`select 1 from public.product_costs`)).toHaveLength(0); // …but not what it cost
      expect(await s.query(`select 1 from public.purchase_bills`)).toHaveLength(0);
      expect(await s.query(`select 1 from public.vendors`)).toHaveLength(0);
    });
    await asUser(db, managerA, async (s) => {
      const costs = await s.query<{ purchase_price_paise: string }>(`select purchase_price_paise from public.product_costs`);
      expect(costs).toHaveLength(1);
      expect(Number(costs[0].purchase_price_paise)).toBe(60_00);
    });
  });

  it("sees only their own bills when sales.view_own is their only sales permission", async () => {
    await asUser(db, cashier1, async (s) => {
      const rows = await s.query<{ id: string }>(`select id from public.sales_invoices`);
      expect(rows.map((r) => r.id)).toEqual([invoiceByCashier1]);
      const items = await s.query<{ invoice_id: string }>(`select invoice_id from public.sales_invoice_items`);
      expect(items.map((r) => r.invoice_id)).toEqual([invoiceByCashier1]);
      const pays = await s.query<{ invoice_id: string }>(`select invoice_id from public.sales_payments`);
      expect(pays.map((r) => r.invoice_id)).toEqual([invoiceByCashier1]);
    });
    await asUser(db, cashier2, async (s) => {
      const rows = await s.query<{ id: string }>(`select id from public.sales_invoices order by created_at`);
      expect(rows.map((r) => r.id).sort()).toEqual([invoiceByCashier2, invoiceOutlet2].sort());
    });
    await asUser(db, managerA, async (s) => {
      expect(await s.query(`select 1 from public.sales_invoices`)).toHaveLength(3);
    });
  });

  it("cannot cancel bills, issue credit notes, adjust stock or see the dashboard", async () => {
    await expectError(
      asUser(db, cashier1, (s) => s.rpc("cancel_sales_invoice", { p_invoice_id: invoiceByCashier1, p_reason: "oops wrong" })),
      /not allowed/i,
    );
    await expectError(
      asUser(db, cashier1, (s) =>
        s.rpc("create_credit_note", { p_invoice_id: invoiceByCashier1, p_items: "[]", p_reason: "return" }),
      ),
      /not allowed/i,
    );
    await expectError(
      asUser(db, cashier1, (s) =>
        s.rpc("adjust_stock", { p_outlet_id: A.outletId, p_product_id: productA, p_quantity_delta: 5, p_reason: "recount" }),
      ),
      /Not allowed/,
    );
    await expectError(
      asUser(db, cashier1, (s) =>
        s.rpc("dashboard_summary", { p_business_id: A.id, p_outlet_id: null, p_from: "2026-01-01", p_to: "2026-01-02" }),
      ),
      /not allowed/i,
    );
  });

  it("cannot edit products, roles, settings or their own membership", async () => {
    await asUser(db, cashier1, async (s) => {
      expect(await s.query(`update public.products set sale_price_paise = 1 where id = $1 returning id`, [productA])).toHaveLength(0);
      expect(await s.query(`update public.businesses set legal_name = 'x' where id = $1 returning id`, [A.id])).toHaveLength(0);
      expect(
        await s.query(`update public.business_members set role_id = $1 where user_id = $2 returning id`, [A.roles.owner, cashier1]),
      ).toHaveLength(0);
      expect(await s.query(`select 1 from public.audit_log`)).toHaveLength(0);
      expect(await s.query(`select 1 from public.invitations`)).toHaveLength(0);
    });
    await expectError(
      asUser(db, cashier1, (s) =>
        s.query(`insert into public.role_permissions (role_id, permission) values ($1, 'staff.manage')`, [A.roles.cashier]),
      ),
      /row-level security|system roles cannot be changed/i,
    );
    await expectError(
      asUser(db, cashier1, (s) =>
        s.query(`insert into public.business_members (business_id, user_id, role_id) values ($1, $2, $3)`, [B.id, cashier1, B.roles.owner]),
      ),
      /permission denied/,
    );
  });

  it("can add customers but cannot touch financial tables directly", async () => {
    await asUser(db, cashier1, async (s) => {
      const c = await s.query(`insert into public.customers (business_id, name, phone) values ($1, 'Walk In', '+919876543210') returning id`, [A.id]);
      expect(c).toHaveLength(1);
    });
    for (const sql of [
      `update public.sales_invoices set total_paise = 1`,
      `delete from public.sales_invoices`,
      `insert into public.stock_movements (business_id, outlet_id, product_id, quantity_delta, movement_type) values ('${A.id}', '${A.outletId}', '${productA}', 999, 'adjustment')`,
      `update public.stock_levels set quantity = 999`,
      `insert into public.audit_log (business_id, action, entity) values ('${A.id}', 'x', 'y')`,
      `delete from public.audit_log`,
    ]) {
      await expectError(asUser(db, ownerA, (s) => s.query(sql)), /permission denied/);
    }
  });
});

describe("outlet restrictions", () => {
  it("a user limited to outlet X cannot see outlet Y's data", async () => {
    await asUser(db, cashier1, async (s) => {
      const outlets = await s.query<{ id: string }>(`select id from public.outlets`);
      expect(outlets.map((o) => o.id)).toEqual([A.outletId]);
      expect(await s.query(`select 1 from public.stock_levels where outlet_id = $1`, [outletA2])).toHaveLength(0);
      expect(await s.query(`select 1 from public.invoice_series where outlet_id = $1`, [outletA2])).toHaveLength(0);
      expect(await s.query(`select 1 from public.sales_invoices where outlet_id = $1`, [outletA2])).toHaveLength(0);
    });
  });

  it("the server refuses to bill at an outlet the cashier has no access to", async () => {
    await expectError(
      asService(db, (s) =>
        s.rpc("post_sales_invoice", {
          p_actor: cashier1,
          p: JSON.stringify(
            buildInvoicePayload({ businessId: A.id, outletId: outletA2, lines: [{ productId: productA, unitPricePaise: 118_00 }] }),
          ),
        }),
      ),
      /not allowed/i,
    );
  });

  it("dispatch (sales.view_all) restricted to one outlet sees only that outlet's bills", async () => {
    const limited = await createUser(db, "dispatch2@test.in");
    await addMember(db, A, limited, "dispatch", { outletIds: [outletA2] });
    await asUser(db, limited, async (s) => {
      const rows = await s.query<{ id: string }>(`select id from public.sales_invoices`);
      expect(rows.map((r) => r.id)).toEqual([invoiceOutlet2]);
    });
  });
});

describe("membership and role guards", () => {
  it("deactivation takes effect immediately", async () => {
    const temp = await createUser(db, "temp@test.in");
    const memberId = await addMember(db, A, temp, "manager");
    await asUser(db, temp, async (s) => expect(await s.query(`select 1 from public.products`)).toHaveLength(1));
    await asUser(db, ownerA, (s) => s.query(`update public.business_members set is_active = false where id = $1`, [memberId]));
    await asUser(db, temp, async (s) => {
      expect(await s.query(`select 1 from public.products`)).toHaveLength(0);
      expect(await s.query(`select 1 from public.businesses`)).toHaveLength(0);
      expect(await s.query(`select 1 from public.sales_invoices`)).toHaveLength(0);
    });
    const audit = await db.query(`select 1 from public.audit_log where action = 'member.deactivated' and entity_id = $1`, [memberId]);
    expect(audit.rows).toHaveLength(1);
  });

  it("the last active owner cannot be deactivated or demoted", async () => {
    await expectError(
      asUser(db, ownerA, (s) =>
        s.query(`update public.business_members set is_active = false where business_id = $1 and user_id = $2`, [A.id, ownerA]),
      ),
      /at least one active owner/,
    );
    await expectError(
      asUser(db, ownerA, (s) =>
        s.query(`update public.business_members set role_id = $1 where business_id = $2 and user_id = $3`, [A.roles.manager, A.id, ownerA]),
      ),
      /at least one active owner/,
    );
  });

  it("an owner can hand over once a second owner exists", async () => {
    const second = await createUser(db, "second-owner@test.in");
    const memberId = await addMember(db, A, second, "manager");
    await asUser(db, ownerA, (s) => s.query(`update public.business_members set role_id = $1 where id = $2`, [A.roles.owner, memberId]));
    await asUser(db, ownerA, (s) =>
      s.query(`update public.business_members set role_id = $1 where business_id = $2 and user_id = $3`, [A.roles.manager, A.id, ownerA]),
    );
    // Restore for the remaining tests.
    await asUser(db, second, (s) =>
      s.query(`update public.business_members set role_id = $1 where business_id = $2 and user_id = $3`, [A.roles.owner, A.id, ownerA]),
    );
  });

  it("only an owner can grant the Owner role", async () => {
    // A custom role with staff.manage but not owner.
    const hr = await createUser(db, "hr@test.in");
    const roleId = await asUser(db, ownerA, async (s) => {
      const r = await s.one<{ id: string }>(`insert into public.roles (business_id, name) values ($1, 'HR') returning id`, [A.id]);
      await s.query(`insert into public.role_permissions (role_id, permission) values ($1, 'staff.manage')`, [r.id]);
      return r.id;
    });
    const hrMember = await addMember(db, A, hr, roleId);
    await expectError(
      asUser(db, hr, (s) => s.query(`update public.business_members set role_id = $1 where id = $2`, [A.roles.owner, hrMember])),
      /Only an owner can assign/,
    );
    await expectError(
      asUser(db, hr, (s) =>
        s.query(
          `insert into public.invitations (business_id, email, role_id, token_hash, expires_at)
           values ($1, 'evil@test.in', $2, 'hash-evil', now() + interval '1 day')`,
          [A.id, A.roles.owner],
        ),
      ),
      /Only an owner can invite/,
    );
  });

  it("system roles cannot be edited or deleted; custom role changes are audited", async () => {
    await expectError(
      asUser(db, ownerA, (s) => s.query(`insert into public.role_permissions (role_id, permission) values ($1, 'staff.manage')`, [A.roles.cashier])),
      /system roles cannot be changed/i,
    );
    await expectError(
      asUser(db, ownerA, (s) => s.query(`delete from public.role_permissions where role_id = $1`, [A.roles.owner])),
      /system roles cannot be changed/i,
    );
    await expectError(asUser(db, ownerA, (s) => s.query(`update public.roles set name = 'Boss' where id = $1`, [A.roles.owner])), /cannot be renamed/);
    await asUser(db, ownerA, async (s) => {
      expect(await s.query(`delete from public.roles where id = $1 returning id`, [A.roles.cashier])).toHaveLength(0);
      // The discount ceiling of a non-owner system role is adjustable.
      expect(await s.query(`update public.roles set max_discount_percent = 10 where id = $1 returning id`, [A.roles.cashier])).toHaveLength(1);
    });
    const audit = await db.query(`select 1 from public.audit_log where action = 'role.permission_granted' and business_id = $1`, [A.id]);
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  it("seeds the four system roles with the specified permissions", async () => {
    const rows = await db.query<{ system_key: string; perms: string[] }>(
      `select r.system_key, array_agg(rp.permission order by rp.permission) as perms
       from public.roles r join public.role_permissions rp on rp.role_id = r.id
       where r.business_id = $1 and r.is_system group by r.system_key`,
      [B.id],
    );
    const by = Object.fromEntries(rows.rows.map((r) => [r.system_key, r.perms]));
    expect(by.owner).toHaveLength(26);
    expect(by.manager).toHaveLength(24);
    expect(by.manager).not.toContain("staff.manage");
    expect(by.manager).not.toContain("settings.manage");
    expect(by.cashier).toEqual([
      "customers.manage", "customers.view", "inventory.view", "products.view",
      "sales.create", "sales.view_own", "shipments.create", "shipments.view",
    ]);
    expect(by.dispatch).toEqual(["sales.view_all", "shipments.create", "shipments.update", "shipments.view"]);
  });
});

describe("invitations", () => {
  it("accepting an invite creates the membership with the right outlets, once", async () => {
    const invitee = await createUser(db, "newcashier@test.in");
    await asUser(db, ownerA, (s) =>
      s.query(
        `insert into public.invitations (business_id, email, full_name, role_id, outlet_ids, token_hash, expires_at, invited_by)
         values ($1, 'newcashier@test.in', 'New Cashier', $2, $3, 'hash-1', now() + interval '7 days', $4)`,
        [A.id, A.roles.cashier, `{${outletA2}}`, ownerA],
      ),
    );
    await expectError(asService(db, (s) => s.rpc("accept_invitation", { p_token_hash: "hash-1", p_user: cashier1 })), /different email/);
    await expectError(asService(db, (s) => s.rpc("accept_invitation", { p_token_hash: "nope", p_user: invitee })), /not valid/);

    await asService(db, (s) => s.rpc("accept_invitation", { p_token_hash: "hash-1", p_user: invitee }));
    await asUser(db, invitee, async (s) => {
      const outlets = await s.query<{ id: string }>(`select id from public.outlets`);
      expect(outlets.map((o) => o.id)).toEqual([outletA2]);
      expect(await s.query(`select 1 from public.product_costs`)).toHaveLength(0);
    });
    await expectError(asService(db, (s) => s.rpc("accept_invitation", { p_token_hash: "hash-1", p_user: invitee })), /already been used/);
  });

  it("expired and revoked invites are refused", async () => {
    const u = await createUser(db, "late@test.in");
    await asUser(db, ownerA, (s) =>
      s.query(
        `insert into public.invitations (business_id, email, role_id, token_hash, expires_at, revoked_at)
         values ($1, 'late@test.in', $2, 'hash-expired', now() - interval '1 minute', null),
                ($1, 'late@test.in', $2, 'hash-revoked', now() + interval '1 day', now())`,
        [A.id, A.roles.cashier],
      ),
    );
    await expectError(asService(db, (s) => s.rpc("accept_invitation", { p_token_hash: "hash-expired", p_user: u })), /expired/);
    await expectError(asService(db, (s) => s.rpc("accept_invitation", { p_token_hash: "hash-revoked", p_user: u })), /cancelled/);
  });
});
