-- ════════════════════════════════════════════════════════════════════════════
-- EkDum · 05 · POS devices, invoice series, sales invoices, credit notes
-- ════════════════════════════════════════════════════════════════════════════

-- ── POS devices and numbering series ────────────────────────────────────────

create table public.pos_devices (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses (id) on delete cascade,
  outlet_id        uuid not null references public.outlets (id) on delete restrict,
  name             text not null check (length(trim(name)) > 0),
  -- SHA-256 of the secret kept on the device. The secret itself is never stored.
  device_key_hash  text not null unique,
  last_seen_at     timestamptz,
  is_active        boolean not null default true,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index pos_devices_business_idx on public.pos_devices (business_id);
create index pos_devices_outlet_idx on public.pos_devices (outlet_id);
create trigger pos_devices_set_updated_at before update on public.pos_devices
  for each row execute function public.set_updated_at();

create table public.invoice_series (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  outlet_id       uuid not null references public.outlets (id) on delete restrict,
  -- Null → numbers are allocated by the server. Set → only that POS device issues them.
  pos_device_id   uuid references public.pos_devices (id) on delete restrict,
  document_type   text not null check (document_type in ('invoice', 'credit_note')),
  prefix          text not null check (prefix ~ '^[A-Z0-9]([A-Z0-9-]{0,2}[A-Z0-9])?$'),
  financial_year  text not null check (financial_year ~ '^[0-9]{4}$'),
  next_number     bigint not null default 1 check (next_number >= 1),
  is_active       boolean not null default true,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- A prefix identifies exactly one series per year, so two series can never issue the same number.
  unique (business_id, prefix, financial_year)
);

create unique index invoice_series_server_uniq
  on public.invoice_series (outlet_id, document_type, financial_year)
  where pos_device_id is null and is_active;
create unique index invoice_series_device_uniq
  on public.invoice_series (pos_device_id, document_type, financial_year)
  where pos_device_id is not null;
create index invoice_series_business_idx on public.invoice_series (business_id);
create trigger invoice_series_set_updated_at before update on public.invoice_series
  for each row execute function public.set_updated_at();

-- Numbers already issued can never be handed out again.
create or replace function public.guard_invoice_series()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.next_number < old.next_number then
    raise exception 'The next number of a series cannot be moved backwards';
  end if;
  if old.next_number > 1 and (new.prefix <> old.prefix or new.financial_year <> old.financial_year
      or new.document_type <> old.document_type) then
    raise exception 'A series that has already issued numbers cannot be changed. Create a new series instead.';
  end if;
  if new.business_id <> old.business_id then
    raise exception 'A series cannot be moved to another business';
  end if;
  return new;
end;
$$;

create trigger invoice_series_guard before update on public.invoice_series
  for each row execute function public.guard_invoice_series();

-- {PREFIX}/{FY}/{SEQ padded to 5}. Rule 46(b): at most 16 characters.
create or replace function public.format_document_number(p_prefix text, p_fy text, p_seq bigint)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  -- lpad() truncates longer input, so pad to at least 5 digits, never fewer than the number has.
  v_number text := p_prefix || '/' || p_fy || '/' || lpad(p_seq::text, greatest(5, length(p_seq::text)), '0');
begin
  if length(v_number) > 16 then
    raise exception 'Invoice number % is longer than 16 characters. Start a new series with a shorter prefix.', v_number;
  end if;
  return v_number;
end;
$$;

-- Finds (and row-locks) the series for a financial year, rolling it over from
-- last year's series when the year changes.
create or replace function public.lock_series(
  p_business_id uuid,
  p_outlet_id uuid,
  p_device_id uuid,
  p_document_type text,
  p_fy text
)
returns public.invoice_series
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_series public.invoice_series;
  v_previous public.invoice_series;
begin
  select * into v_series from public.invoice_series s
  where s.business_id = p_business_id and s.outlet_id = p_outlet_id and s.document_type = p_document_type
    and s.financial_year = p_fy and s.is_active
    and s.pos_device_id is not distinct from p_device_id
  for update;
  if found then
    return v_series;
  end if;

  select * into v_previous from public.invoice_series s
  where s.business_id = p_business_id and s.outlet_id = p_outlet_id and s.document_type = p_document_type
    and s.is_active and s.pos_device_id is not distinct from p_device_id
  order by s.financial_year desc
  limit 1;
  if not found then
    raise exception 'No % number series is set up for this %',
      case when p_document_type = 'invoice' then 'invoice' else 'credit note' end,
      case when p_device_id is null then 'outlet' else 'POS device' end
      using hint = 'series_missing';
  end if;

  insert into public.invoice_series (business_id, outlet_id, pos_device_id, document_type, prefix,
                                     financial_year, next_number, is_active, created_by)
  values (p_business_id, p_outlet_id, p_device_id, p_document_type, v_previous.prefix, p_fy, 1, true, v_previous.created_by)
  on conflict do nothing;

  select * into v_series from public.invoice_series s
  where s.business_id = p_business_id and s.outlet_id = p_outlet_id and s.document_type = p_document_type
    and s.financial_year = p_fy and s.is_active
    and s.pos_device_id is not distinct from p_device_id
  for update;
  if not found then
    raise exception 'Could not start the % series for financial year %', v_previous.prefix, p_fy;
  end if;
  return v_series;
end;
$$;

-- Registers the calling browser/tablet as a POS device with its own invoice series.
create or replace function public.register_pos_device(
  p_outlet_id uuid,
  p_name text,
  p_prefix text,
  p_device_key_hash text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_outlet public.outlets;
  v_device uuid;
  v_prefix text := upper(trim(p_prefix));
begin
  select * into v_outlet from public.outlets where id = p_outlet_id;
  if not found or not public.has_perm(v_outlet.business_id, 'settings.manage') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if length(coalesce(p_device_key_hash, '')) < 32 then
    raise exception 'Invalid device key';
  end if;
  if exists (select 1 from public.invoice_series where business_id = v_outlet.business_id and prefix = v_prefix) then
    raise exception 'The prefix % is already used by another series', v_prefix;
  end if;

  insert into public.pos_devices (business_id, outlet_id, name, device_key_hash, created_by, last_seen_at)
  values (v_outlet.business_id, p_outlet_id, trim(p_name), p_device_key_hash, auth.uid(), now())
  returning id into v_device;

  insert into public.invoice_series (business_id, outlet_id, pos_device_id, document_type, prefix,
                                     financial_year, next_number, created_by)
  values (v_outlet.business_id, p_outlet_id, v_device, 'invoice', v_prefix,
          public.financial_year(public.ist_today()), 1, auth.uid());

  perform public.write_audit(v_outlet.business_id, auth.uid(), 'device.registered', 'pos_devices', v_device, null,
    jsonb_build_object('name', trim(p_name), 'prefix', v_prefix, 'outlet_id', p_outlet_id));
  return v_device;
end;
$$;

-- ── Sales invoices ──────────────────────────────────────────────────────────

create table public.sales_invoices (
  id                        uuid primary key default gen_random_uuid(),
  business_id               uuid not null references public.businesses (id) on delete cascade,
  outlet_id                 uuid not null references public.outlets (id) on delete restrict,
  series_id                 uuid not null references public.invoice_series (id) on delete restrict,
  pos_device_id             uuid references public.pos_devices (id) on delete restrict,
  invoice_number            text not null check (length(invoice_number) <= 16 and invoice_number ~ '^[A-Z0-9/-]+$'),
  financial_year            text not null,
  document_type             text not null check (document_type in ('tax_invoice', 'bill_of_supply', 'cash_memo')),
  invoice_date              date not null,
  -- Seller snapshot (the GSTIN under which this number is unique).
  seller_gstin              text,
  seller_state_code         text not null,
  -- Customer snapshot: a posted invoice never changes when the customer record does.
  customer_id               uuid references public.customers (id) on delete set null,
  customer_name             text,
  customer_phone            text,
  customer_email            text,
  customer_gstin            text,
  customer_address          text,
  customer_pincode          text,
  customer_state_code       text,
  supply_type               text not null default 'b2c' check (supply_type in ('b2b', 'b2c')),
  place_of_supply_state     text not null check (place_of_supply_state ~ '^[0-9]{2}$'),
  pos_override_reason       text,
  is_inter_state            boolean not null default false,
  reverse_charge            boolean not null default false,
  subtotal_paise            bigint not null check (subtotal_paise >= 0),
  discount_paise            bigint not null default 0 check (discount_paise >= 0),
  taxable_paise             bigint not null check (taxable_paise >= 0),
  cgst_paise                bigint not null default 0 check (cgst_paise >= 0),
  sgst_paise                bigint not null default 0 check (sgst_paise >= 0),
  igst_paise                bigint not null default 0 check (igst_paise >= 0),
  cess_paise                bigint not null default 0 check (cess_paise >= 0),
  round_off_paise           bigint not null default 0 check (round_off_paise between -99 and 99),
  total_paise               bigint not null check (total_paise >= 0),
  -- Outstanding "credit" (udhaar) still to be collected from the customer.
  amount_due_paise          bigint not null default 0 check (amount_due_paise >= 0),
  amount_in_words           text not null,
  notes                     text,
  status                    text not null default 'posted' check (status in ('posted', 'cancelled')),
  cancelled_at              timestamptz,
  cancelled_by              uuid references auth.users (id) on delete set null,
  cancel_reason             text,
  public_token              text not null unique default public.random_token(),
  public_token_revoked_at   timestamptz,
  -- Idempotency key generated on the client; makes offline sync safe to retry.
  client_uuid               uuid not null unique,
  source                    text not null check (source in ('pos_online', 'pos_offline', 'back_office')),
  created_by                uuid references auth.users (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint sales_invoices_totals_add_up check (
    total_paise = taxable_paise + cgst_paise + sgst_paise + igst_paise + cess_paise + round_off_paise
  ),
  constraint sales_invoices_tax_split check (
    (is_inter_state and cgst_paise = 0 and sgst_paise = 0) or (not is_inter_state and igst_paise = 0)
  ),
  constraint sales_invoices_no_tax_unless_tax_invoice check (
    document_type = 'tax_invoice' or (cgst_paise = 0 and sgst_paise = 0 and igst_paise = 0 and cess_paise = 0)
  ),
  constraint sales_invoices_b2b_needs_gstin check (supply_type = 'b2c' or customer_gstin is not null)
);

-- Rule 46(b): the number is unique within a financial year for the supplier's GSTIN.
create unique index sales_invoices_number_uniq
  on public.sales_invoices (business_id, coalesce(seller_gstin, ''), financial_year, invoice_number);
create index sales_invoices_business_date_idx on public.sales_invoices (business_id, invoice_date desc, created_at desc);
create index sales_invoices_outlet_date_idx on public.sales_invoices (outlet_id, invoice_date desc);
create index sales_invoices_customer_idx on public.sales_invoices (customer_id);
create index sales_invoices_phone_idx on public.sales_invoices (business_id, customer_phone) where customer_phone is not null;
create index sales_invoices_created_by_idx on public.sales_invoices (created_by, invoice_date desc);
create index sales_invoices_series_idx on public.sales_invoices (series_id);
create index sales_invoices_device_idx on public.sales_invoices (pos_device_id);
create index sales_invoices_due_idx on public.sales_invoices (business_id) where amount_due_paise > 0;
create trigger sales_invoices_set_updated_at before update on public.sales_invoices
  for each row execute function public.set_updated_at();

create table public.sales_invoice_items (
  id                  uuid primary key default gen_random_uuid(),
  invoice_id          uuid not null references public.sales_invoices (id) on delete cascade,
  business_id         uuid not null references public.businesses (id) on delete cascade,
  line_no             integer not null,
  product_id          uuid references public.products (id) on delete restrict,
  description         text not null,
  hsn_code            text,
  quantity            numeric(12,3) not null check (quantity > 0),
  unit_code           text not null default 'PCS',
  unit_price_paise    bigint not null check (unit_price_paise >= 0),
  price_includes_tax  boolean not null default true,
  discount_paise      bigint not null default 0 check (discount_paise >= 0),
  taxable_paise       bigint not null check (taxable_paise >= 0),
  gst_rate            numeric(5,2) not null default 0,
  cess_rate           numeric(5,2) not null default 0,
  cgst_paise          bigint not null default 0 check (cgst_paise >= 0),
  sgst_paise          bigint not null default 0 check (sgst_paise >= 0),
  igst_paise          bigint not null default 0 check (igst_paise >= 0),
  cess_paise          bigint not null default 0 check (cess_paise >= 0),
  total_paise         bigint not null check (total_paise >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (invoice_id, line_no),
  constraint sales_invoice_items_total_adds_up check (
    total_paise = taxable_paise + cgst_paise + sgst_paise + igst_paise + cess_paise
  )
);

create index sales_invoice_items_product_idx on public.sales_invoice_items (product_id);
create index sales_invoice_items_business_idx on public.sales_invoice_items (business_id);

create table public.sales_payments (
  id             uuid primary key default gen_random_uuid(),
  invoice_id     uuid not null references public.sales_invoices (id) on delete cascade,
  business_id    uuid not null references public.businesses (id) on delete cascade,
  mode           text not null check (mode in ('cash', 'upi', 'card', 'bank_transfer', 'credit')),
  amount_paise   bigint not null check (amount_paise > 0),
  reference      text,
  -- False: taken when the bill was made. True: collected later against a credit sale.
  is_collection  boolean not null default false,
  received_on    date not null default public.ist_today(),
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint sales_payments_collection_not_credit check (not (is_collection and mode = 'credit'))
);

create index sales_payments_invoice_idx on public.sales_payments (invoice_id);
create index sales_payments_business_date_idx on public.sales_payments (business_id, received_on desc);

-- ── Credit notes ────────────────────────────────────────────────────────────

create table public.credit_notes (
  id                         uuid primary key default gen_random_uuid(),
  business_id                uuid not null references public.businesses (id) on delete cascade,
  outlet_id                  uuid not null references public.outlets (id) on delete restrict,
  invoice_id                 uuid not null references public.sales_invoices (id) on delete restrict,
  series_id                  uuid not null references public.invoice_series (id) on delete restrict,
  credit_note_number         text not null check (length(credit_note_number) <= 16),
  financial_year             text not null,
  credit_note_date           date not null,
  seller_gstin               text,
  reason                     text not null check (length(trim(reason)) > 0),
  restock                    boolean not null default false,
  is_inter_state             boolean not null default false,
  taxable_paise              bigint not null check (taxable_paise >= 0),
  cgst_paise                 bigint not null default 0,
  sgst_paise                 bigint not null default 0,
  igst_paise                 bigint not null default 0,
  cess_paise                 bigint not null default 0,
  round_off_paise            bigint not null default 0,
  total_paise                bigint not null check (total_paise >= 0),
  -- How the customer got the value back.
  adjusted_against_due_paise bigint not null default 0 check (adjusted_against_due_paise >= 0),
  refund_paise               bigint not null default 0 check (refund_paise >= 0),
  refund_mode                text check (refund_mode is null or refund_mode in ('cash', 'upi', 'card', 'bank_transfer')),
  created_by                 uuid references auth.users (id) on delete set null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint credit_notes_totals_add_up check (
    total_paise = taxable_paise + cgst_paise + sgst_paise + igst_paise + cess_paise + round_off_paise
  ),
  constraint credit_notes_settlement_adds_up check (total_paise = adjusted_against_due_paise + refund_paise)
);

create unique index credit_notes_number_uniq
  on public.credit_notes (business_id, coalesce(seller_gstin, ''), financial_year, credit_note_number);
create index credit_notes_invoice_idx on public.credit_notes (invoice_id);
create index credit_notes_business_date_idx on public.credit_notes (business_id, credit_note_date desc);
create index credit_notes_outlet_idx on public.credit_notes (outlet_id);
create index credit_notes_series_idx on public.credit_notes (series_id);

create table public.credit_note_items (
  id                uuid primary key default gen_random_uuid(),
  credit_note_id    uuid not null references public.credit_notes (id) on delete cascade,
  business_id       uuid not null references public.businesses (id) on delete cascade,
  invoice_item_id   uuid not null references public.sales_invoice_items (id) on delete restrict,
  line_no           integer not null,
  product_id        uuid references public.products (id) on delete restrict,
  description       text not null,
  hsn_code          text,
  quantity          numeric(12,3) not null check (quantity > 0),
  unit_code         text not null,
  unit_price_paise  bigint not null,
  taxable_paise     bigint not null check (taxable_paise >= 0),
  gst_rate          numeric(5,2) not null default 0,
  cess_rate         numeric(5,2) not null default 0,
  cgst_paise        bigint not null default 0,
  sgst_paise        bigint not null default 0,
  igst_paise        bigint not null default 0,
  cess_paise        bigint not null default 0,
  total_paise       bigint not null check (total_paise >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index credit_note_items_note_idx on public.credit_note_items (credit_note_id, line_no);
create index credit_note_items_invoice_item_idx on public.credit_note_items (invoice_item_id);
create index credit_note_items_product_idx on public.credit_note_items (product_id);
create index credit_note_items_business_idx on public.credit_note_items (business_id);

-- ── Immutability of posted financial documents ──────────────────────────────

create or replace function public.guard_sales_invoices()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_mutable text[] := array['status', 'cancelled_at', 'cancelled_by', 'cancel_reason',
                            'public_token_revoked_at', 'amount_due_paise', 'updated_at'];
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.businesses b where b.id = old.business_id) then
      raise exception 'Invoices cannot be deleted. Cancel the invoice or issue a credit note.';
    end if;
    return old;
  end if;

  -- Deleting a customer unlinks their bills (FK on delete set null). The bill keeps
  -- its own snapshot of the customer's details, so nothing printed changes.
  if new.customer_id is null and old.customer_id is not null then
    old.customer_id := null;
  end if;
  if (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
    raise exception 'A posted invoice cannot be edited. Cancel it or issue a credit note.';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'A cancelled invoice cannot be restored';
  end if;
  return new;
end;
$$;

create trigger sales_invoices_guard before update or delete on public.sales_invoices
  for each row execute function public.guard_sales_invoices();

create trigger sales_invoice_items_immutable before update or delete on public.sales_invoice_items
  for each row execute function public.forbid_change();
create trigger sales_payments_immutable before update or delete on public.sales_payments
  for each row execute function public.forbid_change();
create trigger credit_notes_immutable before update or delete on public.credit_notes
  for each row execute function public.forbid_change();
create trigger credit_note_items_immutable before update or delete on public.credit_note_items
  for each row execute function public.forbid_change();

-- ── Notifications for an invoice ────────────────────────────────────────────

create or replace function public.queue_invoice_notification(
  p_invoice_id uuid,
  p_channel text,
  p_recipient text,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv public.sales_invoices;
  v_job uuid;
begin
  select * into v_inv from public.sales_invoices where id = p_invoice_id;
  if not found or length(trim(coalesce(p_recipient, ''))) = 0 then
    return null;
  end if;

  insert into public.notification_jobs (business_id, channel, template, recipient, payload,
                                        related_table, related_id, created_by)
  values (
    v_inv.business_id, p_channel, 'invoice_receipt', trim(p_recipient),
    jsonb_build_object(
      'invoice_id', v_inv.id,
      'invoice_number', v_inv.invoice_number,
      'customer_name', v_inv.customer_name,
      'total_paise', v_inv.total_paise
    ),
    'sales_invoices', v_inv.id, p_actor
  ) returning id into v_job;
  return v_job;
end;
$$;

-- Manual "send receipt" from the invoice page.
create or replace function public.send_invoice_notification(p_invoice_id uuid, p_channel text, p_recipient text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv public.sales_invoices;
  v_recipient text;
  v_opted_in boolean;
begin
  select * into v_inv from public.sales_invoices where id = p_invoice_id;
  if not found
     or not public.can_access_outlet(v_inv.outlet_id)
     or not (public.has_perm(v_inv.business_id, 'sales.view_all')
             or (public.has_perm(v_inv.business_id, 'sales.view_own') and v_inv.created_by = auth.uid())) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_channel not in ('email', 'whatsapp') then
    raise exception 'Unknown channel';
  end if;
  if v_inv.status = 'cancelled' then
    raise exception 'This invoice is cancelled';
  end if;

  if p_channel = 'email' then
    v_recipient := coalesce(nullif(trim(coalesce(p_recipient, '')), ''), v_inv.customer_email);
    if v_recipient is null or position('@' in v_recipient) < 2 then
      raise exception 'Enter an email address to send the receipt to';
    end if;
  else
    -- WhatsApp is only ever sent to the customer on the bill, and only with consent.
    v_recipient := v_inv.customer_phone;
    select whatsapp_opt_in into v_opted_in from public.customers where id = v_inv.customer_id;
    if v_recipient is null then
      raise exception 'This bill has no customer phone number';
    end if;
    if not coalesce(v_opted_in, false) then
      raise exception 'The customer has not opted in to WhatsApp messages';
    end if;
  end if;

  return public.queue_invoice_notification(p_invoice_id, p_channel, v_recipient, auth.uid());
end;
$$;

-- ── Posting an invoice ──────────────────────────────────────────────────────
-- Server-only (service role). The app server recomputes every amount with the
-- shared GST engine before calling this; the function then, in ONE transaction:
-- checks permissions → allocates/validates the number → inserts invoice, lines
-- and payments → writes stock movements → queues notifications → writes audit rows.

create or replace function public.post_sales_invoice(p_actor uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business_id uuid := (p ->> 'business_id')::uuid;
  v_outlet_id uuid := (p ->> 'outlet_id')::uuid;
  v_client_uuid uuid := (p ->> 'client_uuid')::uuid;
  v_source text := p ->> 'source';
  v_device_id uuid := nullif(p ->> 'device_id', '')::uuid;
  v_offline boolean := (p ->> 'source') = 'pos_offline';
  v_doc_type text := p ->> 'document_type';
  v_supply_type text := coalesce(p ->> 'supply_type', 'b2c');
  v_customer_id uuid := nullif(p ->> 'customer_id', '')::uuid;
  v_cust jsonb := coalesce(p -> 'customer', '{}'::jsonb);
  v_pos_state text := p ->> 'place_of_supply_state';
  v_inter boolean := coalesce((p ->> 'is_inter_state')::boolean, false);
  v_subtotal bigint := (p ->> 'subtotal_paise')::bigint;
  v_discount bigint := coalesce((p ->> 'discount_paise')::bigint, 0);
  v_taxable bigint := (p ->> 'taxable_paise')::bigint;
  v_cgst bigint := coalesce((p ->> 'cgst_paise')::bigint, 0);
  v_sgst bigint := coalesce((p ->> 'sgst_paise')::bigint, 0);
  v_igst bigint := coalesce((p ->> 'igst_paise')::bigint, 0);
  v_cess bigint := coalesce((p ->> 'cess_paise')::bigint, 0);
  v_round_off bigint := coalesce((p ->> 'round_off_paise')::bigint, 0);
  v_total bigint := (p ->> 'total_paise')::bigint;
  v_today date := public.ist_today();
  v_date date;
  v_fy text;
  v_business public.businesses;
  v_outlet public.outlets;
  v_device public.pos_devices;
  v_customer public.customers;
  v_series public.invoice_series;
  v_existing public.sales_invoices;
  v_seller_gstin text;
  v_seller_state text;
  v_number text;
  v_seq bigint;
  v_invoice_id uuid;
  v_item jsonb;
  v_pay jsonb;
  v_line integer := 0;
  v_product public.products;
  v_sum_taxable bigint := 0;
  v_sum_cgst bigint := 0;
  v_sum_sgst bigint := 0;
  v_sum_igst bigint := 0;
  v_sum_cess bigint := 0;
  v_sum_discount bigint := 0;
  v_paid bigint := 0;
  v_due bigint := 0;
  v_max_discount numeric;
  v_discount_pct numeric;
  v_warnings jsonb := '[]'::jsonb;
  v_can_override boolean;
  v_item_count integer;
begin
  -- 1. Idempotency: a retried request returns the invoice that was already posted.
  select * into v_existing from public.sales_invoices where client_uuid = v_client_uuid;
  if found then
    if v_existing.business_id <> v_business_id then
      raise exception 'Duplicate request id';
    end if;
    return jsonb_build_object('invoice_id', v_existing.id, 'invoice_number', v_existing.invoice_number,
                              'public_token', v_existing.public_token, 'duplicate', true, 'warnings', '[]'::jsonb);
  end if;

  -- 2. Who and where.
  select * into v_business from public.businesses where id = v_business_id;
  select * into v_outlet from public.outlets where id = v_outlet_id;
  if v_business.id is null or v_outlet.id is null or v_outlet.business_id <> v_business_id then
    raise exception 'Outlet not found';
  end if;
  if not public.has_perm_for(p_actor, v_business_id, 'sales.create')
     or not public.can_access_outlet_for(p_actor, v_outlet_id) then
    raise exception 'You are not allowed to create bills for this outlet' using errcode = '42501';
  end if;
  if not v_outlet.is_active then
    raise exception 'This outlet is not active';
  end if;
  if v_source not in ('pos_online', 'pos_offline', 'back_office') then
    raise exception 'Unknown bill source';
  end if;

  v_item_count := jsonb_array_length(coalesce(p -> 'items', '[]'::jsonb));
  if v_item_count = 0 then
    raise exception 'A bill needs at least one item';
  end if;

  -- 3. Date and financial year. Online bills are always dated today (IST);
  --    offline bills keep the date they were printed with.
  v_date := case when v_offline then coalesce(nullif(p ->> 'invoice_date', '')::date, v_today) else v_today end;
  if v_date > v_today then
    raise exception 'The bill date cannot be in the future';
  end if;
  v_fy := public.financial_year(v_date);

  -- 4. Seller identity and document type.
  v_seller_gstin := case when v_business.gst_scheme = 'unregistered' then null
                         else coalesce(v_outlet.gstin, v_business.gstin) end;
  v_seller_state := coalesce(left(v_seller_gstin, 2), v_outlet.state_code);

  if (v_business.gst_scheme = 'composition' and v_doc_type <> 'bill_of_supply')
     or (v_business.gst_scheme = 'unregistered' and v_doc_type <> 'cash_memo')
     or (v_business.gst_scheme = 'regular' and v_doc_type not in ('tax_invoice', 'bill_of_supply')) then
    raise exception 'Document type % is not valid for a % business', v_doc_type, v_business.gst_scheme;
  end if;
  if v_inter is distinct from (v_seller_state <> v_pos_state) then
    raise exception 'Inter-state flag does not match the place of supply';
  end if;

  -- 5. Customer.
  if v_customer_id is not null then
    select * into v_customer from public.customers where id = v_customer_id and business_id = v_business_id;
    if not found then
      raise exception 'Customer not found';
    end if;
  end if;
  if v_supply_type = 'b2b' and nullif(v_cust ->> 'gstin', '') is null then
    raise exception 'A B2B bill needs the customer''s GSTIN';
  end if;

  -- 6. Totals must be internally consistent (the CHECK constraints repeat this).
  for v_item in select * from jsonb_array_elements(p -> 'items') loop
    v_sum_taxable := v_sum_taxable + (v_item ->> 'taxable_paise')::bigint;
    v_sum_cgst := v_sum_cgst + coalesce((v_item ->> 'cgst_paise')::bigint, 0);
    v_sum_sgst := v_sum_sgst + coalesce((v_item ->> 'sgst_paise')::bigint, 0);
    v_sum_igst := v_sum_igst + coalesce((v_item ->> 'igst_paise')::bigint, 0);
    v_sum_cess := v_sum_cess + coalesce((v_item ->> 'cess_paise')::bigint, 0);
    v_sum_discount := v_sum_discount + coalesce((v_item ->> 'discount_paise')::bigint, 0);
  end loop;
  if v_sum_taxable <> v_taxable or v_sum_cgst <> v_cgst or v_sum_sgst <> v_sgst
     or v_sum_igst <> v_igst or v_sum_cess <> v_cess or v_sum_discount <> v_discount then
    raise exception 'Bill totals do not match its lines';
  end if;

  -- 7. Discount limit for the cashier's role.
  if v_discount > 0 then
    v_max_discount := public.max_discount_for(p_actor, v_business_id);
    v_discount_pct := case when v_subtotal > 0 then round(v_discount * 100.0 / v_subtotal, 2) else 0 end;
    if v_discount_pct > v_max_discount then
      if v_offline then
        -- The customer already has this bill, so it is accepted and flagged.
        v_warnings := v_warnings || jsonb_build_object('code', 'discount_over_limit',
          'message', format('Discount %s%% is above the role limit of %s%%', v_discount_pct, v_max_discount));
        perform public.write_audit(v_business_id, p_actor, 'sale.offline_discount_over_limit', 'sales_invoices', null,
          null, jsonb_build_object('client_uuid', v_client_uuid, 'discount_percent', v_discount_pct, 'limit', v_max_discount));
      else
        raise exception '%', format('Discount of %s%% is above your limit of %s%%', v_discount_pct, v_max_discount)
          using hint = 'discount_over_limit';
      end if;
    end if;
  end if;

  -- 8. Payments: must add up to the bill total; "credit" needs a customer.
  for v_pay in select * from jsonb_array_elements(coalesce(p -> 'payments', '[]'::jsonb)) loop
    if (v_pay ->> 'amount_paise')::bigint <= 0 then
      raise exception 'Payment amounts must be more than zero';
    end if;
    v_paid := v_paid + (v_pay ->> 'amount_paise')::bigint;
    if v_pay ->> 'mode' = 'credit' then
      v_due := v_due + (v_pay ->> 'amount_paise')::bigint;
    end if;
  end loop;
  if v_paid <> v_total then
    raise exception 'Payments (%) do not add up to the bill total (%)',
      to_char(v_paid / 100.0, 'FM999999999990.00'), to_char(v_total / 100.0, 'FM999999999990.00');
  end if;
  if v_due > 0 and v_customer_id is null then
    raise exception 'Select a customer to give credit';
  end if;

  -- 9. Number. Device series: the device issued the number and the server checks it.
  --    Server series: allocate the next number under a row lock (no gaps, no duplicates).
  if v_device_id is not null then
    select * into v_device from public.pos_devices where id = v_device_id for update;
    if not found or v_device.business_id <> v_business_id or v_device.outlet_id <> v_outlet_id then
      raise exception 'This POS device is not registered for this outlet' using hint = 'device_invalid';
    end if;
    if not v_device.is_active then
      raise exception 'This POS device has been deactivated' using hint = 'device_inactive';
    end if;

    v_series := public.lock_series(v_business_id, v_outlet_id, v_device_id, 'invoice', v_fy);
    v_number := p ->> 'invoice_number';
    if v_number is null or v_number !~ ('^' || v_series.prefix || '/' || v_fy || '/[0-9]{5,}$') or length(v_number) > 16 then
      raise exception 'Bill number % does not belong to this device''s series (%/%)',
        coalesce(v_number, '(none)'), v_series.prefix, v_fy using hint = 'number_invalid';
    end if;
    v_seq := split_part(v_number, '/', 3)::bigint;
    if v_seq < 1 then
      raise exception 'Bill number % is not valid', v_number using hint = 'number_invalid';
    end if;
    if exists (
      select 1 from public.sales_invoices i
      where i.business_id = v_business_id and coalesce(i.seller_gstin, '') = coalesce(v_seller_gstin, '')
        and i.financial_year = v_fy and i.invoice_number = v_number
    ) then
      raise exception 'Bill number % has already been used', v_number using hint = 'number_conflict';
    end if;

    if v_seq > v_series.next_number then
      v_warnings := v_warnings || jsonb_build_object('code', 'series_gap',
        'message', format('Numbers %s to %s of series %s are missing', v_series.next_number, v_seq - 1, v_series.prefix));
      perform public.write_audit(v_business_id, p_actor, 'series.gap', 'invoice_series', v_series.id, null,
        jsonb_build_object('expected', v_series.next_number, 'received', v_seq, 'invoice_number', v_number,
                           'device_id', v_device_id));
    end if;
    if v_seq >= v_series.next_number then
      update public.invoice_series set next_number = v_seq + 1 where id = v_series.id;
    end if;
    update public.pos_devices set last_seen_at = now() where id = v_device_id;
  else
    v_series := public.lock_series(v_business_id, v_outlet_id, null, 'invoice', v_fy);
    v_seq := v_series.next_number;
    v_number := public.format_document_number(v_series.prefix, v_fy, v_seq);
    update public.invoice_series set next_number = v_seq + 1 where id = v_series.id;
  end if;

  -- 10. Invoice header.
  insert into public.sales_invoices (
    business_id, outlet_id, series_id, pos_device_id, invoice_number, financial_year, document_type, invoice_date,
    seller_gstin, seller_state_code,
    customer_id, customer_name, customer_phone, customer_email, customer_gstin, customer_address,
    customer_pincode, customer_state_code,
    supply_type, place_of_supply_state, pos_override_reason, is_inter_state, reverse_charge,
    subtotal_paise, discount_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, cess_paise,
    round_off_paise, total_paise, amount_due_paise, amount_in_words, notes,
    public_token, client_uuid, source, created_by
  ) values (
    v_business_id, v_outlet_id, v_series.id, v_device_id, v_number, v_fy, v_doc_type, v_date,
    v_seller_gstin, v_seller_state,
    v_customer_id,
    nullif(trim(coalesce(v_cust ->> 'name', '')), ''),
    nullif(v_cust ->> 'phone', ''),
    nullif(lower(trim(coalesce(v_cust ->> 'email', ''))), ''),
    nullif(upper(v_cust ->> 'gstin'), ''),
    nullif(trim(coalesce(v_cust ->> 'address', '')), ''),
    nullif(v_cust ->> 'pincode', ''),
    nullif(v_cust ->> 'state_code', ''),
    v_supply_type, v_pos_state, nullif(trim(coalesce(p ->> 'pos_override_reason', '')), ''), v_inter,
    coalesce((p ->> 'reverse_charge')::boolean, false),
    v_subtotal, v_discount, v_taxable, v_cgst, v_sgst, v_igst, v_cess,
    v_round_off, v_total, v_due, p ->> 'amount_in_words', nullif(trim(coalesce(p ->> 'notes', '')), ''),
    coalesce(nullif(p ->> 'public_token', ''), public.random_token()), v_client_uuid, v_source, p_actor
  ) returning id into v_invoice_id;

  -- 11. Lines + stock.
  v_can_override := public.has_perm_for(p_actor, v_business_id, 'sales.price_override');
  for v_item in select * from jsonb_array_elements(p -> 'items') loop
    v_line := v_line + 1;
    v_product := null;

    if nullif(v_item ->> 'product_id', '') is not null then
      select * into v_product from public.products
      where id = (v_item ->> 'product_id')::uuid and business_id = v_business_id;
      if not found then
        raise exception 'Line %: product not found', v_line;
      end if;

      if (v_item ->> 'unit_price_paise')::bigint <> v_product.sale_price_paise then
        if v_offline then
          -- Offline prices are what the customer paid; accept and log the difference.
          perform public.write_audit(v_business_id, p_actor, 'sale.offline_price_mismatch', 'sales_invoices', v_invoice_id,
            jsonb_build_object('product_id', v_product.id, 'price_paise', v_product.sale_price_paise),
            jsonb_build_object('price_paise', (v_item ->> 'unit_price_paise')::bigint, 'invoice_number', v_number,
                               'product', v_product.name));
        elsif not v_can_override then
          raise exception 'Line %: you are not allowed to change the price of "%"', v_line, v_product.name
            using hint = 'price_override_denied';
        else
          perform public.write_audit(v_business_id, p_actor, 'sale.price_override', 'sales_invoices', v_invoice_id,
            jsonb_build_object('product_id', v_product.id, 'price_paise', v_product.sale_price_paise),
            jsonb_build_object('price_paise', (v_item ->> 'unit_price_paise')::bigint, 'invoice_number', v_number,
                               'product', v_product.name));
        end if;
      end if;
    end if;

    insert into public.sales_invoice_items (
      invoice_id, business_id, line_no, product_id, description, hsn_code, quantity, unit_code,
      unit_price_paise, price_includes_tax, discount_paise, taxable_paise, gst_rate, cess_rate,
      cgst_paise, sgst_paise, igst_paise, cess_paise, total_paise
    ) values (
      v_invoice_id, v_business_id, v_line, v_product.id,
      coalesce(nullif(trim(coalesce(v_item ->> 'description', '')), ''), v_product.name),
      nullif(v_item ->> 'hsn_code', ''),
      (v_item ->> 'quantity')::numeric,
      coalesce(nullif(v_item ->> 'unit_code', ''), 'PCS'),
      (v_item ->> 'unit_price_paise')::bigint,
      coalesce((v_item ->> 'price_includes_tax')::boolean, true),
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

    if v_product.id is not null and v_product.track_inventory then
      insert into public.stock_movements (business_id, outlet_id, product_id, quantity_delta, movement_type,
                                          source_table, source_id, note, created_by)
      values (v_business_id, v_outlet_id, v_product.id, -((v_item ->> 'quantity')::numeric), 'sale',
              'sales_invoices', v_invoice_id, 'Sale ' || v_number, p_actor);

      if v_offline then
        if (select quantity < 0 from public.stock_levels where product_id = v_product.id and outlet_id = v_outlet_id)
           and not v_business.allow_negative_stock then
          v_warnings := v_warnings || jsonb_build_object('code', 'negative_stock',
            'message', format('Stock of "%s" went below zero', v_product.name));
        end if;
      else
        perform public.assert_stock_available(v_business_id, v_outlet_id, v_product.id);
      end if;
    end if;
  end loop;

  -- 12. Payments.
  insert into public.sales_payments (invoice_id, business_id, mode, amount_paise, reference, received_on, created_by)
  select v_invoice_id, v_business_id, x ->> 'mode', (x ->> 'amount_paise')::bigint,
         nullif(trim(coalesce(x ->> 'reference', '')), ''), v_date, p_actor
  from jsonb_array_elements(coalesce(p -> 'payments', '[]'::jsonb)) x;

  -- 13. WhatsApp consent captured at the counter.
  if v_customer_id is not null and coalesce((p ->> 'whatsapp_opt_in')::boolean, false) and not v_customer.whatsapp_opt_in then
    update public.customers set whatsapp_opt_in = true where id = v_customer_id;
    v_customer.whatsapp_opt_in := true;
  end if;

  -- 14. Receipts (transactional outbox).
  if coalesce((p -> 'notify' ->> 'email')::boolean, false) and v_business.notify_email_enabled
     and nullif(v_cust ->> 'email', '') is not null then
    perform public.queue_invoice_notification(v_invoice_id, 'email', lower(trim(v_cust ->> 'email')), p_actor);
  end if;
  if coalesce((p -> 'notify' ->> 'whatsapp')::boolean, false) and v_business.notify_whatsapp_enabled
     and v_customer_id is not null and v_customer.whatsapp_opt_in and nullif(v_cust ->> 'phone', '') is not null then
    perform public.queue_invoice_notification(v_invoice_id, 'whatsapp', v_cust ->> 'phone', p_actor);
  end if;

  -- 15. Audit: place-of-supply override.
  if nullif(trim(coalesce(p ->> 'pos_override_reason', '')), '') is not null then
    perform public.write_audit(v_business_id, p_actor, 'sale.place_of_supply_override', 'sales_invoices', v_invoice_id,
      null, jsonb_build_object('place_of_supply_state', v_pos_state, 'reason', p ->> 'pos_override_reason',
                               'invoice_number', v_number));
  end if;

  return jsonb_build_object('invoice_id', v_invoice_id, 'invoice_number', v_number,
                            'public_token', (select public_token from public.sales_invoices where id = v_invoice_id),
                            'duplicate', false, 'warnings', v_warnings);
end;
$$;

-- ── Cancellation ────────────────────────────────────────────────────────────

create or replace function public.cancel_sales_invoice(p_invoice_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_inv public.sales_invoices;
  v_window integer;
  v_move record;
begin
  select * into v_inv from public.sales_invoices where id = p_invoice_id for update;
  if not found
     or not public.has_perm(v_inv.business_id, 'sales.cancel')
     or not public.can_access_outlet(v_inv.outlet_id) then
    raise exception 'You are not allowed to cancel bills' using errcode = '42501';
  end if;
  if v_inv.status = 'cancelled' then
    raise exception 'This bill is already cancelled';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason is required to cancel a bill';
  end if;
  if exists (select 1 from public.credit_notes where invoice_id = p_invoice_id) then
    raise exception 'This bill has a credit note against it and cannot be cancelled';
  end if;

  select cancel_window_days into v_window from public.businesses where id = v_inv.business_id;
  if v_window is not null and public.ist_today() - v_inv.invoice_date > v_window then
    raise exception 'This bill is too old to cancel (%). Issue a credit note instead.',
      case when v_window = 0 then 'only same-day cancellation is allowed'
           else format('the limit is %s days', v_window) end
      using hint = 'cancel_window_passed';
  end if;

  -- Put the stock back exactly as it went out.
  for v_move in
    select product_id, sum(quantity_delta) as qty
    from public.stock_movements
    where source_table = 'sales_invoices' and source_id = p_invoice_id and movement_type = 'sale'
    group by product_id
  loop
    insert into public.stock_movements (business_id, outlet_id, product_id, quantity_delta, movement_type,
                                        source_table, source_id, note, created_by)
    values (v_inv.business_id, v_inv.outlet_id, v_move.product_id, -v_move.qty, 'sale_cancel',
            'sales_invoices', p_invoice_id, 'Cancelled ' || v_inv.invoice_number, v_actor);
  end loop;

  update public.sales_invoices
  set status = 'cancelled', cancelled_at = now(), cancelled_by = v_actor, cancel_reason = trim(p_reason),
      amount_due_paise = 0
  where id = p_invoice_id;

  -- Receipts that have not gone out yet should not be sent for a cancelled bill.
  update public.notification_jobs
  set status = 'failed', last_error = 'Invoice was cancelled before sending'
  where related_table = 'sales_invoices' and related_id = p_invoice_id and status = 'queued';

  perform public.write_audit(v_inv.business_id, v_actor, 'sale.cancelled', 'sales_invoices', p_invoice_id,
    jsonb_build_object('status', 'posted', 'total_paise', v_inv.total_paise),
    jsonb_build_object('status', 'cancelled', 'reason', trim(p_reason), 'invoice_number', v_inv.invoice_number));
end;
$$;

-- ── Credit notes (full or partial returns) ──────────────────────────────────
-- p_items: [{ "invoice_item_id": uuid, "quantity": numeric }]
-- Amounts are pro-rated from the original line. Returning the last remaining
-- quantity of a line credits exactly what is left, so rounding never drifts.

create or replace function public.create_credit_note(
  p_invoice_id uuid,
  p_items jsonb,
  p_reason text,
  p_restock boolean default true,
  p_refund_mode text default 'cash'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_inv public.sales_invoices;
  v_series public.invoice_series;
  v_today date := public.ist_today();
  v_fy text := public.financial_year(public.ist_today());
  v_number text;
  v_note_id uuid := gen_random_uuid();
  v_req jsonb;
  v_item public.sales_invoice_items;
  v_prev record;
  v_qty numeric;
  v_remaining numeric;
  v_line integer := 0;
  v_taxable bigint; v_cgst bigint; v_sgst bigint; v_igst bigint; v_cess bigint;
  v_sum_taxable bigint := 0; v_sum_cgst bigint := 0; v_sum_sgst bigint := 0;
  v_sum_igst bigint := 0; v_sum_cess bigint := 0;
  v_round_off bigint := 0;
  v_total bigint;
  v_adjust bigint;
  v_fully_returned boolean;
  v_track boolean;
  v_rows jsonb := '[]'::jsonb;
  v_row jsonb;
begin
  select * into v_inv from public.sales_invoices where id = p_invoice_id for update;
  if not found
     or not public.has_perm(v_inv.business_id, 'sales.credit_note')
     or not public.can_access_outlet(v_inv.outlet_id) then
    raise exception 'You are not allowed to issue credit notes' using errcode = '42501';
  end if;
  if v_inv.status = 'cancelled' then
    raise exception 'This bill is cancelled';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason is required for a credit note';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Select at least one item to return';
  end if;
  if p_refund_mode is not null and p_refund_mode not in ('cash', 'upi', 'card', 'bank_transfer') then
    raise exception 'Unknown refund mode';
  end if;

  -- Work out every line first.
  for v_req in select * from jsonb_array_elements(p_items) loop
    v_qty := round((v_req ->> 'quantity')::numeric, 3);
    if v_qty is null or v_qty <= 0 then
      continue;
    end if;

    select * into v_item from public.sales_invoice_items
    where id = (v_req ->> 'invoice_item_id')::uuid and invoice_id = p_invoice_id;
    if not found then
      raise exception 'Item does not belong to this bill';
    end if;
    if v_rows @> jsonb_build_array(jsonb_build_object('invoice_item_id', v_item.id)) then
      raise exception 'The same line was listed twice';
    end if;

    select coalesce(sum(quantity), 0) as qty, coalesce(sum(taxable_paise), 0) as taxable,
           coalesce(sum(cgst_paise), 0) as cgst, coalesce(sum(sgst_paise), 0) as sgst,
           coalesce(sum(igst_paise), 0) as igst, coalesce(sum(cess_paise), 0) as cess
    into v_prev from public.credit_note_items where invoice_item_id = v_item.id;

    v_remaining := v_item.quantity - v_prev.qty;
    if v_qty > v_remaining then
      raise exception 'Only % of "%" can still be returned', trim(trailing '.' from trim(trailing '0' from v_remaining::text)), v_item.description;
    end if;

    if v_qty = v_remaining then
      v_taxable := v_item.taxable_paise - v_prev.taxable;
      v_cgst := v_item.cgst_paise - v_prev.cgst;
      v_sgst := v_item.sgst_paise - v_prev.sgst;
      v_igst := v_item.igst_paise - v_prev.igst;
      v_cess := v_item.cess_paise - v_prev.cess;
    else
      v_taxable := least(round(v_item.taxable_paise * v_qty / v_item.quantity)::bigint, v_item.taxable_paise - v_prev.taxable);
      v_cgst := least(round(v_item.cgst_paise * v_qty / v_item.quantity)::bigint, v_item.cgst_paise - v_prev.cgst);
      v_sgst := least(round(v_item.sgst_paise * v_qty / v_item.quantity)::bigint, v_item.sgst_paise - v_prev.sgst);
      v_igst := least(round(v_item.igst_paise * v_qty / v_item.quantity)::bigint, v_item.igst_paise - v_prev.igst);
      v_cess := least(round(v_item.cess_paise * v_qty / v_item.quantity)::bigint, v_item.cess_paise - v_prev.cess);
    end if;

    v_line := v_line + 1;
    v_rows := v_rows || jsonb_build_object(
      'invoice_item_id', v_item.id, 'line_no', v_line, 'product_id', v_item.product_id,
      'description', v_item.description, 'hsn_code', v_item.hsn_code, 'quantity', v_qty,
      'unit_code', v_item.unit_code, 'unit_price_paise', v_item.unit_price_paise,
      'taxable_paise', v_taxable, 'gst_rate', v_item.gst_rate, 'cess_rate', v_item.cess_rate,
      'cgst_paise', v_cgst, 'sgst_paise', v_sgst, 'igst_paise', v_igst, 'cess_paise', v_cess
    );
    v_sum_taxable := v_sum_taxable + v_taxable;
    v_sum_cgst := v_sum_cgst + v_cgst;
    v_sum_sgst := v_sum_sgst + v_sgst;
    v_sum_igst := v_sum_igst + v_igst;
    v_sum_cess := v_sum_cess + v_cess;
  end loop;

  if v_line = 0 then
    raise exception 'Select at least one item to return';
  end if;

  -- When this note returns everything that was left, also give back the bill's round-off.
  select not exists (
    select 1
    from public.sales_invoice_items i
    where i.invoice_id = p_invoice_id
      and i.quantity
          - coalesce((select sum(c.quantity) from public.credit_note_items c where c.invoice_item_id = i.id), 0)
          - coalesce((select sum((r ->> 'quantity')::numeric) from jsonb_array_elements(v_rows) r
                      where (r ->> 'invoice_item_id')::uuid = i.id), 0) > 0
  ) into v_fully_returned;
  if v_fully_returned then
    v_round_off := v_inv.round_off_paise
      - coalesce((select sum(round_off_paise) from public.credit_notes where invoice_id = p_invoice_id), 0);
  end if;

  v_total := v_sum_taxable + v_sum_cgst + v_sum_sgst + v_sum_igst + v_sum_cess + v_round_off;
  if v_total < 0 then
    v_round_off := v_round_off - v_total;
    v_total := 0;
  end if;

  -- First knock the credit off what the customer still owes; refund only the rest.
  v_adjust := least(v_inv.amount_due_paise, v_total);

  v_series := public.lock_series(v_inv.business_id, v_inv.outlet_id, null, 'credit_note', v_fy);
  v_number := public.format_document_number(v_series.prefix, v_fy, v_series.next_number);
  update public.invoice_series set next_number = v_series.next_number + 1 where id = v_series.id;

  insert into public.credit_notes (
    id, business_id, outlet_id, invoice_id, series_id, credit_note_number, financial_year, credit_note_date,
    seller_gstin, reason, restock, is_inter_state,
    taxable_paise, cgst_paise, sgst_paise, igst_paise, cess_paise, round_off_paise, total_paise,
    adjusted_against_due_paise, refund_paise, refund_mode, created_by
  ) values (
    v_note_id, v_inv.business_id, v_inv.outlet_id, p_invoice_id, v_series.id, v_number, v_fy, v_today,
    v_inv.seller_gstin, trim(p_reason), coalesce(p_restock, false), v_inv.is_inter_state,
    v_sum_taxable, v_sum_cgst, v_sum_sgst, v_sum_igst, v_sum_cess, v_round_off, v_total,
    v_adjust, v_total - v_adjust, case when v_total - v_adjust > 0 then coalesce(p_refund_mode, 'cash') else null end,
    v_actor
  );

  for v_row in select * from jsonb_array_elements(v_rows) loop
    insert into public.credit_note_items (
      credit_note_id, business_id, invoice_item_id, line_no, product_id, description, hsn_code, quantity,
      unit_code, unit_price_paise, taxable_paise, gst_rate, cess_rate,
      cgst_paise, sgst_paise, igst_paise, cess_paise, total_paise
    ) values (
      v_note_id, v_inv.business_id, (v_row ->> 'invoice_item_id')::uuid, (v_row ->> 'line_no')::integer,
      nullif(v_row ->> 'product_id', '')::uuid, v_row ->> 'description', v_row ->> 'hsn_code',
      (v_row ->> 'quantity')::numeric, v_row ->> 'unit_code', (v_row ->> 'unit_price_paise')::bigint,
      (v_row ->> 'taxable_paise')::bigint, (v_row ->> 'gst_rate')::numeric, (v_row ->> 'cess_rate')::numeric,
      (v_row ->> 'cgst_paise')::bigint, (v_row ->> 'sgst_paise')::bigint, (v_row ->> 'igst_paise')::bigint,
      (v_row ->> 'cess_paise')::bigint,
      (v_row ->> 'taxable_paise')::bigint + (v_row ->> 'cgst_paise')::bigint + (v_row ->> 'sgst_paise')::bigint
        + (v_row ->> 'igst_paise')::bigint + (v_row ->> 'cess_paise')::bigint
    );

    if coalesce(p_restock, false) and nullif(v_row ->> 'product_id', '') is not null then
      select track_inventory into v_track from public.products where id = (v_row ->> 'product_id')::uuid;
      if coalesce(v_track, false) then
        insert into public.stock_movements (business_id, outlet_id, product_id, quantity_delta, movement_type,
                                            source_table, source_id, note, created_by)
        values (v_inv.business_id, v_inv.outlet_id, (v_row ->> 'product_id')::uuid, (v_row ->> 'quantity')::numeric,
                'sale_return', 'credit_notes', v_note_id, 'Return ' || v_number || ' against ' || v_inv.invoice_number, v_actor);
      end if;
    end if;
  end loop;

  if v_adjust > 0 then
    update public.sales_invoices set amount_due_paise = amount_due_paise - v_adjust where id = p_invoice_id;
  end if;

  perform public.write_audit(v_inv.business_id, v_actor, 'sale.credit_note', 'credit_notes', v_note_id, null,
    jsonb_build_object('credit_note_number', v_number, 'invoice_number', v_inv.invoice_number,
                       'total_paise', v_total, 'reason', trim(p_reason), 'restock', coalesce(p_restock, false)));
  return v_note_id;
end;
$$;

-- ── Collecting a credit (udhaar) sale later ─────────────────────────────────

create or replace function public.record_sale_collection(
  p_invoice_id uuid,
  p_mode text,
  p_amount_paise bigint,
  p_reference text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv public.sales_invoices;
begin
  select * into v_inv from public.sales_invoices where id = p_invoice_id for update;
  if not found
     or not public.has_perm(v_inv.business_id, 'sales.create')
     or not public.can_access_outlet(v_inv.outlet_id)
     or not (public.has_perm(v_inv.business_id, 'sales.view_all') or v_inv.created_by = auth.uid()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_inv.status = 'cancelled' then
    raise exception 'This bill is cancelled';
  end if;
  if p_mode not in ('cash', 'upi', 'card', 'bank_transfer') then
    raise exception 'Unknown payment mode';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'Amount must be more than zero';
  end if;
  if p_amount_paise > v_inv.amount_due_paise then
    raise exception 'Only % is due on this bill', to_char(v_inv.amount_due_paise / 100.0, 'FM999999999990.00');
  end if;

  insert into public.sales_payments (invoice_id, business_id, mode, amount_paise, reference, is_collection, created_by)
  values (p_invoice_id, v_inv.business_id, p_mode, p_amount_paise, nullif(trim(coalesce(p_reference, '')), ''), true, auth.uid());

  update public.sales_invoices set amount_due_paise = amount_due_paise - p_amount_paise where id = p_invoice_id;
end;
$$;

-- Owner can switch the public /i/{token} link of an invoice off (and back on).
create or replace function public.set_invoice_public_link(p_invoice_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv public.sales_invoices;
begin
  select * into v_inv from public.sales_invoices where id = p_invoice_id;
  if not found or not public.has_perm(v_inv.business_id, 'settings.manage') then
    raise exception 'Only the owner can change the public link' using errcode = '42501';
  end if;
  update public.sales_invoices
  set public_token_revoked_at = case when p_enabled then null else now() end
  where id = p_invoice_id;
  perform public.write_audit(v_inv.business_id, auth.uid(),
    case when p_enabled then 'sale.public_link_restored' else 'sale.public_link_revoked' end,
    'sales_invoices', p_invoice_id, null, jsonb_build_object('invoice_number', v_inv.invoice_number));
end;
$$;

-- ── Row Level Security ──────────────────────────────────────────────────────

alter table public.pos_devices          enable row level security;
alter table public.invoice_series       enable row level security;
alter table public.sales_invoices       enable row level security;
alter table public.sales_invoice_items  enable row level security;
alter table public.sales_payments       enable row level security;
alter table public.credit_notes         enable row level security;
alter table public.credit_note_items    enable row level security;

create policy pos_devices_select on public.pos_devices for select to authenticated
  using (public.is_member(business_id) and public.can_access_outlet(outlet_id));
create policy pos_devices_update on public.pos_devices for update to authenticated
  using (public.has_perm(business_id, 'settings.manage'))
  with check (public.has_perm(business_id, 'settings.manage'));

create policy invoice_series_select on public.invoice_series for select to authenticated
  using (public.is_member(business_id) and public.can_access_outlet(outlet_id));
create policy invoice_series_insert on public.invoice_series for insert to authenticated
  with check (public.has_perm(business_id, 'settings.manage'));
create policy invoice_series_update on public.invoice_series for update to authenticated
  using (public.has_perm(business_id, 'settings.manage'))
  with check (public.has_perm(business_id, 'settings.manage'));

-- Financial documents are read-only through the API. A cashier with only
-- sales.view_own sees just the bills they made.
create policy sales_invoices_select on public.sales_invoices for select to authenticated
  using (
    public.can_access_outlet(outlet_id)
    and (
      public.has_perm(business_id, 'sales.view_all')
      or (public.has_perm(business_id, 'sales.view_own') and created_by = (select auth.uid()))
    )
  );

create policy sales_invoice_items_select on public.sales_invoice_items for select to authenticated
  using (exists (select 1 from public.sales_invoices i where i.id = invoice_id));
create policy sales_payments_select on public.sales_payments for select to authenticated
  using (exists (select 1 from public.sales_invoices i where i.id = invoice_id));

create policy credit_notes_select on public.credit_notes for select to authenticated
  using (
    public.can_access_outlet(outlet_id)
    and (
      public.has_perm(business_id, 'sales.view_all')
      or (public.has_perm(business_id, 'sales.view_own') and created_by = (select auth.uid()))
    )
  );
create policy credit_note_items_select on public.credit_note_items for select to authenticated
  using (exists (select 1 from public.credit_notes c where c.id = credit_note_id));
