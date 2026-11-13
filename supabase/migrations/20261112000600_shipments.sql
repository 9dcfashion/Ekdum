-- ════════════════════════════════════════════════════════════════════════════
-- EkDum · 06 · Courier partners and shipment log
-- ════════════════════════════════════════════════════════════════════════════

create table public.courier_partners (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid not null references public.businesses (id) on delete cascade,
  name                   text not null check (length(trim(name)) > 0),
  -- e.g. https://example.com/track?awb={awb} — {awb} is replaced with the tracking number.
  tracking_url_template  text check (
    tracking_url_template is null
    or (tracking_url_template ~ '^https?://' and position('{awb}' in tracking_url_template) > 0)
  ),
  is_active              boolean not null default true,
  created_by             uuid references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index courier_partners_name_uniq on public.courier_partners (business_id, lower(name));
create trigger courier_partners_set_updated_at before update on public.courier_partners
  for each row execute function public.set_updated_at();

create table public.shipments (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references public.businesses (id) on delete cascade,
  outlet_id             uuid not null references public.outlets (id) on delete restrict,
  invoice_id            uuid references public.sales_invoices (id) on delete set null,
  customer_id           uuid references public.customers (id) on delete set null,
  -- Recipient snapshot.
  recipient_name        text not null check (length(trim(recipient_name)) > 0),
  recipient_phone       text,
  address_line1         text,
  address_line2         text,
  city                  text,
  pincode               text check (pincode is null or pincode ~ '^[1-9][0-9]{5}$'),
  state_code            text check (state_code is null or state_code ~ '^[0-9]{2}$'),
  courier_partner_id    uuid references public.courier_partners (id) on delete restrict,
  tracking_number       text,
  shipped_on            date not null default public.ist_today(),
  package_count         integer not null default 1 check (package_count > 0),
  weight_grams          integer check (weight_grams is null or weight_grams > 0),
  declared_value_paise  bigint check (declared_value_paise is null or declared_value_paise >= 0),
  receipt_photo_paths   text[] not null default '{}',
  status                text not null default 'booked'
                        check (status in ('booked', 'picked_up', 'in_transit', 'delivered', 'rto', 'cancelled')),
  -- Note for the most recent status change; copied into shipment_events by trigger.
  last_status_note      text,
  status_changed_at     timestamptz not null default now(),
  notes                 text,
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index shipments_business_status_idx on public.shipments (business_id, status, shipped_on desc);
create index shipments_outlet_idx on public.shipments (outlet_id);
create index shipments_tracking_idx on public.shipments (business_id, tracking_number) where tracking_number is not null;
create index shipments_phone_idx on public.shipments (business_id, recipient_phone) where recipient_phone is not null;
create index shipments_invoice_idx on public.shipments (invoice_id);
create index shipments_customer_idx on public.shipments (customer_id);
create index shipments_courier_idx on public.shipments (courier_partner_id);
create trigger shipments_set_updated_at before update on public.shipments
  for each row execute function public.set_updated_at();

create table public.shipment_events (
  id           uuid primary key default gen_random_uuid(),
  shipment_id  uuid not null references public.shipments (id) on delete cascade,
  business_id  uuid not null references public.businesses (id) on delete cascade,
  status       text not null,
  note         text,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index shipment_events_shipment_idx on public.shipment_events (shipment_id, created_at);
create index shipment_events_business_idx on public.shipment_events (business_id);

create or replace function public.guard_shipments()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    if new.business_id <> old.business_id then
      raise exception 'A shipment cannot be moved to another business';
    end if;
    if new.status is distinct from old.status then
      new.status_changed_at := now();
    end if;
  end if;

  if new.invoice_id is not null and not exists (
    select 1 from public.sales_invoices i where i.id = new.invoice_id and i.business_id = new.business_id
  ) then
    raise exception 'Invoice does not belong to this business';
  end if;
  if new.courier_partner_id is not null and not exists (
    select 1 from public.courier_partners c where c.id = new.courier_partner_id and c.business_id = new.business_id
  ) then
    raise exception 'Courier partner does not belong to this business';
  end if;
  if not exists (select 1 from public.outlets o where o.id = new.outlet_id and o.business_id = new.business_id) then
    raise exception 'Outlet does not belong to this business';
  end if;
  return new;
end;
$$;

create trigger shipments_guard before insert or update on public.shipments
  for each row execute function public.guard_shipments();

-- Every status change (and creation) becomes a timeline event.
create or replace function public.log_shipment_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.shipment_events (shipment_id, business_id, status, note, created_by)
    values (new.id, new.business_id, new.status,
            case when tg_op = 'INSERT' then 'Shipment created' else nullif(trim(coalesce(new.last_status_note, '')), '') end,
            coalesce(auth.uid(), new.created_by));
  end if;
  return new;
end;
$$;

create trigger shipments_log_event after insert or update on public.shipments
  for each row execute function public.log_shipment_event();

alter table public.courier_partners  enable row level security;
alter table public.shipments         enable row level security;
alter table public.shipment_events   enable row level security;

create policy courier_partners_select on public.courier_partners for select to authenticated
  using (public.is_member(business_id));
create policy courier_partners_write on public.courier_partners for all to authenticated
  using (public.has_perm(business_id, 'settings.manage'))
  with check (public.has_perm(business_id, 'settings.manage'));

create policy shipments_select on public.shipments for select to authenticated
  using (public.has_perm(business_id, 'shipments.view') and public.can_access_outlet(outlet_id));
create policy shipments_insert on public.shipments for insert to authenticated
  with check (public.has_perm(business_id, 'shipments.create') and public.can_access_outlet(outlet_id));
create policy shipments_update on public.shipments for update to authenticated
  using (public.has_perm(business_id, 'shipments.update') and public.can_access_outlet(outlet_id))
  with check (public.has_perm(business_id, 'shipments.update') and public.can_access_outlet(outlet_id));

create policy shipment_events_select on public.shipment_events for select to authenticated
  using (exists (select 1 from public.shipments s where s.id = shipment_id));
