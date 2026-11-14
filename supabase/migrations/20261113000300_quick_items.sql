-- ════════════════════════════════════════════════════════════════════════════
-- EkDum · 13 · Quick billing items
-- ════════════════════════════════════════════════════════════════════════════
-- Preset item buttons for fast billing on a phone: the cashier taps "Necklace",
-- types the rate (and quantity), and the line goes on the bill with the shop's
-- GST rate, HSN code and unit already set. Billed as manual lines (no product,
-- no stock), so a shop can bill without building a product catalogue first.

create table public.quick_items (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses (id) on delete cascade,
  name                text not null check (length(trim(name)) between 1 and 60),
  gst_rate            numeric(5,2) not null default 0 check (gst_rate >= 0 and gst_rate <= 100),
  hsn_code            text check (hsn_code is null or hsn_code ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$'),
  unit_code           text not null default 'PCS' references public.units (code),
  -- Wholesale bills usually quote the rate before GST (the reference bill does).
  price_includes_tax  boolean not null default false,
  default_rate_paise  bigint check (default_rate_paise is null or default_rate_paise > 0),
  sort_order          integer not null default 0,
  is_active           boolean not null default true,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index quick_items_name_uniq on public.quick_items (business_id, lower(trim(name)));
create index quick_items_business_idx on public.quick_items (business_id, sort_order) where is_active;
create index quick_items_unit_idx on public.quick_items (unit_code);
create trigger quick_items_set_updated_at before update on public.quick_items
  for each row execute function public.set_updated_at();

-- Keep the list short enough to stay quick on a phone.
create or replace function public.guard_quick_items()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.business_id <> old.business_id then
    raise exception 'A quick item cannot be moved to another business';
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.quick_items q where q.business_id = new.business_id) >= 60 then
    raise exception 'You can have at most 60 quick items';
  end if;
  return new;
end;
$$;

create trigger quick_items_guard before insert or update on public.quick_items
  for each row execute function public.guard_quick_items();

revoke execute on function public.guard_quick_items() from public, anon, authenticated;

alter table public.quick_items enable row level security;

-- Every member can bill with them; owners and managers (products.manage or settings.manage) maintain them.
create policy quick_items_select on public.quick_items for select to authenticated
  using (public.is_member(business_id));
create policy quick_items_insert on public.quick_items for insert to authenticated
  with check (public.has_perm(business_id, 'products.manage') or public.has_perm(business_id, 'settings.manage'));
create policy quick_items_update on public.quick_items for update to authenticated
  using (public.has_perm(business_id, 'products.manage') or public.has_perm(business_id, 'settings.manage'))
  with check (public.has_perm(business_id, 'products.manage') or public.has_perm(business_id, 'settings.manage'));
create policy quick_items_delete on public.quick_items for delete to authenticated
  using (public.has_perm(business_id, 'products.manage') or public.has_perm(business_id, 'settings.manage'));

-- Supabase grants ALL on new tables by default (and TRUNCATE ignores RLS): start from nothing.
revoke all on public.quick_items from public, anon, authenticated;
grant select, insert, update, delete on public.quick_items to authenticated;
grant all on public.quick_items to service_role;
