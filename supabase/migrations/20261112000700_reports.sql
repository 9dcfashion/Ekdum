-- ════════════════════════════════════════════════════════════════════════════
-- EkDum · 07 · Dashboard and report functions
-- ════════════════════════════════════════════════════════════════════════════
-- All dates are IST calendar dates. invoice_date / credit_note_date are stored
-- as IST dates already; timestamps are converted with ist_date().
-- Each function checks the caller's permission and only reads outlets the
-- caller can access (p_outlet_id = null means "all my outlets").

create or replace function public.report_outlets(p_business_id uuid, p_outlet_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.id
  from public.outlets o
  where o.business_id = p_business_id
    and (p_outlet_id is null or o.id = p_outlet_id)
    and public.can_access_outlet(o.id);
$$;

create or replace function public.assert_can_report(p_business_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.has_perm(p_business_id, 'reports.view') or public.has_perm(p_business_id, 'dashboard.view')) then
    raise exception 'You are not allowed to view reports' using errcode = '42501';
  end if;
end;
$$;

-- ── Dashboard (one round trip) ──────────────────────────────────────────────

create or replace function public.dashboard_summary(
  p_business_id uuid,
  p_outlet_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_outlets uuid[];
  v_today date := public.ist_today();
  v_stuck_days integer;
  v_result jsonb;
begin
  if not public.has_perm(p_business_id, 'dashboard.view') then
    raise exception 'You are not allowed to view the dashboard' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 400 then
    raise exception 'Invalid date range';
  end if;

  select coalesce(array_agg(x), '{}') into v_outlets from public.report_outlets(p_business_id, p_outlet_id) x;
  select stuck_shipment_days into v_stuck_days from public.businesses where id = p_business_id;

  with inv as (
    select * from public.sales_invoices i
    where i.business_id = p_business_id and i.outlet_id = any (v_outlets)
      and i.invoice_date between p_from and p_to
  ),
  posted as (select * from inv where status = 'posted'),
  days as (select d::date as day from generate_series(p_from, p_to, interval '1 day') d),
  trend as (
    select d.day, coalesce(sum(p.total_paise), 0)::bigint as total_paise, count(p.id)::int as invoice_count
    from days d left join posted p on p.invoice_date = d.day
    group by d.day
  ),
  modes as (
    select sp.mode, sum(sp.amount_paise)::bigint as amount_paise, count(*)::int as payment_count
    from public.sales_payments sp
    join public.sales_invoices i on i.id = sp.invoice_id
    where sp.business_id = p_business_id and i.outlet_id = any (v_outlets) and i.status = 'posted'
      and sp.received_on between p_from and p_to
    group by sp.mode
  ),
  item_sales as (
    select coalesce(it.product_id::text, it.description) as key, max(it.description) as name,
           sum(it.total_paise)::bigint as revenue_paise, sum(it.quantity) as quantity
    from public.sales_invoice_items it
    join posted p on p.id = it.invoice_id
    group by 1
  ),
  staff as (
    select p.created_by, coalesce(nullif(pr.full_name, ''), pr.email, 'Unknown') as name,
           sum(p.total_paise)::bigint as total_paise, count(*)::int as invoice_count
    from posted p left join public.profiles pr on pr.id = p.created_by
    group by p.created_by, pr.full_name, pr.email
  ),
  low as (
    select pr.id, pr.name, pr.low_stock_threshold as threshold, pr.unit_code,
           coalesce(sum(sl.quantity), 0) as quantity
    from public.products pr
    left join public.stock_levels sl on sl.product_id = pr.id and sl.outlet_id = any (v_outlets)
    where pr.business_id = p_business_id and pr.is_active and pr.track_inventory
      and pr.low_stock_threshold is not null
    group by pr.id
    having coalesce(sum(sl.quantity), 0) <= pr.low_stock_threshold
  ),
  open_shipments as (
    select s.* from public.shipments s
    where s.business_id = p_business_id and s.outlet_id = any (v_outlets)
      and s.status in ('booked', 'picked_up', 'in_transit')
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'sales', (
      select jsonb_build_object(
        'total_paise', coalesce(sum(total_paise), 0),
        'invoice_count', count(*),
        'average_paise', case when count(*) = 0 then 0 else round(sum(total_paise)::numeric / count(*)) end,
        'tax_paise', coalesce(sum(cgst_paise + sgst_paise + igst_paise + cess_paise), 0),
        'taxable_paise', coalesce(sum(taxable_paise), 0),
        'discount_paise', coalesce(sum(discount_paise), 0),
        'due_paise', coalesce(sum(amount_due_paise), 0)
      ) from posted
    ),
    'cancelled_count', (select count(*) from inv where status = 'cancelled'),
    'credit_notes', (
      select jsonb_build_object('total_paise', coalesce(sum(c.total_paise), 0), 'count', count(*))
      from public.credit_notes c
      where c.business_id = p_business_id and c.outlet_id = any (v_outlets)
        and c.credit_note_date between p_from and p_to
    ),
    'payment_modes', coalesce((select jsonb_agg(to_jsonb(m) order by m.amount_paise desc) from modes m), '[]'::jsonb),
    'trend', coalesce((select jsonb_agg(to_jsonb(t) order by t.day) from trend t), '[]'::jsonb),
    'top_by_revenue', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select name, revenue_paise, quantity from item_sales order by revenue_paise desc, name limit 5
      ) x), '[]'::jsonb),
    'top_by_quantity', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select name, revenue_paise, quantity from item_sales order by quantity desc, name limit 5
      ) x), '[]'::jsonb),
    'sales_by_staff', coalesce((select jsonb_agg(to_jsonb(s) order by s.total_paise desc) from staff s), '[]'::jsonb),
    'purchases', (
      select jsonb_build_object('total_paise', coalesce(sum(b.total_paise), 0), 'count', count(*))
      from public.purchase_bills b
      where b.business_id = p_business_id and b.outlet_id = any (v_outlets) and b.status = 'posted'
        and b.vendor_invoice_date between p_from and p_to
        and public.has_perm(p_business_id, 'purchases.view')
    ),
    'low_stock', jsonb_build_object(
      'count', (select count(*) from low),
      'items', coalesce((
        select jsonb_agg(to_jsonb(x)) from (select * from low order by quantity - threshold, name limit 8) x
      ), '[]'::jsonb)
    ),
    'shipments', jsonb_build_object(
      'pending_count', (select count(*) from open_shipments),
      'stuck_days', v_stuck_days,
      'stuck_count', (select count(*) from open_shipments where shipped_on <= v_today - v_stuck_days),
      'stuck', coalesce((
        select jsonb_agg(to_jsonb(x)) from (
          select id, recipient_name, tracking_number, status, shipped_on, (v_today - shipped_on) as days_open
          from open_shipments where shipped_on <= v_today - v_stuck_days
          order by shipped_on limit 5
        ) x), '[]'::jsonb)
    ),
    'recent_cancellations', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select i.id, i.invoice_number, i.total_paise, i.cancel_reason, i.cancelled_at
        from public.sales_invoices i
        where i.business_id = p_business_id and i.outlet_id = any (v_outlets) and i.status = 'cancelled'
        order by i.cancelled_at desc limit 5
      ) x), '[]'::jsonb),
    'recent_credit_notes', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select c.id, c.invoice_id, c.credit_note_number, c.total_paise, c.reason, c.created_at
        from public.credit_notes c
        where c.business_id = p_business_id and c.outlet_id = any (v_outlets)
        order by c.created_at desc limit 5
      ) x), '[]'::jsonb),
    'failed_notifications', (
      select count(*) from public.notification_jobs j
      where j.business_id = p_business_id and j.status = 'failed'
    )
  ) into v_result;

  return v_result;
end;
$$;

-- ── Reports ─────────────────────────────────────────────────────────────────

create or replace function public.report_sales_register(p_business_id uuid, p_outlet_id uuid, p_from date, p_to date)
returns table (
  invoice_id uuid, invoice_date date, invoice_number text, document_type text, status text, outlet_name text,
  customer_name text, customer_phone text, customer_gstin text, supply_type text, place_of_supply_state text,
  is_inter_state boolean, subtotal_paise bigint, discount_paise bigint, taxable_paise bigint, cgst_paise bigint,
  sgst_paise bigint, igst_paise bigint, cess_paise bigint, round_off_paise bigint, total_paise bigint,
  amount_due_paise bigint, payment_modes text, billed_by text, source text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_can_report(p_business_id);
  return query
  select i.id, i.invoice_date, i.invoice_number, i.document_type, i.status, o.name,
         i.customer_name, i.customer_phone, i.customer_gstin, i.supply_type, i.place_of_supply_state,
         i.is_inter_state, i.subtotal_paise, i.discount_paise, i.taxable_paise, i.cgst_paise,
         i.sgst_paise, i.igst_paise, i.cess_paise, i.round_off_paise, i.total_paise, i.amount_due_paise,
         (select string_agg(distinct sp.mode, ', ' order by sp.mode) from public.sales_payments sp where sp.invoice_id = i.id),
         coalesce(nullif(pr.full_name, ''), pr.email),
         i.source
  from public.sales_invoices i
  join public.outlets o on o.id = i.outlet_id
  left join public.profiles pr on pr.id = i.created_by
  where i.business_id = p_business_id
    and i.outlet_id in (select public.report_outlets(p_business_id, p_outlet_id))
    and i.invoice_date between p_from and p_to
  order by i.invoice_date, i.created_at;
end;
$$;

create or replace function public.report_item_sales(p_business_id uuid, p_outlet_id uuid, p_from date, p_to date)
returns table (
  product_id uuid, description text, sku text, hsn_code text, unit_code text, quantity numeric,
  taxable_paise bigint, tax_paise bigint, total_paise bigint, invoice_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_can_report(p_business_id);
  return query
  select it.product_id, max(it.description), max(p.sku), max(it.hsn_code), max(it.unit_code), sum(it.quantity),
         sum(it.taxable_paise)::bigint,
         sum(it.cgst_paise + it.sgst_paise + it.igst_paise + it.cess_paise)::bigint,
         sum(it.total_paise)::bigint, count(distinct i.id)
  from public.sales_invoice_items it
  join public.sales_invoices i on i.id = it.invoice_id
  left join public.products p on p.id = it.product_id
  where i.business_id = p_business_id and i.status = 'posted'
    and i.outlet_id in (select public.report_outlets(p_business_id, p_outlet_id))
    and i.invoice_date between p_from and p_to
  group by it.product_id, case when it.product_id is null then it.description end
  order by sum(it.total_paise) desc;
end;
$$;

-- HSN-wise summary of outward supplies (net of nothing: credit notes are reported separately).
create or replace function public.report_hsn_summary(p_business_id uuid, p_outlet_id uuid, p_from date, p_to date)
returns table (
  hsn_code text, unit_code text, gst_rate numeric, quantity numeric, taxable_paise bigint,
  cgst_paise bigint, sgst_paise bigint, igst_paise bigint, cess_paise bigint, total_paise bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_can_report(p_business_id);
  return query
  select coalesce(it.hsn_code, '(none)'), it.unit_code, it.gst_rate, sum(it.quantity),
         sum(it.taxable_paise)::bigint, sum(it.cgst_paise)::bigint, sum(it.sgst_paise)::bigint,
         sum(it.igst_paise)::bigint, sum(it.cess_paise)::bigint, sum(it.total_paise)::bigint
  from public.sales_invoice_items it
  join public.sales_invoices i on i.id = it.invoice_id
  where i.business_id = p_business_id and i.status = 'posted'
    and i.outlet_id in (select public.report_outlets(p_business_id, p_outlet_id))
    and i.invoice_date between p_from and p_to
  group by coalesce(it.hsn_code, '(none)'), it.unit_code, it.gst_rate
  order by 1, 3;
end;
$$;

create or replace function public.report_purchase_register(p_business_id uuid, p_outlet_id uuid, p_from date, p_to date)
returns table (
  bill_id uuid, vendor_invoice_date date, vendor_invoice_number text, vendor_name text, vendor_gstin text,
  outlet_name text, status text, place_of_supply_state text, taxable_paise bigint, cgst_paise bigint,
  sgst_paise bigint, igst_paise bigint, cess_paise bigint, round_off_paise bigint, total_paise bigint,
  amount_paid_paise bigint, payment_status text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_can_report(p_business_id);
  if not public.has_perm(p_business_id, 'purchases.view') then
    raise exception 'You are not allowed to view purchases' using errcode = '42501';
  end if;
  return query
  select b.id, b.vendor_invoice_date, b.vendor_invoice_number, v.name, v.gstin, o.name, b.status,
         b.place_of_supply_state, b.taxable_paise, b.cgst_paise, b.sgst_paise, b.igst_paise, b.cess_paise,
         b.round_off_paise, b.total_paise, b.amount_paid_paise, b.payment_status
  from public.purchase_bills b
  join public.outlets o on o.id = b.outlet_id
  left join public.vendors v on v.id = b.vendor_id
  where b.business_id = p_business_id and b.status in ('posted', 'cancelled')
    and b.outlet_id in (select public.report_outlets(p_business_id, p_outlet_id))
    and b.vendor_invoice_date between p_from and p_to
  order by b.vendor_invoice_date, b.created_at;
end;
$$;

-- Current stock per product and outlet. Stock value is shown only to users who may see cost prices.
create or replace function public.report_stock_summary(p_business_id uuid, p_outlet_id uuid)
returns table (
  product_id uuid, name text, sku text, barcode text, category text, unit_code text, outlet_name text,
  quantity numeric, low_stock_threshold numeric, is_low boolean, sale_price_paise bigint,
  purchase_price_paise bigint, stock_value_paise bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cost boolean := public.has_perm(p_business_id, 'products.view_cost');
begin
  perform public.assert_can_report(p_business_id);
  return query
  select p.id, p.name, p.sku, p.barcode, c.name, p.unit_code, o.name,
         coalesce(sl.quantity, 0),
         p.low_stock_threshold,
         (p.low_stock_threshold is not null and coalesce(sl.quantity, 0) <= p.low_stock_threshold),
         p.sale_price_paise,
         case when v_cost then pc.purchase_price_paise end,
         case when v_cost then round(coalesce(sl.quantity, 0) * coalesce(pc.purchase_price_paise, 0))::bigint end
  from public.products p
  cross join public.outlets o
  left join public.stock_levels sl on sl.product_id = p.id and sl.outlet_id = o.id
  left join public.product_categories c on c.id = p.category_id
  left join public.product_costs pc on pc.product_id = p.id
  where p.business_id = p_business_id and p.is_active and p.track_inventory
    and o.id in (select public.report_outlets(p_business_id, p_outlet_id))
  order by p.name, o.name;
end;
$$;

create or replace function public.report_stock_movements(p_business_id uuid, p_outlet_id uuid, p_from date, p_to date)
returns table (
  moved_at timestamptz, product_name text, sku text, outlet_name text, movement_type text,
  quantity_delta numeric, unit_code text, reason text, note text, moved_by text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_can_report(p_business_id);
  return query
  select m.created_at, p.name, p.sku, o.name, m.movement_type, m.quantity_delta, p.unit_code, m.reason, m.note,
         coalesce(nullif(pr.full_name, ''), pr.email)
  from public.stock_movements m
  join public.products p on p.id = m.product_id
  join public.outlets o on o.id = m.outlet_id
  left join public.profiles pr on pr.id = m.created_by
  where m.business_id = p_business_id
    and m.outlet_id in (select public.report_outlets(p_business_id, p_outlet_id))
    and public.ist_date(m.created_at) between p_from and p_to
  order by m.created_at;
end;
$$;

create or replace function public.report_payment_modes(p_business_id uuid, p_outlet_id uuid, p_from date, p_to date)
returns table (received_on date, mode text, kind text, payment_count bigint, amount_paise bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_can_report(p_business_id);
  return query
  select sp.received_on, sp.mode, case when sp.is_collection then 'collection' else 'sale' end,
         count(*), sum(sp.amount_paise)::bigint
  from public.sales_payments sp
  join public.sales_invoices i on i.id = sp.invoice_id
  where sp.business_id = p_business_id and i.status = 'posted'
    and i.outlet_id in (select public.report_outlets(p_business_id, p_outlet_id))
    and sp.received_on between p_from and p_to
  group by sp.received_on, sp.mode, sp.is_collection
  order by sp.received_on, sp.mode;
end;
$$;

create or replace function public.report_shipments(p_business_id uuid, p_outlet_id uuid, p_from date, p_to date)
returns table (
  shipment_id uuid, shipped_on date, status text, courier text, tracking_number text, recipient_name text,
  recipient_phone text, city text, pincode text, state_code text, package_count integer, weight_grams integer,
  declared_value_paise bigint, invoice_number text, outlet_name text, status_changed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_can_report(p_business_id);
  return query
  select s.id, s.shipped_on, s.status, cp.name, s.tracking_number, s.recipient_name, s.recipient_phone,
         s.city, s.pincode, s.state_code, s.package_count, s.weight_grams, s.declared_value_paise,
         i.invoice_number, o.name, s.status_changed_at
  from public.shipments s
  join public.outlets o on o.id = s.outlet_id
  left join public.courier_partners cp on cp.id = s.courier_partner_id
  left join public.sales_invoices i on i.id = s.invoice_id
  where s.business_id = p_business_id
    and s.outlet_id in (select public.report_outlets(p_business_id, p_outlet_id))
    and s.shipped_on between p_from and p_to
  order by s.shipped_on, s.created_at;
end;
$$;

create or replace function public.report_credit_notes(p_business_id uuid, p_outlet_id uuid, p_from date, p_to date)
returns table (
  credit_note_id uuid, credit_note_date date, credit_note_number text, invoice_number text, invoice_date date,
  customer_name text, customer_gstin text, reason text, restock boolean, taxable_paise bigint, cgst_paise bigint,
  sgst_paise bigint, igst_paise bigint, cess_paise bigint, round_off_paise bigint, total_paise bigint,
  refund_paise bigint, refund_mode text, outlet_name text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_can_report(p_business_id);
  return query
  select c.id, c.credit_note_date, c.credit_note_number, i.invoice_number, i.invoice_date,
         i.customer_name, i.customer_gstin, c.reason, c.restock, c.taxable_paise, c.cgst_paise, c.sgst_paise,
         c.igst_paise, c.cess_paise, c.round_off_paise, c.total_paise, c.refund_paise, c.refund_mode, o.name
  from public.credit_notes c
  join public.sales_invoices i on i.id = c.invoice_id
  join public.outlets o on o.id = c.outlet_id
  where c.business_id = p_business_id
    and c.outlet_id in (select public.report_outlets(p_business_id, p_outlet_id))
    and c.credit_note_date between p_from and p_to
  order by c.credit_note_date, c.created_at;
end;
$$;

-- Outstanding payable per vendor (posted bills not fully paid).
create or replace function public.vendor_payables(p_business_id uuid)
returns table (vendor_id uuid, bill_count bigint, outstanding_paise bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_perm(p_business_id, 'purchases.view') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select b.vendor_id, count(*), sum(b.total_paise - b.amount_paid_paise)::bigint
  from public.purchase_bills b
  where b.business_id = p_business_id and b.status = 'posted' and b.payment_status <> 'paid'
    and b.vendor_id is not null
  group by b.vendor_id;
end;
$$;
