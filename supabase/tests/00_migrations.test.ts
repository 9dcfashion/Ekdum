import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "./harness";

let db: Db;
beforeAll(async () => {
  db = await createDb();
});

describe("migrations", () => {
  it("apply cleanly", async () => {
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    expect(r.rows[0].n).toBeGreaterThan(30);
  });

  it("enable RLS on every public table, with no exceptions", async () => {
    const r = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(r.rows.map((x) => x.relname)).toEqual([]);
  });

  it("give every security definer function a fixed search_path", async () => {
    const r = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
    );
    expect(r.rows.map((x) => x.proname)).toEqual([]);
  });

  it("grant anon nothing in the public schema", async () => {
    const tables = await db.query<{ n: number }>(
      `select count(*)::int as n from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'`,
    );
    expect(tables.rows[0].n).toBe(0);
    const fns = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(fns.rows.map((x) => x.proname)).toEqual([]);
  });

  it("keep server-only functions away from signed-in users", async () => {
    const r = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
         and p.proname in ('post_sales_invoice', 'save_purchase_bill', 'accept_invitation', 'claim_notification_jobs',
                           'complete_notification_job', 'check_rate_limit', 'write_audit', 'seed_system_roles',
                           'queue_invoice_notification', 'has_perm_for', 'is_member_for', 'lock_series')`,
    );
    expect(r.rows.map((x) => x.proname)).toEqual([]);
  });

  it("index every foreign key", async () => {
    const r = await db.query<{ fk: string }>(`
      select c.conrelid::regclass::text || '(' || string_agg(a.attname, ',' order by x.n) || ')' as fk
      from pg_constraint c
      cross join lateral unnest(c.conkey) with ordinality as x(attnum, n)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = x.attnum
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid
            and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
        )
        -- audit columns (who did it) are never filtered on
        and not (cardinality(c.conkey) = 1 and (select attname from pg_attribute where attrelid = c.conrelid and attnum = c.conkey[1])
                 in ('created_by', 'updated_by', 'posted_by', 'cancelled_by', 'invited_by', 'actor_id', 'unit_code', 'permission'))
      group by c.oid, c.conrelid
      order by 1`);
    expect(r.rows.map((x) => x.fk)).toEqual([]);
  });

  it("seed GST rates, units and permissions", async () => {
    const rates = await db.query<{ rate: string }>(`select rate from public.gst_rates where is_active order by rate`);
    expect(rates.rows.map((x) => Number(x.rate))).toEqual([0, 0.25, 1.5, 3, 5, 18, 40]);
    const units = await db.query<{ n: number }>(`select count(*)::int as n from public.units`);
    expect(units.rows[0].n).toBeGreaterThan(30);
    const perms = await db.query<{ n: number }>(`select count(*)::int as n from public.permissions`);
    expect(perms.rows[0].n).toBe(26);
  });

  it("compute IST dates and financial years in SQL like the app does", async () => {
    const r = await db.query<Record<string, string>>(`
      select public.financial_year('2026-04-01') as a, public.financial_year('2027-03-31') as b,
             public.financial_year('2026-03-31') as c, public.financial_year('2099-12-01') as d,
             public.ist_date('2026-03-31T18:29:59Z')::text as e, public.ist_date('2026-03-31T18:30:00Z')::text as f,
             public.format_document_number('C1', '2627', 42) as g`);
    expect(r.rows[0]).toEqual({ a: "2627", b: "2627", c: "2526", d: "9900", e: "2026-03-31", f: "2026-04-01", g: "C1/2627/00042" });
  });
});
