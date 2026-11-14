/**
 * Test harness: runs the real migration files against PGlite (Postgres compiled
 * to WASM, in memory). No Docker or Supabase project is needed.
 *
 * A small shim stands in for what Supabase provides: the anon / authenticated /
 * service_role roles, the auth schema (auth.users, auth.uid()) and the storage
 * schema. The scheduler migration (pg_cron / pg_net) is skipped.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");
const SKIP = [/scheduler/];

const SHIM = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

-- Supabase grants everything on new objects in "public" to these roles by default.
-- Reproducing that here makes the tests catch a migration that forgets to revoke.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid
);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, service_role;
grant all on storage.objects to authenticated, service_role;
`;

export type Db = PGlite;

export async function createDb(): Promise<Db> {
  const db = new PGlite();
  await db.exec(SHIM);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && !SKIP.some((re) => re.test(f)))
    .sort();
  for (const file of files) {
    try {
      await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  return db;
}

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Session {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Row>(sql: string, params?: unknown[]): Promise<T>;
  rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function makeSession(tx: { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }): Session { // eslint-disable-line @typescript-eslint/no-explicit-any
  const query = async <T,>(sql: string, params: unknown[] = []) =>
    (await tx.query(sql, params as any[])).rows as T[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    query,
    async one<T,>(sql: string, params: unknown[] = []) {
      const rows = await query<T>(sql, params);
      if (rows.length !== 1) throw new Error(`Expected 1 row, got ${rows.length}`);
      return rows[0];
    },
    async rpc(fn, args) {
      const keys = Object.keys(args);
      const call = keys.map((k, i) => `${k} := $${i + 1}`).join(", ");
      const rows = await query<Row>(`select public.${fn}(${call}) as result`, Object.values(args));
      return rows[0]?.result;
    },
  };
}

/** Run `fn` as a signed-in user: role `authenticated` with a JWT `sub`, so RLS applies. */
export async function asUser<T>(db: Db, userId: string, fn: (s: Session) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId })]);
    await tx.exec(`set local role authenticated`);
    return fn(makeSession(tx));
  }) as Promise<T>;
}

/** Run `fn` as the server (service role: bypasses RLS, no JWT). */
export async function asService<T>(db: Db, fn: (s: Session) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', '', true)`);
    await tx.exec(`set local role service_role`);
    return fn(makeSession(tx));
  }) as Promise<T>;
}

/** Run `fn` as an anonymous visitor. */
export async function asAnon<T>(db: Db, fn: (s: Session) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', '', true)`);
    await tx.exec(`set local role anon`);
    return fn(makeSession(tx));
  }) as Promise<T>;
}

export async function createUser(db: Db, email: string, fullName = email.split("@")[0]): Promise<string> {
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    id,
    email,
    JSON.stringify({ full_name: fullName }),
  ]);
  return id;
}

export interface TestBusiness {
  id: string;
  ownerId: string;
  outletId: string;
  roles: Record<"owner" | "manager" | "cashier" | "dispatch", string>;
}

/** Create a business with one outlet and server-allocated invoice + credit note series. */
export async function createBusiness(
  db: Db,
  ownerId: string,
  opts: {
    name?: string;
    scheme?: "regular" | "composition" | "unregistered";
    gstin?: string | null;
    stateCode?: string;
    prefix?: string;
  } = {},
): Promise<TestBusiness> {
  const scheme = opts.scheme ?? "regular";
  const stateCode = opts.stateCode ?? "27";
  const gstin = scheme === "unregistered" ? null : (opts.gstin ?? "27AAPFU0939F1ZV");
  const prefix = opts.prefix ?? "A";

  return asUser(db, ownerId, async (s) => {
    const id = await s.rpc<string>("create_business", {
      p: JSON.stringify({
        legal_name: opts.name ?? "Test Traders",
        gst_scheme: scheme,
        gstin,
        state_code: stateCode,
        city: "Mumbai",
        pincode: "400001",
      }),
    });
    const outlet = await s.one<{ id: string }>(
      `insert into public.outlets (business_id, name, state_code) values ($1, 'Main Shop', $2) returning id`,
      [id, stateCode],
    );
    await s.query(
      `insert into public.invoice_series (business_id, outlet_id, document_type, prefix, financial_year)
       values ($1, $2, 'invoice', $3, public.financial_year(public.ist_today())),
              ($1, $2, 'credit_note', $4, public.financial_year(public.ist_today()))`,
      [id, outlet.id, prefix, `${prefix}CN`],
    );
    const roleRows = await s.query<{ id: string; system_key: string }>(
      `select id, system_key from public.roles where business_id = $1 and is_system`,
      [id],
    );
    const roles = Object.fromEntries(roleRows.map((r) => [r.system_key, r.id])) as TestBusiness["roles"];
    return { id, ownerId, outletId: outlet.id, roles };
  });
}

/** Add an existing user to a business (as the server would after an accepted invite). */
export async function addMember(
  db: Db,
  business: TestBusiness,
  userId: string,
  role: keyof TestBusiness["roles"] | string,
  opts: { allOutlets?: boolean; outletIds?: string[] } = {},
): Promise<string> {
  const roleId = business.roles[role as keyof TestBusiness["roles"]] ?? role;
  const allOutlets = opts.allOutlets ?? !opts.outletIds;
  const rows = await db.query<{ id: string }>(
    `insert into public.business_members (business_id, user_id, role_id, all_outlets)
     values ($1, $2, $3, $4) returning id`,
    [business.id, userId, roleId, allOutlets],
  );
  const memberId = rows.rows[0].id;
  for (const outletId of opts.outletIds ?? []) {
    await db.query(`insert into public.member_outlets (member_id, outlet_id) values ($1, $2)`, [memberId, outletId]);
  }
  return memberId;
}

export async function createProduct(
  db: Db,
  business: TestBusiness,
  over: Partial<{
    name: string;
    sku: string;
    gst_rate: number;
    sale_price_paise: number;
    price_includes_tax: boolean;
    track_inventory: boolean;
    low_stock_threshold: number | null;
    hsn_code: string;
    opening: number;
    cost_paise: number;
  }> = {},
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into public.products (id, business_id, name, sku, hsn_code, gst_rate, sale_price_paise, price_includes_tax,
                                  track_inventory, low_stock_threshold)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      business.id,
      over.name ?? `Product ${id.slice(0, 6)}`,
      over.sku ?? `SKU-${id.slice(0, 8)}`,
      over.hsn_code ?? "6109",
      over.gst_rate ?? 18,
      over.sale_price_paise ?? 118_00,
      over.price_includes_tax ?? true,
      over.track_inventory ?? true,
      over.low_stock_threshold ?? null,
    ],
  );
  if (over.cost_paise !== undefined) {
    await db.query(`insert into public.product_costs (product_id, business_id, purchase_price_paise) values ($1, $2, $3)`, [
      id,
      business.id,
      over.cost_paise,
    ]);
  }
  if (over.opening) {
    await db.query(
      `insert into public.stock_movements (business_id, outlet_id, product_id, quantity_delta, movement_type)
       values ($1, $2, $3, $4, 'opening')`,
      [business.id, business.outletId, id, over.opening],
    );
  }
  return id;
}

export async function stockOf(db: Db, productId: string, outletId: string): Promise<number> {
  const r = await db.query<{ quantity: string }>(
    `select quantity from public.stock_levels where product_id = $1 and outlet_id = $2`,
    [productId, outletId],
  );
  return r.rows.length ? Number(r.rows[0].quantity) : 0;
}

/** Assert that a promise rejects with a message matching `pattern`. */
export async function expectError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  let error: Error | null = null;
  try {
    await promise;
  } catch (e) {
    error = e as Error;
  }
  if (!error) throw new Error(`Expected an error matching ${pattern}, but the call succeeded`);
  if (!pattern.test(error.message)) throw new Error(`Expected error matching ${pattern}, got: ${error.message}`);
}
