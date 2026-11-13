-- ════════════════════════════════════════════════════════════════════════════
-- EkDum · 02 · Master data: GST rates, units, categories, products, customers, vendors
-- ════════════════════════════════════════════════════════════════════════════

-- ── GST rates (reference data, never hardcoded in application code) ─────────
-- Source and verification date are recorded in docs/COMPLIANCE_NOTES.md.

create table public.gst_rates (
  id          uuid primary key default gen_random_uuid(),
  rate        numeric(5,2) not null unique check (rate >= 0 and rate <= 100),
  label       text not null,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

insert into public.gst_rates (rate, label, is_active, sort_order) values
  (0,    '0% (Nil rated / Exempt)',            true,  10),
  (0.25, '0.25% (Rough precious stones)',      true,  20),
  (1.5,  '1.5% (Cut and polished diamonds)',   true,  30),
  (3,    '3% (Gold, silver, jewellery)',       true,  40),
  (5,    '5% (Merit rate)',                    true,  50),
  (18,   '18% (Standard rate)',                true,  60),
  (40,   '40% (Sin and luxury goods)',         true,  70),
  -- Slabs removed by the September 2025 rationalisation. Kept (inactive) so
  -- old purchase bills and historical documents can still be recorded.
  (12,   '12% (Old slab, before 22 Sep 2025)', false, 80),
  (28,   '28% (Old slab, before 22 Sep 2025)', false, 90);

-- ── Units (GST Unique Quantity Codes) ───────────────────────────────────────

create table public.units (
  code        text primary key check (code ~ '^[A-Z]{2,4}$'),
  name        text not null,
  -- Whether fractional quantities make sense (weights, lengths, volumes).
  allow_decimal boolean not null default false,
  is_active   boolean not null default true,
  sort_order  integer not null default 100
);

insert into public.units (code, name, allow_decimal, sort_order) values
  ('PCS', 'Pieces',            false, 1),
  ('NOS', 'Numbers',           false, 2),
  ('KGS', 'Kilograms',         true,  3),
  ('GMS', 'Grams',             true,  4),
  ('LTR', 'Litres',            true,  5),
  ('MLT', 'Millilitres',       true,  6),
  ('MTR', 'Metres',            true,  7),
  ('BOX', 'Box',               false, 8),
  ('PAC', 'Packs',             false, 9),
  ('SET', 'Sets',              false, 10),
  ('DOZ', 'Dozens',            false, 11),
  ('PRS', 'Pairs',             false, 12),
  ('BAG', 'Bags',              false, 20),
  ('BAL', 'Bale',              false, 21),
  ('BDL', 'Bundles',           false, 22),
  ('BKL', 'Buckles',           false, 23),
  ('BOU', 'Billion of units',  false, 24),
  ('BTL', 'Bottles',           false, 25),
  ('BUN', 'Bunches',           false, 26),
  ('CAN', 'Cans',              false, 27),
  ('CBM', 'Cubic metres',      true,  28),
  ('CCM', 'Cubic centimetres', true,  29),
  ('CMS', 'Centimetres',       true,  30),
  ('CTN', 'Cartons',           false, 31),
  ('DRM', 'Drums',             false, 32),
  ('GGK', 'Great gross',       false, 33),
  ('GRS', 'Gross',             false, 34),
  ('GYD', 'Gross yards',       true,  35),
  ('KLR', 'Kilolitre',         true,  36),
  ('KME', 'Kilometre',         true,  37),
  ('MTS', 'Metric ton',        true,  38),
  ('QTL', 'Quintal',           true,  39),
  ('ROL', 'Rolls',             false, 40),
  ('SQF', 'Square feet',       true,  41),
  ('SQM', 'Square metres',     true,  42),
  ('SQY', 'Square yards',      true,  43),
  ('TBS', 'Tablets',           false, 44),
  ('TGM', 'Ten gross',         false, 45),
  ('THD', 'Thousands',         false, 46),
  ('TON', 'Tonnes',            true,  47),
  ('TUB', 'Tubes',             false, 48),
  ('UGS', 'US gallons',        true,  49),
  ('UNT', 'Units',             false, 50),
  ('YDS', 'Yards',             true,  51),
  ('OTH', 'Others',            true,  99);

-- ── Categories ──────────────────────────────────────────────────────────────

create table public.product_categories (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  parent_id    uuid references public.product_categories (id) on delete set null,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index product_categories_name_uniq
  on public.product_categories (business_id, lower(name), coalesce(parent_id, '00000000-0000-0000-0000-000000000000'));
create index product_categories_parent_idx on public.product_categories (parent_id);
create trigger product_categories_set_updated_at before update on public.product_categories
  for each row execute function public.set_updated_at();

-- ── Products ────────────────────────────────────────────────────────────────

create table public.products (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses (id) on delete cascade,
  name                 text not null check (length(trim(name)) > 0),
  sku                  text check (sku is null or length(trim(sku)) > 0),
  barcode              text check (barcode is null or length(trim(barcode)) > 0),
  category_id          uuid references public.product_categories (id) on delete set null,
  hsn_code             text check (hsn_code is null or hsn_code ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$'),
  unit_code            text not null default 'PCS' references public.units (code),
  gst_rate             numeric(5,2) not null default 0 check (gst_rate >= 0 and gst_rate <= 100),
  cess_rate            numeric(5,2) not null default 0 check (cess_rate >= 0 and cess_rate <= 100),
  sale_price_paise     bigint not null default 0 check (sale_price_paise >= 0),
  price_includes_tax   boolean not null default true,
  mrp_paise            bigint check (mrp_paise is null or mrp_paise >= 0),
  track_inventory      boolean not null default true,
  low_stock_threshold  numeric(12,3) check (low_stock_threshold is null or low_stock_threshold >= 0),
  is_active            boolean not null default true,
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index products_sku_uniq on public.products (business_id, sku) where sku is not null;
create unique index products_barcode_uniq on public.products (business_id, barcode) where barcode is not null;
create index products_business_name_idx on public.products (business_id, lower(name));
create index products_category_idx on public.products (category_id);
create index products_business_active_idx on public.products (business_id) where is_active;
create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();

-- Cost prices live in their own table because RLS filters rows, not columns:
-- a cashier with products.view must not be able to read purchase prices.
create table public.product_costs (
  product_id            uuid primary key references public.products (id) on delete cascade,
  business_id           uuid not null references public.businesses (id) on delete cascade,
  purchase_price_paise  bigint not null default 0 check (purchase_price_paise >= 0),
  updated_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index product_costs_business_idx on public.product_costs (business_id);
create trigger product_costs_set_updated_at before update on public.product_costs
  for each row execute function public.set_updated_at();

-- ── Customers ───────────────────────────────────────────────────────────────

create table public.customers (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses (id) on delete cascade,
  name                text not null check (length(trim(name)) > 0),
  -- E.164: +91XXXXXXXXXX
  phone               text check (phone is null or phone ~ '^\+91[6-9][0-9]{9}$'),
  email               text,
  gstin               text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  address_line1       text,
  address_line2       text,
  city                text,
  pincode             text check (pincode is null or pincode ~ '^[1-9][0-9]{5}$'),
  state_code          text check (state_code is null or state_code ~ '^[0-9]{2}$'),
  whatsapp_opt_in     boolean not null default false,
  whatsapp_opt_in_at  timestamptz,
  notes               text,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index customers_phone_uniq on public.customers (business_id, phone) where phone is not null;
create index customers_business_name_idx on public.customers (business_id, lower(name));
create index customers_gstin_idx on public.customers (business_id, gstin) where gstin is not null;
create trigger customers_set_updated_at before update on public.customers
  for each row execute function public.set_updated_at();

-- Keep the opt-in timestamp honest regardless of which code path flips the flag.
create or replace function public.stamp_whatsapp_opt_in()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.whatsapp_opt_in and (tg_op = 'INSERT' or not old.whatsapp_opt_in) then
    new.whatsapp_opt_in_at := coalesce(new.whatsapp_opt_in_at, now());
  elsif not new.whatsapp_opt_in then
    new.whatsapp_opt_in_at := null;
  end if;
  return new;
end;
$$;

create trigger customers_stamp_opt_in before insert or update on public.customers
  for each row execute function public.stamp_whatsapp_opt_in();

-- ── Vendors ─────────────────────────────────────────────────────────────────

create table public.vendors (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  name           text not null check (length(trim(name)) > 0),
  gstin          text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  phone          text,
  email          text,
  address_line1  text,
  address_line2  text,
  city           text,
  pincode        text check (pincode is null or pincode ~ '^[1-9][0-9]{5}$'),
  state_code     text check (state_code is null or state_code ~ '^[0-9]{2}$'),
  notes          text,
  is_active      boolean not null default true,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index vendors_business_name_idx on public.vendors (business_id, lower(name));
create unique index vendors_gstin_uniq on public.vendors (business_id, gstin) where gstin is not null;
create trigger vendors_set_updated_at before update on public.vendors
  for each row execute function public.set_updated_at();

-- ── Row Level Security ──────────────────────────────────────────────────────

alter table public.gst_rates           enable row level security;
alter table public.units               enable row level security;
alter table public.product_categories  enable row level security;
alter table public.products            enable row level security;
alter table public.product_costs       enable row level security;
alter table public.customers           enable row level security;
alter table public.vendors             enable row level security;

create policy gst_rates_select on public.gst_rates for select to authenticated using (true);
create policy units_select on public.units for select to authenticated using (true);

create policy product_categories_select on public.product_categories for select to authenticated
  using (public.has_perm(business_id, 'products.view'));
create policy product_categories_write on public.product_categories for all to authenticated
  using (public.has_perm(business_id, 'products.manage'))
  with check (public.has_perm(business_id, 'products.manage'));

create policy products_select on public.products for select to authenticated
  using (public.has_perm(business_id, 'products.view'));
create policy products_insert on public.products for insert to authenticated
  with check (public.has_perm(business_id, 'products.manage'));
create policy products_update on public.products for update to authenticated
  using (public.has_perm(business_id, 'products.manage'))
  with check (public.has_perm(business_id, 'products.manage'));
create policy products_delete on public.products for delete to authenticated
  using (public.has_perm(business_id, 'products.manage'));

create policy product_costs_select on public.product_costs for select to authenticated
  using (public.has_perm(business_id, 'products.view_cost'));
create policy product_costs_insert on public.product_costs for insert to authenticated
  with check (
    public.has_perm(business_id, 'products.manage') and public.has_perm(business_id, 'products.view_cost')
    and exists (select 1 from public.products p where p.id = product_id and p.business_id = product_costs.business_id)
  );
create policy product_costs_update on public.product_costs for update to authenticated
  using (public.has_perm(business_id, 'products.manage') and public.has_perm(business_id, 'products.view_cost'))
  with check (public.has_perm(business_id, 'products.manage') and public.has_perm(business_id, 'products.view_cost'));

create policy customers_select on public.customers for select to authenticated
  using (public.has_perm(business_id, 'customers.view'));
create policy customers_insert on public.customers for insert to authenticated
  with check (public.has_perm(business_id, 'customers.manage'));
create policy customers_update on public.customers for update to authenticated
  using (public.has_perm(business_id, 'customers.manage'))
  with check (public.has_perm(business_id, 'customers.manage'));
create policy customers_delete on public.customers for delete to authenticated
  using (public.has_perm(business_id, 'customers.manage'));

create policy vendors_select on public.vendors for select to authenticated
  using (public.has_perm(business_id, 'vendors.manage') or public.has_perm(business_id, 'purchases.view'));
create policy vendors_insert on public.vendors for insert to authenticated
  with check (public.has_perm(business_id, 'vendors.manage'));
create policy vendors_update on public.vendors for update to authenticated
  using (public.has_perm(business_id, 'vendors.manage'))
  with check (public.has_perm(business_id, 'vendors.manage'));
create policy vendors_delete on public.vendors for delete to authenticated
  using (public.has_perm(business_id, 'vendors.manage'));
