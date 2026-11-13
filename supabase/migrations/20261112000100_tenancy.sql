-- ════════════════════════════════════════════════════════════════════════════
-- EkDum · 01 · Core helpers, tenancy, roles, permissions, invitations, audit
-- ════════════════════════════════════════════════════════════════════════════

-- ── Generic helpers ─────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Calendar date in India for an instant. IST has no DST, so this is safe to index.
create or replace function public.ist_date(ts timestamptz)
returns date
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select (ts at time zone 'Asia/Kolkata')::date;
$$;

create or replace function public.ist_today()
returns date
language sql
stable
set search_path = public, pg_temp
as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

-- Indian financial year (1 Apr – 31 Mar) in compact form: 2026-04-01 → '2627'.
create or replace function public.financial_year(d date)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select lpad((fy_start % 100)::text, 2, '0') || lpad(((fy_start + 1) % 100)::text, 2, '0')
  from (
    select case when extract(month from d) >= 4
                then extract(year from d)::int
                else extract(year from d)::int - 1
           end as fy_start
  ) s;
$$;

-- 64 hex characters of randomness without needing pgcrypto.
create or replace function public.random_token()
returns text
language sql
volatile
set search_path = public, pg_temp
as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
$$;

-- ── Profiles ────────────────────────────────────────────────────────────────

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  phone       text,
  email       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, phone, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    lower(new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = lower(new.email) where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- ── Businesses and outlets ──────────────────────────────────────────────────

create table public.businesses (
  id                      uuid primary key default gen_random_uuid(),
  legal_name              text not null check (length(trim(legal_name)) > 0),
  trade_name              text,
  gst_scheme              text not null default 'unregistered'
                          check (gst_scheme in ('regular', 'composition', 'unregistered')),
  gstin                   text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  pan                     text check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  state_code              text not null check (state_code ~ '^[0-9]{2}$'),
  address_line1           text,
  address_line2           text,
  city                    text,
  pincode                 text check (pincode is null or pincode ~ '^[1-9][0-9]{5}$'),
  phone                   text,
  email                   text,
  logo_path               text,
  brand_color             text not null default '#4338CA' check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  bank_name               text,
  bank_account_name       text,
  bank_account_number     text,
  ifsc                    text check (ifsc is null or ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  upi_id                  text,
  invoice_terms           text,
  invoice_footer          text,
  round_off_enabled       boolean not null default true,
  allow_negative_stock    boolean not null default true,
  -- Settings the spec implies (sections 8.1, 8.5, 8.6, 9.11, 18):
  hsn_digits              smallint not null default 4 check (hsn_digits in (4, 6, 8)),
  default_print_format    text not null default 'thermal_80'
                          check (default_print_format in ('a4', 'thermal_80', 'thermal_58')),
  -- 0 = same IST day only, n = within n days, null = no limit.
  cancel_window_days      integer default 0 check (cancel_window_days is null or cancel_window_days >= 0),
  bos_for_exempt_only     boolean not null default true,
  stuck_shipment_days     integer not null default 5 check (stuck_shipment_days > 0),
  notify_email_enabled    boolean not null default true,
  notify_whatsapp_enabled boolean not null default true,
  onboarding_step         integer not null default 1,
  onboarding_completed_at timestamptz,
  created_by              uuid references auth.users (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  -- A registered business must have a GSTIN; an unregistered one must not show one.
  constraint businesses_gstin_matches_scheme check (
    (gst_scheme = 'unregistered' and gstin is null)
    or (gst_scheme in ('regular', 'composition') and gstin is not null)
  ),
  constraint businesses_gstin_state check (gstin is null or left(gstin, 2) = state_code)
);

create trigger businesses_set_updated_at before update on public.businesses
  for each row execute function public.set_updated_at();

create table public.outlets (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  name           text not null check (length(trim(name)) > 0),
  address_line1  text,
  address_line2  text,
  city           text,
  pincode        text check (pincode is null or pincode ~ '^[1-9][0-9]{5}$'),
  state_code     text not null check (state_code ~ '^[0-9]{2}$'),
  -- Null → use the business GSTIN. Set only for an outlet registered in another state.
  gstin          text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  phone          text,
  is_active      boolean not null default true,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, name)
);

create index outlets_business_idx on public.outlets (business_id);
create trigger outlets_set_updated_at before update on public.outlets
  for each row execute function public.set_updated_at();

-- ── Permissions and roles ───────────────────────────────────────────────────

create table public.permissions (
  key         text primary key,
  group_name  text not null,
  label       text not null,
  sort_order  integer not null default 0
);

insert into public.permissions (key, group_name, label, sort_order) values
  ('dashboard.view',       'Dashboard', 'View the owner dashboard',                 10),
  ('sales.create',         'Sales',     'Create bills at the POS',                  20),
  ('sales.view_own',       'Sales',     'View own bills',                           21),
  ('sales.view_all',       'Sales',     'View all bills',                           22),
  ('sales.cancel',         'Sales',     'Cancel bills',                             23),
  ('sales.credit_note',    'Sales',     'Issue credit notes (returns)',             24),
  ('sales.discount',       'Sales',     'Give discounts (up to the role limit)',    25),
  ('sales.price_override', 'Sales',     'Change the selling price on a bill',       26),
  ('products.view',        'Products',  'View products',                            30),
  ('products.manage',      'Products',  'Add and edit products',                    31),
  ('products.view_cost',   'Products',  'See purchase (cost) prices',               32),
  ('inventory.view',       'Inventory', 'View stock levels',                        40),
  ('inventory.adjust',     'Inventory', 'Adjust stock',                             41),
  ('customers.view',       'Customers', 'View customers',                           50),
  ('customers.manage',     'Customers', 'Add and edit customers',                   51),
  ('vendors.manage',       'Purchases', 'Add and edit vendors',                     60),
  ('purchases.view',       'Purchases', 'View purchase bills',                      61),
  ('purchases.create',     'Purchases', 'Enter purchase bills and payments',        62),
  ('purchases.post',       'Purchases', 'Post purchase bills (updates stock)',      63),
  ('shipments.view',       'Shipments', 'View shipments',                           70),
  ('shipments.create',     'Shipments', 'Create shipments',                         71),
  ('shipments.update',     'Shipments', 'Update shipment status',                   72),
  ('reports.view',         'Reports',   'View reports',                             80),
  ('reports.export',       'Reports',   'Export reports to CSV',                    81),
  ('staff.manage',         'Admin',     'Manage staff, roles and invites',          90),
  ('settings.manage',      'Admin',     'Manage business settings',                 91);

create table public.roles (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references public.businesses (id) on delete cascade,
  name                  text not null check (length(trim(name)) > 0),
  is_system             boolean not null default false,
  -- 'owner' | 'manager' | 'cashier' | 'dispatch' for seeded roles, null for custom ones.
  system_key            text check (system_key in ('owner', 'manager', 'cashier', 'dispatch')),
  max_discount_percent  numeric(5,2) not null default 0
                        check (max_discount_percent >= 0 and max_discount_percent <= 100),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (business_id, name),
  constraint roles_system_key_only_for_system check ((system_key is null) = (not is_system))
);

create index roles_business_idx on public.roles (business_id);
create unique index roles_system_key_uniq on public.roles (business_id, system_key) where system_key is not null;
create trigger roles_set_updated_at before update on public.roles
  for each row execute function public.set_updated_at();

create table public.role_permissions (
  role_id     uuid not null references public.roles (id) on delete cascade,
  permission  text not null references public.permissions (key) on update cascade,
  created_at  timestamptz not null default now(),
  primary key (role_id, permission)
);

create table public.business_members (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role_id         uuid not null references public.roles (id) on delete restrict,
  is_active       boolean not null default true,
  all_outlets     boolean not null default false,
  last_active_at  timestamptz,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (business_id, user_id)
);

create index business_members_user_idx on public.business_members (user_id) where is_active;
create index business_members_role_idx on public.business_members (role_id);
create trigger business_members_set_updated_at before update on public.business_members
  for each row execute function public.set_updated_at();

create table public.member_outlets (
  member_id   uuid not null references public.business_members (id) on delete cascade,
  outlet_id   uuid not null references public.outlets (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (member_id, outlet_id)
);

create index member_outlets_outlet_idx on public.member_outlets (outlet_id);

create table public.invitations (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  email        text not null check (email = lower(email) and position('@' in email) > 1),
  full_name    text,
  role_id      uuid not null references public.roles (id) on delete cascade,
  all_outlets  boolean not null default false,
  outlet_ids   uuid[] not null default '{}',
  -- SHA-256 of the token in the invite link. The raw token is never stored.
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  invited_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index invitations_business_idx on public.invitations (business_id);
create index invitations_email_idx on public.invitations (email);
create index invitations_role_idx on public.invitations (role_id);
create trigger invitations_set_updated_at before update on public.invitations
  for each row execute function public.set_updated_at();

create table public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  actor_id     uuid references auth.users (id) on delete set null,
  action       text not null,
  entity       text not null,
  entity_id    uuid,
  before       jsonb,
  after        jsonb,
  created_at   timestamptz not null default now()
);

create index audit_log_business_created_idx on public.audit_log (business_id, created_at desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);

-- Fixed-window rate limiter, used only from the server (service role).
create table public.rate_limits (
  key           text not null,
  window_start  timestamptz not null,
  hits          integer not null default 1,
  primary key (key, window_start)
);

-- ── Security helper functions ───────────────────────────────────────────────
-- All are SECURITY DEFINER with a fixed search_path so RLS policies can call
-- them without recursing into the policies of the tables they read.

create or replace function public.is_member_for(p_user uuid, p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = p_business_id and m.user_id = p_user and m.is_active
  );
$$;

create or replace function public.is_member(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_member_for(auth.uid(), p_business_id);
$$;

create or replace function public.has_perm_for(p_user uuid, p_business_id uuid, p_perm text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.business_members m
    join public.role_permissions rp on rp.role_id = m.role_id
    where m.business_id = p_business_id
      and m.user_id = p_user
      and m.is_active
      and rp.permission = p_perm
  );
$$;

create or replace function public.has_perm(p_business_id uuid, p_perm text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_perm_for(auth.uid(), p_business_id, p_perm);
$$;

create or replace function public.can_access_outlet_for(p_user uuid, p_outlet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.outlets o
    join public.business_members m on m.business_id = o.business_id
    where o.id = p_outlet_id
      and m.user_id = p_user
      and m.is_active
      and (
        m.all_outlets
        or exists (
          select 1 from public.member_outlets mo
          where mo.member_id = m.id and mo.outlet_id = o.id
        )
      )
  );
$$;

create or replace function public.can_access_outlet(p_outlet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.can_access_outlet_for(auth.uid(), p_outlet_id);
$$;

-- Same check without reading the outlets table. Used by the outlets SELECT
-- policy so that INSERT … RETURNING works (a row being inserted is not yet
-- visible to a STABLE function that looks it up).
create or replace function public.can_access_outlet_of(p_business_id uuid, p_outlet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.business_members m
    where m.business_id = p_business_id
      and m.user_id = auth.uid()
      and m.is_active
      and (
        m.all_outlets
        or exists (
          select 1 from public.member_outlets mo
          where mo.member_id = m.id and mo.outlet_id = p_outlet_id
        )
      )
  );
$$;

create or replace function public.is_owner_for(p_user uuid, p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.business_members m
    join public.roles r on r.id = m.role_id
    where m.business_id = p_business_id and m.user_id = p_user and m.is_active
      and r.system_key = 'owner'
  );
$$;

-- True when the two users are (active) members of at least one common business.
create or replace function public.shares_business_with(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.business_members me
    join public.business_members them on them.business_id = me.business_id
    where me.user_id = auth.uid() and me.is_active and them.user_id = p_other
  );
$$;

-- The role's discount ceiling for a user (0 when they have no sales.discount permission).
create or replace function public.max_discount_for(p_user uuid, p_business_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case when public.has_perm_for(p_user, p_business_id, 'sales.discount')
                then r.max_discount_percent else 0 end
    from public.business_members m
    join public.roles r on r.id = m.role_id
    where m.business_id = p_business_id and m.user_id = p_user and m.is_active
  ), 0);
$$;

-- Internal: append to the audit log. Not callable through the API.
create or replace function public.write_audit(
  p_business_id uuid,
  p_actor uuid,
  p_action text,
  p_entity text,
  p_entity_id uuid,
  p_before jsonb default null,
  p_after jsonb default null
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.audit_log (business_id, actor_id, action, entity, entity_id, before, after)
  values (p_business_id, p_actor, p_action, p_entity, p_entity_id, p_before, p_after);
$$;

-- Fixed-window limiter: returns true when the call is allowed.
create or replace function public.check_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limits as rl (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = rl.hits + 1
  returning hits into v_hits;

  -- Opportunistic cleanup so the table stays small.
  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_hits <= p_limit;
end;
$$;

-- ── Role seeding and business creation ──────────────────────────────────────

create or replace function public.seed_system_roles(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_manager uuid;
  v_cashier uuid;
  v_dispatch uuid;
begin
  perform set_config('ekdum.seeding', '1', true);

  insert into public.roles (business_id, name, is_system, system_key, max_discount_percent)
  values (p_business_id, 'Owner', true, 'owner', 100) returning id into v_owner;
  insert into public.roles (business_id, name, is_system, system_key, max_discount_percent)
  values (p_business_id, 'Manager', true, 'manager', 25) returning id into v_manager;
  insert into public.roles (business_id, name, is_system, system_key, max_discount_percent)
  values (p_business_id, 'Cashier', true, 'cashier', 0) returning id into v_cashier;
  insert into public.roles (business_id, name, is_system, system_key, max_discount_percent)
  values (p_business_id, 'Dispatch', true, 'dispatch', 0) returning id into v_dispatch;

  insert into public.role_permissions (role_id, permission)
  select v_owner, key from public.permissions;

  insert into public.role_permissions (role_id, permission)
  select v_manager, key from public.permissions
  where key not in ('staff.manage', 'settings.manage');

  -- Spec list + shipments.view, so a cashier can see the shipment they just created.
  insert into public.role_permissions (role_id, permission)
  select v_cashier, unnest(array[
    'sales.create', 'sales.view_own', 'products.view', 'customers.view', 'customers.manage',
    'shipments.create', 'shipments.view', 'inventory.view'
  ]);

  insert into public.role_permissions (role_id, permission)
  select v_dispatch, unnest(array[
    'shipments.view', 'shipments.create', 'shipments.update', 'sales.view_all'
  ]);

  perform set_config('ekdum.seeding', '0', true);
end;
$$;

-- Creates a business, seeds its system roles and makes the caller its Owner.
create or replace function public.create_business(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_business uuid;
  v_owner_role uuid;
  v_scheme text := coalesce(p ->> 'gst_scheme', 'unregistered');
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if (select count(*) from public.business_members where user_id = v_user and is_active) >= 20 then
    raise exception 'You have reached the limit of businesses for one account';
  end if;

  insert into public.businesses (
    legal_name, trade_name, gst_scheme, gstin, pan, state_code,
    address_line1, address_line2, city, pincode, phone, email, created_by, onboarding_step
  ) values (
    trim(p ->> 'legal_name'),
    nullif(trim(coalesce(p ->> 'trade_name', '')), ''),
    v_scheme,
    case when v_scheme = 'unregistered' then null else nullif(upper(trim(coalesce(p ->> 'gstin', ''))), '') end,
    nullif(upper(trim(coalesce(p ->> 'pan', ''))), ''),
    p ->> 'state_code',
    nullif(trim(coalesce(p ->> 'address_line1', '')), ''),
    nullif(trim(coalesce(p ->> 'address_line2', '')), ''),
    nullif(trim(coalesce(p ->> 'city', '')), ''),
    nullif(trim(coalesce(p ->> 'pincode', '')), ''),
    nullif(trim(coalesce(p ->> 'phone', '')), ''),
    nullif(lower(trim(coalesce(p ->> 'email', ''))), ''),
    v_user,
    2
  ) returning id into v_business;

  perform public.seed_system_roles(v_business);

  select id into v_owner_role from public.roles
  where business_id = v_business and system_key = 'owner';

  insert into public.business_members (business_id, user_id, role_id, is_active, all_outlets, created_by)
  values (v_business, v_user, v_owner_role, true, true, v_user);

  perform public.write_audit(v_business, v_user, 'business.created', 'businesses', v_business, null,
    jsonb_build_object('legal_name', p ->> 'legal_name', 'gst_scheme', v_scheme));

  return v_business;
end;
$$;

-- ── Guards ──────────────────────────────────────────────────────────────────

-- System roles are fixed: they cannot be renamed or deleted, and their
-- permission set cannot be edited. Only the discount ceiling can change.
create or replace function public.guard_roles()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('ekdum.seeding', true), '0') = '1' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.is_system then
      -- Allow the cascade when the whole business is being deleted.
      if exists (select 1 from public.businesses b where b.id = old.business_id) then
        raise exception 'System roles cannot be deleted';
      end if;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.is_system or new.system_key is not null then
      raise exception 'System roles are created automatically';
    end if;
    return new;
  end if;

  if new.business_id <> old.business_id or new.is_system <> old.is_system
     or new.system_key is distinct from old.system_key then
    raise exception 'This role field cannot be changed';
  end if;
  if old.is_system and new.name <> old.name then
    raise exception 'System roles cannot be renamed';
  end if;
  if old.system_key = 'owner' and new.max_discount_percent <> old.max_discount_percent then
    raise exception 'The Owner role cannot be changed';
  end if;
  return new;
end;
$$;

create trigger roles_guard before insert or update or delete on public.roles
  for each row execute function public.guard_roles();

create or replace function public.guard_role_permissions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.roles;
  v_role_id uuid;
  v_permission text;
begin
  if tg_op = 'DELETE' then
    v_role_id := old.role_id; v_permission := old.permission;
  else
    v_role_id := new.role_id; v_permission := new.permission;
  end if;

  if coalesce(current_setting('ekdum.seeding', true), '0') = '1' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select * into v_role from public.roles where id = v_role_id;
  if not found then
    if tg_op = 'DELETE' then return old; end if; -- role is being deleted (cascade)
    return new;
  end if;
  if v_role.is_system then
    raise exception 'Permissions of system roles cannot be changed. Create a custom role instead.';
  end if;

  perform public.write_audit(
    v_role.business_id, auth.uid(),
    case when tg_op = 'INSERT' then 'role.permission_granted' else 'role.permission_revoked' end,
    'roles', v_role.id, null,
    jsonb_build_object('role', v_role.name, 'permission', v_permission)
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger role_permissions_guard before insert or delete on public.role_permissions
  for each row execute function public.guard_role_permissions();

-- Membership guards: last active Owner, who may grant Owner, and audit trail.
create or replace function public.guard_business_members()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_old_is_owner boolean := false;
  v_new_is_owner boolean := false;
  v_other_owners integer;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select (r.system_key = 'owner') into v_old_is_owner from public.roles r where r.id = old.role_id;
    v_old_is_owner := coalesce(v_old_is_owner, false) and old.is_active;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select (r.system_key = 'owner') into v_new_is_owner from public.roles r where r.id = new.role_id;
    v_new_is_owner := coalesce(v_new_is_owner, false) and new.is_active;

    if not exists (select 1 from public.roles r where r.id = new.role_id and r.business_id = new.business_id) then
      raise exception 'Role does not belong to this business';
    end if;
  end if;

  if tg_op = 'UPDATE' and (new.business_id <> old.business_id or new.user_id <> old.user_id) then
    raise exception 'A membership cannot be moved to another business or user';
  end if;

  -- Only an Owner may make someone an Owner (the very first member is the exception).
  if v_new_is_owner and not v_old_is_owner and v_actor is not null
     and exists (select 1 from public.business_members m where m.business_id = new.business_id)
     and not public.is_owner_for(v_actor, new.business_id) then
    raise exception 'Only an owner can assign the Owner role';
  end if;

  -- Never leave a business without an active Owner.
  if v_old_is_owner and not v_new_is_owner
     and exists (select 1 from public.businesses b where b.id = old.business_id) then
    select count(*) into v_other_owners
    from public.business_members m
    join public.roles r on r.id = m.role_id
    where m.business_id = old.business_id and m.is_active and r.system_key = 'owner' and m.id <> old.id;
    if v_other_owners = 0 then
      raise exception 'A business must always have at least one active owner';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.is_active is distinct from old.is_active then
      perform public.write_audit(new.business_id, v_actor,
        case when new.is_active then 'member.reactivated' else 'member.deactivated' end,
        'business_members', new.id,
        jsonb_build_object('is_active', old.is_active), jsonb_build_object('is_active', new.is_active, 'user_id', new.user_id));
    end if;
    if new.role_id is distinct from old.role_id then
      perform public.write_audit(new.business_id, v_actor, 'member.role_changed', 'business_members', new.id,
        jsonb_build_object('role_id', old.role_id), jsonb_build_object('role_id', new.role_id, 'user_id', new.user_id));
    end if;
    if new.all_outlets is distinct from old.all_outlets then
      perform public.write_audit(new.business_id, v_actor, 'member.outlet_access_changed', 'business_members', new.id,
        jsonb_build_object('all_outlets', old.all_outlets), jsonb_build_object('all_outlets', new.all_outlets));
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger business_members_guard before insert or update or delete on public.business_members
  for each row execute function public.guard_business_members();

-- ── Invitations ─────────────────────────────────────────────────────────────

-- Server-only: turn a valid invitation into a membership for p_user.
create or replace function public.accept_invitation(p_token_hash text, p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv public.invitations;
  v_member uuid;
  v_email text;
begin
  select * into v_inv from public.invitations where token_hash = p_token_hash for update;
  if not found then
    raise exception 'This invite link is not valid';
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'This invite has been cancelled';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'This invite has already been used';
  end if;
  if v_inv.expires_at < now() then
    raise exception 'This invite has expired. Ask the owner to send a new one.';
  end if;

  select lower(email) into v_email from auth.users where id = p_user;
  if v_email is null or v_email <> v_inv.email then
    raise exception 'This invite was sent to a different email address';
  end if;

  insert into public.business_members (business_id, user_id, role_id, is_active, all_outlets, created_by)
  values (v_inv.business_id, p_user, v_inv.role_id, true, v_inv.all_outlets, v_inv.invited_by)
  on conflict (business_id, user_id) do update
    set role_id = excluded.role_id, is_active = true, all_outlets = excluded.all_outlets
  returning id into v_member;

  delete from public.member_outlets where member_id = v_member;
  insert into public.member_outlets (member_id, outlet_id)
  select v_member, o.id
  from public.outlets o
  where o.business_id = v_inv.business_id and o.id = any (v_inv.outlet_ids);

  update public.invitations set accepted_at = now() where id = v_inv.id;

  if v_inv.full_name is not null then
    update public.profiles set full_name = v_inv.full_name where id = p_user and full_name = '';
  end if;

  perform public.write_audit(v_inv.business_id, p_user, 'member.joined', 'business_members', v_member, null,
    jsonb_build_object('email', v_inv.email, 'role_id', v_inv.role_id));

  return v_member;
end;
$$;

-- Only an Owner may invite someone as an Owner, and the role must be the business's own.
create or replace function public.guard_invitations()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.roles;
begin
  select * into v_role from public.roles where id = new.role_id;
  if not found or v_role.business_id <> new.business_id then
    raise exception 'Role does not belong to this business';
  end if;
  if v_role.system_key = 'owner' and auth.uid() is not null
     and not public.is_owner_for(auth.uid(), new.business_id) then
    raise exception 'Only an owner can invite another owner';
  end if;
  return new;
end;
$$;

create trigger invitations_guard before insert or update on public.invitations
  for each row execute function public.guard_invitations();

-- Replace a member's outlet list in one call (staff.manage).
create or replace function public.set_member_outlets(p_member_id uuid, p_all_outlets boolean, p_outlet_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member public.business_members;
begin
  select * into v_member from public.business_members where id = p_member_id;
  if not found or not public.has_perm(v_member.business_id, 'staff.manage') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  update public.business_members set all_outlets = p_all_outlets where id = p_member_id;
  delete from public.member_outlets where member_id = p_member_id;
  if not p_all_outlets then
    insert into public.member_outlets (member_id, outlet_id)
    select p_member_id, o.id from public.outlets o
    where o.business_id = v_member.business_id and o.id = any (coalesce(p_outlet_ids, '{}'));
  end if;
end;
$$;

create or replace function public.touch_member_activity(p_business_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.business_members
  set last_active_at = now()
  where business_id = p_business_id and user_id = auth.uid() and is_active
    and (last_active_at is null or last_active_at < now() - interval '5 minutes');
$$;

-- ── Row Level Security ──────────────────────────────────────────────────────

alter table public.profiles          enable row level security;
alter table public.businesses        enable row level security;
alter table public.outlets           enable row level security;
alter table public.permissions       enable row level security;
alter table public.roles             enable row level security;
alter table public.role_permissions  enable row level security;
alter table public.business_members  enable row level security;
alter table public.member_outlets    enable row level security;
alter table public.invitations       enable row level security;
alter table public.audit_log         enable row level security;
alter table public.rate_limits       enable row level security; -- no policies: service role only

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_business_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy businesses_select on public.businesses for select to authenticated
  using (public.is_member(id));
create policy businesses_update on public.businesses for update to authenticated
  using (public.has_perm(id, 'settings.manage')) with check (public.has_perm(id, 'settings.manage'));

create policy outlets_select on public.outlets for select to authenticated
  using (public.can_access_outlet_of(business_id, id));
create policy outlets_insert on public.outlets for insert to authenticated
  with check (public.has_perm(business_id, 'settings.manage'));
create policy outlets_update on public.outlets for update to authenticated
  using (public.has_perm(business_id, 'settings.manage'))
  with check (public.has_perm(business_id, 'settings.manage'));

create policy permissions_select on public.permissions for select to authenticated using (true);

create policy roles_select on public.roles for select to authenticated
  using (public.is_member(business_id));
create policy roles_insert on public.roles for insert to authenticated
  with check (public.has_perm(business_id, 'staff.manage'));
create policy roles_update on public.roles for update to authenticated
  using (public.has_perm(business_id, 'staff.manage'))
  with check (public.has_perm(business_id, 'staff.manage'));
create policy roles_delete on public.roles for delete to authenticated
  using (public.has_perm(business_id, 'staff.manage') and not is_system);

create policy role_permissions_select on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and public.is_member(r.business_id)));
create policy role_permissions_insert on public.role_permissions for insert to authenticated
  with check (exists (select 1 from public.roles r where r.id = role_id and public.has_perm(r.business_id, 'staff.manage')));
create policy role_permissions_delete on public.role_permissions for delete to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and public.has_perm(r.business_id, 'staff.manage')));

create policy business_members_select on public.business_members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_member(business_id));
create policy business_members_update on public.business_members for update to authenticated
  using (public.has_perm(business_id, 'staff.manage'))
  with check (public.has_perm(business_id, 'staff.manage'));

create policy member_outlets_select on public.member_outlets for select to authenticated
  using (exists (select 1 from public.business_members m where m.id = member_id and public.is_member(m.business_id)));

create policy invitations_all on public.invitations for all to authenticated
  using (public.has_perm(business_id, 'staff.manage'))
  with check (public.has_perm(business_id, 'staff.manage'));

create policy audit_log_select on public.audit_log for select to authenticated
  using (public.has_perm(business_id, 'settings.manage') or public.has_perm(business_id, 'staff.manage'));
