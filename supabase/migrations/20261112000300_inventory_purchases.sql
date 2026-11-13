-- ════════════════════════════════════════════════════════════════════════════
-- EkDum · 03 · Inventory ledger and purchases
-- ════════════════════════════════════════════════════════════════════════════

-- ── Stock ledger ────────────────────────────────────────────────────────────
-- stock_movements is the source of truth and is append-only.
-- stock_levels is a running total maintained ONLY by the trigger below.

create table public.stock_movements (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  outlet_id       uuid not null references public.outlets (id) on delete restrict,
  product_id      uuid not null references public.products (id) on delete restrict,
  quantity_delta  numeric(12,3) not null check (quantity_delta <> 0),
  movement_type   text not null check (movement_type in (
                    'opening', 'purchase', 'sale', 'sale_return', 'adjustment', 'sale_cancel', 'purchase_cancel')),
  source_table    text,
  source_id       uuid,
  reason          text,
  note            text,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index stock_movements_product_idx on public.stock_movements (product_id, outlet_id, created_at desc);
create index stock_movements_business_created_idx on public.stock_movements (business_id, created_at desc);
create index stock_movements_outlet_idx on public.stock_movements (outlet_id);
create index stock_movements_source_idx on public.stock_movements (source_table, source_id);

create table public.stock_levels (
  product_id   uuid not null references public.products (id) on delete cascade,
  outlet_id    uuid not null references public.outlets (id) on delete cascade,
  business_id  uuid not null references public.businesses (id) on delete cascade,
  quantity     numeric(14,3) not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (product_id, outlet_id)
);

create index stock_levels_outlet_idx on public.stock_levels (outlet_id);
create index stock_levels_business_idx on public.stock_levels (business_id);

create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.products p where p.id = new.product_id and p.business_id = new.business_id
  ) or not exists (
    select 1 from public.outlets o where o.id = new.outlet_id and o.business_id = new.business_id
  ) then
    raise exception 'Stock movement product/outlet does not belong to the business';
  end if;

  insert into public.stock_levels as sl (product_id, outlet_id, business_id, quantity, updated_at)
  values (new.product_id, new.outlet_id, new.business_id, new.quantity_delta, now())
  on conflict (product_id, outlet_id)
  do update set quantity = sl.quantity + excluded.quantity, updated_at = now();
  return new;
end;
$$;

create trigger stock_movements_apply after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

create or replace function public.forbid_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Deleting a whole business (or product) is allowed to cascade.
  if tg_op = 'DELETE' and not exists (select 1 from public.businesses b where b.id = old.business_id) then
    return old;
  end if;
  raise exception '% rows are append-only and cannot be %', tg_table_name, lower(tg_op) || 'd';
end;
$$;

create trigger stock_movements_immutable before update or delete on public.stock_movements
  for each row execute function public.forbid_change();

-- Raise when a stock decrease would take the level below zero and the business forbids it.
create or replace function public.assert_stock_available(p_business_id uuid, p_outlet_id uuid, p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_qty numeric;
  v_name text;
begin
  if (select allow_negative_stock from public.businesses where id = p_business_id) then
    return;
  end if;
  select quantity into v_qty from public.stock_levels
  where product_id = p_product_id and outlet_id = p_outlet_id;
  if coalesce(v_qty, 0) < 0 then
    select name into v_name from public.products where id = p_product_id;
    raise exception 'Not enough stock for "%"', v_name using errcode = 'P0001', hint = 'insufficient_stock';
  end if;
end;
$$;

create or replace function public.set_opening_stock(p_product_id uuid, p_outlet_id uuid, p_quantity numeric)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product public.products;
begin
  select * into v_product from public.products where id = p_product_id;
  if not found
     or not public.has_perm(v_product.business_id, 'products.manage')
     or not public.can_access_outlet(p_outlet_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    return;
  end if;
  if exists (select 1 from public.stock_movements where product_id = p_product_id and outlet_id = p_outlet_id) then
    raise exception 'Opening stock can only be set before any other stock movement. Use a stock adjustment instead.';
  end if;

  insert into public.stock_movements (business_id, outlet_id, product_id, quantity_delta, movement_type,
                                      source_table, source_id, note, created_by)
  values (v_product.business_id, p_outlet_id, p_product_id, round(p_quantity, 3), 'opening',
          'products', p_product_id, 'Opening stock', auth.uid());
end;
$$;

create or replace function public.adjust_stock(
  p_outlet_id uuid,
  p_product_id uuid,
  p_quantity_delta numeric,
  p_reason text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product public.products;
  v_before numeric;
  v_movement uuid;
begin
  select * into v_product from public.products where id = p_product_id;
  if not found
     or not public.has_perm(v_product.business_id, 'inventory.adjust')
     or not public.can_access_outlet(p_outlet_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('damage', 'theft', 'recount', 'other') then
    raise exception 'A reason is required: damage, theft, recount or other';
  end if;
  if p_reason = 'other' and length(trim(coalesce(p_note, ''))) = 0 then
    raise exception 'Please add a note explaining the adjustment';
  end if;
  if p_quantity_delta is null or round(p_quantity_delta, 3) = 0 then
    raise exception 'Adjustment quantity cannot be zero';
  end if;
  if not v_product.track_inventory then
    raise exception 'Stock is not tracked for this product';
  end if;

  select coalesce(quantity, 0) into v_before from public.stock_levels
  where product_id = p_product_id and outlet_id = p_outlet_id;
  v_before := coalesce(v_before, 0);

  insert into public.stock_movements (business_id, outlet_id, product_id, quantity_delta, movement_type,
                                      source_table, reason, note, created_by)
  values (v_product.business_id, p_outlet_id, p_product_id, round(p_quantity_delta, 3), 'adjustment',
          'stock_adjustments', p_reason, nullif(trim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_movement;

  if p_quantity_delta < 0 then
    perform public.assert_stock_available(v_product.business_id, p_outlet_id, p_product_id);
  end if;

  perform public.write_audit(v_product.business_id, auth.uid(), 'stock.adjusted', 'stock_movements', v_movement,
    jsonb_build_object('quantity', v_before),
    jsonb_build_object('quantity', v_before + round(p_quantity_delta, 3), 'delta', round(p_quantity_delta, 3),
                       'reason', p_reason, 'note', p_note, 'product_id', p_product_id, 'outlet_id', p_outlet_id,
                       'product', v_product.name));
  return v_movement;
end;
$$;

-- ── Purchases ───────────────────────────────────────────────────────────────

create table public.purchase_bills (
  id                      uuid primary key default gen_random_uuid(),
  business_id             uuid not null references public.businesses (id) on delete cascade,
  outlet_id               uuid not null references public.outlets (id) on delete restrict,
  -- Nullable while a draft is being prepared (e.g. only the bill photo is attached so far).
  vendor_id               uuid references public.vendors (id) on delete restrict,
  vendor_invoice_number   text,
  vendor_invoice_date     date,
  financial_year          text,
  place_of_supply_state   text check (place_of_supply_state is null or place_of_supply_state ~ '^[0-9]{2}$'),
  is_inter_state          boolean not null default false,
  status                  text not null default 'draft' check (status in ('draft', 'posted', 'cancelled')),
  subtotal_paise          bigint not null default 0,
  discount_paise          bigint not null default 0,
  taxable_paise           bigint not null default 0,
  cgst_paise              bigint not null default 0,
  sgst_paise              bigint not null default 0,
  igst_paise              bigint not null default 0,
  cess_paise              bigint not null default 0,
  round_off_paise         bigint not null default 0,
  total_paise             bigint not null default 0 check (total_paise >= 0),
  amount_paid_paise       bigint not null default 0 check (amount_paid_paise >= 0),
  payment_status          text not null default 'unpaid' check (payment_status in ('unpaid', 'partial', 'paid')),
  attachment_paths        text[] not null default '{}',
  notes                   text,
  posted_at               timestamptz,
  posted_by               uuid references auth.users (id) on delete set null,
  cancelled_at            timestamptz,
  cancelled_by            uuid references auth.users (id) on delete set null,
  cancel_reason           text,
  created_by              uuid references auth.users (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint purchase_bills_totals_add_up check (
    total_paise = taxable_paise + cgst_paise + sgst_paise + igst_paise + cess_paise + round_off_paise
  )
);

-- A vendor's invoice number can be entered only once per financial year.
create unique index purchase_bills_vendor_invoice_uniq
  on public.purchase_bills (vendor_id, upper(vendor_invoice_number), financial_year)
  where status <> 'cancelled' and vendor_id is not null and vendor_invoice_number is not null;
create index purchase_bills_business_date_idx on public.purchase_bills (business_id, vendor_invoice_date desc);
create index purchase_bills_outlet_idx on public.purchase_bills (outlet_id);
create index purchase_bills_vendor_idx on public.purchase_bills (vendor_id);
create index purchase_bills_status_idx on public.purchase_bills (business_id, status);
create trigger purchase_bills_set_updated_at before update on public.purchase_bills
  for each row execute function public.set_updated_at();

create table public.purchase_bill_items (
  id                uuid primary key default gen_random_uuid(),
  purchase_bill_id  uuid not null references public.purchase_bills (id) on delete cascade,
  business_id       uuid not null references public.businesses (id) on delete cascade,
  line_no           integer not null default 1,
  product_id        uuid references public.products (id) on delete restrict,
  description       text not null,
  hsn_code          text,
  quantity          numeric(12,3) not null check (quantity > 0),
  unit_code         text not null default 'PCS' references public.units (code),
  rate_paise        bigint not null check (rate_paise >= 0),
  price_includes_tax boolean not null default false,
  discount_paise    bigint not null default 0 check (discount_paise >= 0),
  taxable_paise     bigint not null check (taxable_paise >= 0),
  gst_rate          numeric(5,2) not null default 0,
  cess_rate         numeric(5,2) not null default 0,
  cgst_paise        bigint not null default 0,
  sgst_paise        bigint not null default 0,
  igst_paise        bigint not null default 0,
  cess_paise        bigint not null default 0,
  total_paise       bigint not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint purchase_bill_items_total_adds_up check (
    total_paise = taxable_paise + cgst_paise + sgst_paise + igst_paise + cess_paise
  )
);

create index purchase_bill_items_bill_idx on public.purchase_bill_items (purchase_bill_id, line_no);
create index purchase_bill_items_product_idx on public.purchase_bill_items (product_id);
create index purchase_bill_items_business_idx on public.purchase_bill_items (business_id);

create table public.purchase_payments (
  id                uuid primary key default gen_random_uuid(),
  purchase_bill_id  uuid not null references public.purchase_bills (id) on delete cascade,
  business_id       uuid not null references public.businesses (id) on delete cascade,
  amount_paise      bigint not null check (amount_paise > 0),
  mode              text not null check (mode in ('cash', 'upi', 'card', 'bank_transfer', 'cheque')),
  paid_on           date not null default public.ist_today(),
  reference         text,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index purchase_payments_bill_idx on public.purchase_payments (purchase_bill_id);
create index purchase_payments_business_date_idx on public.purchase_payments (business_id, paid_on desc);

-- Posted and cancelled purchase bills are locked. Only the payment roll-up,
-- the cancellation fields and notes may change afterwards.
create or replace function public.guard_purchase_bills()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_mutable text[] := array['status', 'cancelled_at', 'cancelled_by', 'cancel_reason',
                            'amount_paid_paise', 'payment_status', 'notes', 'updated_at'];
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' and exists (select 1 from public.businesses b where b.id = old.business_id) then
      raise exception 'A % purchase bill cannot be deleted', old.status;
    end if;
    return old;
  end if;

  if old.status = 'cancelled' and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception 'A cancelled purchase bill cannot be changed';
  end if;
  if old.status = 'posted' then
    if (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
      raise exception 'A posted purchase bill cannot be edited. Cancel it and enter a new one.';
    end if;
    if new.status not in ('posted', 'cancelled') then
      raise exception 'A posted purchase bill cannot go back to draft';
    end if;
  end if;
  return new;
end;
$$;

create trigger purchase_bills_guard before update or delete on public.purchase_bills
  for each row execute function public.guard_purchase_bills();

create or replace function public.guard_purchase_bill_items()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_bill uuid := case when tg_op = 'DELETE' then old.purchase_bill_id else new.purchase_bill_id end;
begin
  select status into v_status from public.purchase_bills where id = v_bill;
  if v_status is not null and v_status <> 'draft' then
    raise exception 'Items of a % purchase bill cannot be changed', v_status;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger purchase_bill_items_guard before insert or update or delete on public.purchase_bill_items
  for each row execute function public.guard_purchase_bill_items();

-- Keep amount_paid_paise and payment_status in step with the payments table.
create or replace function public.sync_purchase_payment_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bill_id uuid := case when tg_op = 'DELETE' then old.purchase_bill_id else new.purchase_bill_id end;
  v_bill public.purchase_bills;
  v_paid bigint;
begin
  select * into v_bill from public.purchase_bills where id = v_bill_id for update;
  if not found then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if v_bill.status <> 'posted' then
      raise exception 'Payments can only be recorded against a posted purchase bill';
    end if;
    if new.business_id <> v_bill.business_id then
      raise exception 'Payment business does not match the bill';
    end if;
  end if;

  select coalesce(sum(amount_paise), 0) into v_paid from public.purchase_payments where purchase_bill_id = v_bill_id;
  if v_paid > v_bill.total_paise then
    raise exception 'Payments (%) cannot be more than the bill total (%)',
      to_char(v_paid / 100.0, 'FM999999999990.00'), to_char(v_bill.total_paise / 100.0, 'FM999999999990.00');
  end if;

  update public.purchase_bills
  set amount_paid_paise = v_paid,
      payment_status = case when v_paid <= 0 then 'unpaid'
                            when v_paid >= total_paise then 'paid'
                            else 'partial' end
  where id = v_bill_id;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger purchase_payments_sync after insert or delete on public.purchase_payments
  for each row execute function public.sync_purchase_payment_status();

create trigger purchase_payments_no_update before update on public.purchase_payments
  for each row execute function public.forbid_change();

-- Server-only. Creates or replaces a DRAFT purchase bill with its lines.
-- Totals are computed by the app's GST engine; this function re-checks that they add up.
create or replace function public.save_purchase_bill(p_actor uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business uuid := (p ->> 'business_id')::uuid;
  v_outlet uuid := (p ->> 'outlet_id')::uuid;
  v_bill_id uuid := nullif(p ->> 'id', '')::uuid;
  v_vendor uuid := nullif(p ->> 'vendor_id', '')::uuid;
  v_date date := nullif(p ->> 'vendor_invoice_date', '')::date;
  v_existing public.purchase_bills;
  v_item jsonb;
  v_line integer := 0;
  v_sum record;
begin
  if not public.has_perm_for(p_actor, v_business, 'purchases.create')
     or not public.can_access_outlet_for(p_actor, v_outlet) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.outlets where id = v_outlet and business_id = v_business) then
    raise exception 'Outlet does not belong to this business';
  end if;
  if v_vendor is not null and not exists (select 1 from public.vendors where id = v_vendor and business_id = v_business) then
    raise exception 'Vendor does not belong to this business';
  end if;
  if v_date is not null and v_date > public.ist_today() then
    raise exception 'The bill date cannot be in the future';
  end if;

  if v_bill_id is not null then
    select * into v_existing from public.purchase_bills where id = v_bill_id for update;
    if not found or v_existing.business_id <> v_business then
      raise exception 'Purchase bill not found';
    end if;
    if v_existing.status <> 'draft' then
      raise exception 'Only draft purchase bills can be edited';
    end if;

    update public.purchase_bills set
      outlet_id = v_outlet,
      vendor_id = v_vendor,
      vendor_invoice_number = nullif(trim(coalesce(p ->> 'vendor_invoice_number', '')), ''),
      vendor_invoice_date = v_date,
      financial_year = case when v_date is null then null else public.financial_year(v_date) end,
      place_of_supply_state = nullif(p ->> 'place_of_supply_state', ''),
      is_inter_state = coalesce((p ->> 'is_inter_state')::boolean, false),
      subtotal_paise = coalesce((p ->> 'subtotal_paise')::bigint, 0),
      discount_paise = coalesce((p ->> 'discount_paise')::bigint, 0),
      taxable_paise = coalesce((p ->> 'taxable_paise')::bigint, 0),
      cgst_paise = coalesce((p ->> 'cgst_paise')::bigint, 0),
      sgst_paise = coalesce((p ->> 'sgst_paise')::bigint, 0),
      igst_paise = coalesce((p ->> 'igst_paise')::bigint, 0),
      cess_paise = coalesce((p ->> 'cess_paise')::bigint, 0),
      round_off_paise = coalesce((p ->> 'round_off_paise')::bigint, 0),
      total_paise = coalesce((p ->> 'total_paise')::bigint, 0),
      attachment_paths = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p -> 'attachment_paths', '[]'::jsonb)) x), '{}'),
      notes = nullif(trim(coalesce(p ->> 'notes', '')), '')
    where id = v_bill_id;

    delete from public.purchase_bill_items where purchase_bill_id = v_bill_id;
  else
    insert into public.purchase_bills (
      business_id, outlet_id, vendor_id, vendor_invoice_number, vendor_invoice_date, financial_year,
      place_of_supply_state, is_inter_state, status,
      subtotal_paise, discount_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, cess_paise,
      round_off_paise, total_paise, attachment_paths, notes, created_by
    ) values (
      v_business, v_outlet, v_vendor,
      nullif(trim(coalesce(p ->> 'vendor_invoice_number', '')), ''),
      v_date,
      case when v_date is null then null else public.financial_year(v_date) end,
      nullif(p ->> 'place_of_supply_state', ''),
      coalesce((p ->> 'is_inter_state')::boolean, false),
      'draft',
      coalesce((p ->> 'subtotal_paise')::bigint, 0),
      coalesce((p ->> 'discount_paise')::bigint, 0),
      coalesce((p ->> 'taxable_paise')::bigint, 0),
      coalesce((p ->> 'cgst_paise')::bigint, 0),
      coalesce((p ->> 'sgst_paise')::bigint, 0),
      coalesce((p ->> 'igst_paise')::bigint, 0),
      coalesce((p ->> 'cess_paise')::bigint, 0),
      coalesce((p ->> 'round_off_paise')::bigint, 0),
      coalesce((p ->> 'total_paise')::bigint, 0),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p -> 'attachment_paths', '[]'::jsonb)) x), '{}'),
      nullif(trim(coalesce(p ->> 'notes', '')), ''),
      p_actor
    ) returning id into v_bill_id;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) loop
    v_line := v_line + 1;
    if nullif(v_item ->> 'product_id', '') is not null and not exists (
      select 1 from public.products where id = (v_item ->> 'product_id')::uuid and business_id = v_business
    ) then
      raise exception 'Line %: product does not belong to this business', v_line;
    end if;

    insert into public.purchase_bill_items (
      purchase_bill_id, business_id, line_no, product_id, description, hsn_code, quantity, unit_code,
      rate_paise, price_includes_tax, discount_paise, taxable_paise, gst_rate, cess_rate,
      cgst_paise, sgst_paise, igst_paise, cess_paise, total_paise
    ) values (
      v_bill_id, v_business, v_line,
      nullif(v_item ->> 'product_id', '')::uuid,
      v_item ->> 'description',
      nullif(v_item ->> 'hsn_code', ''),
      (v_item ->> 'quantity')::numeric,
      coalesce(nullif(v_item ->> 'unit_code', ''), 'PCS'),
      (v_item ->> 'rate_paise')::bigint,
      coalesce((v_item ->> 'price_includes_tax')::boolean, false),
      coalesce((v_item ->> 'discount_paise')::bigint, 0),
      (v_item ->> 'taxable_paise')::bigint,
      coalesce((v_item ->> 'gst_rate')::numeric, 0),
      coalesce((v_item ->> 'cess_rate')::numeric, 0),
      coalesce((v_item ->> 'cgst_paise')::bigint, 0),
      coalesce((v_item ->> 'sgst_paise')::bigint, 0),
      coalesce((v_item ->> 'igst_paise')::bigint, 0),
      coalesce((v_item ->> 'cess_paise')::bigint, 0),
      (v_item ->> 'total_paise')::bigint
    );
  end loop;

  select coalesce(sum(taxable_paise), 0) as taxable, coalesce(sum(cgst_paise), 0) as cgst,
         coalesce(sum(sgst_paise), 0) as sgst, coalesce(sum(igst_paise), 0) as igst,
         coalesce(sum(cess_paise), 0) as cess
  into v_sum from public.purchase_bill_items where purchase_bill_id = v_bill_id;

  if not exists (
    select 1 from public.purchase_bills b
    where b.id = v_bill_id and b.taxable_paise = v_sum.taxable and b.cgst_paise = v_sum.cgst
      and b.sgst_paise = v_sum.sgst and b.igst_paise = v_sum.igst and b.cess_paise = v_sum.cess
  ) then
    raise exception 'Purchase bill totals do not match its lines';
  end if;

  return v_bill_id;
end;
$$;

create or replace function public.post_purchase_bill(p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_bill public.purchase_bills;
  v_item record;
begin
  select * into v_bill from public.purchase_bills where id = p_bill_id for update;
  if not found
     or not public.has_perm(v_bill.business_id, 'purchases.post')
     or not public.can_access_outlet(v_bill.outlet_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_bill.status <> 'draft' then
    raise exception 'This purchase bill is already %', v_bill.status;
  end if;
  if v_bill.vendor_id is null then
    raise exception 'Select a vendor before posting';
  end if;
  if v_bill.vendor_invoice_number is null or v_bill.vendor_invoice_date is null then
    raise exception 'Enter the vendor''s invoice number and date before posting';
  end if;
  if not exists (select 1 from public.purchase_bill_items where purchase_bill_id = p_bill_id) then
    raise exception 'Add at least one item before posting';
  end if;

  for v_item in
    select i.*, p.track_inventory
    from public.purchase_bill_items i
    join public.products p on p.id = i.product_id
    where i.purchase_bill_id = p_bill_id
    order by i.line_no
  loop
    if v_item.track_inventory then
      insert into public.stock_movements (business_id, outlet_id, product_id, quantity_delta, movement_type,
                                          source_table, source_id, note, created_by)
      values (v_bill.business_id, v_bill.outlet_id, v_item.product_id, v_item.quantity, 'purchase',
              'purchase_bills', p_bill_id, 'Purchase ' || v_bill.vendor_invoice_number, v_actor);
    end if;

    -- Remember the latest landed cost per unit (before tax).
    insert into public.product_costs as pc (product_id, business_id, purchase_price_paise, updated_by)
    values (v_item.product_id, v_bill.business_id, round(v_item.taxable_paise / v_item.quantity)::bigint, v_actor)
    on conflict (product_id) do update
      set purchase_price_paise = excluded.purchase_price_paise, updated_by = excluded.updated_by;
  end loop;

  update public.purchase_bills
  set status = 'posted', posted_at = now(), posted_by = v_actor
  where id = p_bill_id;

  perform public.write_audit(v_bill.business_id, v_actor, 'purchase.posted', 'purchase_bills', p_bill_id, null,
    jsonb_build_object('vendor_invoice_number', v_bill.vendor_invoice_number, 'total_paise', v_bill.total_paise));
end;
$$;

create or replace function public.cancel_purchase_bill(p_bill_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_bill public.purchase_bills;
  v_move record;
begin
  select * into v_bill from public.purchase_bills where id = p_bill_id for update;
  if not found or not public.can_access_outlet(v_bill.outlet_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_bill.status = 'cancelled' then
    raise exception 'This purchase bill is already cancelled';
  end if;

  if v_bill.status = 'draft' then
    if not public.has_perm(v_bill.business_id, 'purchases.create') then
      raise exception 'Not allowed' using errcode = '42501';
    end if;
    delete from public.purchase_bills where id = p_bill_id;
    return;
  end if;

  if not public.has_perm(v_bill.business_id, 'purchases.post') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required to cancel a posted purchase bill';
  end if;
  if v_bill.amount_paid_paise > 0 then
    raise exception 'Remove the recorded payments before cancelling this bill';
  end if;

  for v_move in
    select product_id, sum(quantity_delta) as qty
    from public.stock_movements
    where source_table = 'purchase_bills' and source_id = p_bill_id and movement_type = 'purchase'
    group by product_id
  loop
    insert into public.stock_movements (business_id, outlet_id, product_id, quantity_delta, movement_type,
                                        source_table, source_id, note, created_by)
    values (v_bill.business_id, v_bill.outlet_id, v_move.product_id, -v_move.qty, 'purchase_cancel',
            'purchase_bills', p_bill_id, 'Purchase cancelled: ' || trim(p_reason), v_actor);
    perform public.assert_stock_available(v_bill.business_id, v_bill.outlet_id, v_move.product_id);
  end loop;

  update public.purchase_bills
  set status = 'cancelled', cancelled_at = now(), cancelled_by = v_actor, cancel_reason = trim(p_reason)
  where id = p_bill_id;

  perform public.write_audit(v_bill.business_id, v_actor, 'purchase.cancelled', 'purchase_bills', p_bill_id,
    jsonb_build_object('status', 'posted'),
    jsonb_build_object('status', 'cancelled', 'reason', trim(p_reason)));
end;
$$;

-- ── Row Level Security ──────────────────────────────────────────────────────

alter table public.stock_movements      enable row level security;
alter table public.stock_levels         enable row level security;
alter table public.purchase_bills       enable row level security;
alter table public.purchase_bill_items  enable row level security;
alter table public.purchase_payments    enable row level security;

-- Stock is read-only through the API; every write goes through an RPC.
create policy stock_movements_select on public.stock_movements for select to authenticated
  using (public.has_perm(business_id, 'inventory.view') and public.can_access_outlet(outlet_id));
create policy stock_levels_select on public.stock_levels for select to authenticated
  using (public.has_perm(business_id, 'inventory.view') and public.can_access_outlet(outlet_id));

create policy purchase_bills_select on public.purchase_bills for select to authenticated
  using (public.has_perm(business_id, 'purchases.view') and public.can_access_outlet(outlet_id));

create policy purchase_bill_items_select on public.purchase_bill_items for select to authenticated
  using (exists (select 1 from public.purchase_bills b where b.id = purchase_bill_id));

create policy purchase_payments_select on public.purchase_payments for select to authenticated
  using (exists (select 1 from public.purchase_bills b where b.id = purchase_bill_id));
create policy purchase_payments_insert on public.purchase_payments for insert to authenticated
  with check (
    public.has_perm(business_id, 'purchases.create')
    and exists (select 1 from public.purchase_bills b where b.id = purchase_bill_id and b.business_id = purchase_payments.business_id)
  );
create policy purchase_payments_delete on public.purchase_payments for delete to authenticated
  using (public.has_perm(business_id, 'purchases.post'));
