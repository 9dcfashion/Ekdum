-- ════════════════════════════════════════════════════════════════════════════
-- EkDum · demo data
-- ════════════════════════════════════════════════════════════════════════════
-- Creates a demo business with 50 products, customers, vendors, purchases,
-- five days of sales and a few shipments, owned by YOUR login.
--
-- HOW TO USE
--   1. Run supabase/ekdum_schema.sql first and sign up in the app.
--   2. Change the email on the line marked ← below to the email you signed up with.
--   3. Paste this file into the Supabase SQL Editor and run it.
--   4. In the app, pick "Sharma General Store (Demo)" from the business switcher.
-- It is safe to run more than once: each run adds another demo business.
-- The GSTINs below are made-up (checksum-valid) samples, not real registrations.

-- Amount in words (Indian system), matching lib/gst/words.ts. Session-local helper.
create or replace function pg_temp.ekdum_two_digits(n int) returns text language sql immutable as $$
  select case
    when n < 20 then (array['Zero','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve',
                            'Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'])[n + 1]
    else (array['Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'])[n / 10 - 1]
         || case when n % 10 > 0 then '-' || (array['One','Two','Three','Four','Five','Six','Seven','Eight','Nine'])[n % 10] else '' end
  end;
$$;

create or replace function pg_temp.ekdum_words(n bigint) returns text language plpgsql immutable as $$
declare
  parts text[] := '{}';
  crore bigint := n / 10000000;
  lakh int := ((n % 10000000) / 100000)::int;
  thousand int := ((n % 100000) / 1000)::int;
  rest int := (n % 1000)::int;
  hundreds text;
begin
  if n = 0 then return 'Zero'; end if;
  if crore > 0 then parts := parts || (pg_temp.ekdum_words(crore) || ' Crore'); end if;
  if lakh > 0 then parts := parts || (pg_temp.ekdum_two_digits(lakh) || ' Lakh'); end if;
  if thousand > 0 then parts := parts || (pg_temp.ekdum_two_digits(thousand) || ' Thousand'); end if;
  if rest > 0 then
    hundreds := case
      when rest >= 100 and rest % 100 > 0 then pg_temp.ekdum_two_digits(rest / 100) || ' Hundred ' || pg_temp.ekdum_two_digits(rest % 100)
      when rest >= 100 then pg_temp.ekdum_two_digits(rest / 100) || ' Hundred'
      else pg_temp.ekdum_two_digits(rest) end;
    parts := parts || hundreds;
  end if;
  return array_to_string(parts, ' ');
end;
$$;

create or replace function pg_temp.ekdum_amount_in_words(paise bigint) returns text language sql immutable as $$
  select 'Rupees ' || pg_temp.ekdum_words(paise / 100)
         || case when paise % 100 > 0 then ' and ' || pg_temp.ekdum_two_digits((paise % 100)::int) || ' Paise' else '' end
         || ' Only';
$$;

do $seed$
declare
  v_email text := 'owner@example.com';   -- ← change this to your login email

  v_user uuid;
  v_biz uuid;
  v_outlet uuid;
  v_owner_role uuid;
  v_series uuid;
  v_fy text := public.financial_year(public.ist_today());
  v_seq int := 0;
  v_today date := public.ist_today();
  v_cat uuid;
  v_product record;
  v_products uuid[];
  v_customers uuid[];
  v_b2b uuid;
  v_vendors uuid[];
  v_courier uuid;
  v_bill uuid;
  v_inv uuid;
  v_date date;
  v_number text;
  v_customer public.customers;
  v_day int; v_n int; v_k int; v_lines int; v_qty numeric; v_idx int;
  v_gross bigint; v_tax bigint; v_taxable bigint; v_cgst bigint; v_sgst bigint;
  v_sum_gross bigint; v_sum_taxable bigint; v_sum_cgst bigint; v_sum_sgst bigint;
  v_total bigint; v_rounded bigint;
  v_line_no int;
  v_ship uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(v_email);
  if v_user is null then
    raise exception 'No user with email %. Sign up in the app first, then set v_email at the top of this script.', v_email;
  end if;

  -- ── Business, roles, owner ────────────────────────────────────────────────
  insert into public.businesses (
    legal_name, trade_name, gst_scheme, gstin, pan, state_code, address_line1, address_line2, city, pincode,
    phone, email, brand_color, bank_name, bank_account_name, bank_account_number, ifsc, upi_id,
    invoice_terms, invoice_footer, onboarding_step, onboarding_completed_at, created_by
  ) values (
    'Sharma General Store', 'Sharma General Store (Demo)', 'regular', '27ABCDE1234F1Z0', 'ABCDE1234F', '27',
    'Shop 12, Laxmi Market', 'Station Road, Andheri East', 'Mumbai', '400069',
    '+912226831234', 'demo@sharmastores.example', '#4338CA',
    'Demo Bank', 'Sharma General Store', '50100123456789', 'HDFC0001234', 'sharmastore@okhdfcbank',
    E'Goods once sold will not be taken back.\nSubject to Mumbai jurisdiction.',
    'Thank you! Phir milenge.', 7, now(), v_user
  ) returning id into v_biz;

  perform public.seed_system_roles(v_biz);
  select id into v_owner_role from public.roles where business_id = v_biz and system_key = 'owner';
  insert into public.business_members (business_id, user_id, role_id, is_active, all_outlets, created_by)
  values (v_biz, v_user, v_owner_role, true, true, v_user);

  insert into public.outlets (business_id, name, address_line1, address_line2, city, pincode, state_code, phone, created_by)
  values (v_biz, 'Main Shop', 'Shop 12, Laxmi Market', 'Station Road, Andheri East', 'Mumbai', '400069', '27', '+912226831234', v_user)
  returning id into v_outlet;

  insert into public.invoice_series (business_id, outlet_id, document_type, prefix, financial_year, created_by)
  values (v_biz, v_outlet, 'invoice', 'D', v_fy, v_user) returning id into v_series;
  insert into public.invoice_series (business_id, outlet_id, document_type, prefix, financial_year, created_by)
  values (v_biz, v_outlet, 'credit_note', 'DCN', v_fy, v_user);

  -- ── Categories and 50 products ────────────────────────────────────────────
  create temp table ekdum_seed_products (
    n serial, category text, name text, hsn text, unit text, gst numeric, price numeric, cost numeric, stock numeric, low numeric
  ) on commit drop;

  insert into ekdum_seed_products (category, name, hsn, unit, gst, price, cost, stock, low) values
    ('Grocery', 'Basmati Rice 1kg',              '1006', 'PCS', 5,  149, 118, 80, 15),
    ('Grocery', 'Toor Dal 1kg',                  '0713', 'PCS', 5,  189, 158, 60, 15),
    ('Grocery', 'Moong Dal 500g',                '0713', 'PCS', 5,   85,  68, 50, 10),
    ('Grocery', 'Sugar 1kg',                     '1701', 'PCS', 5,   48,  41, 120, 25),
    ('Grocery', 'Iodised Salt 1kg',              '2501', 'PCS', 0,   28,  22, 90, 20),
    ('Grocery', 'Wheat Atta 5kg',                '1101', 'PCS', 0,  245, 212, 40, 10),
    ('Grocery', 'Sunflower Oil 1L',              '1512', 'PCS', 5,  165, 142, 55, 12),
    ('Grocery', 'Mustard Oil 1L',                '1514', 'PCS', 5,  185, 160, 35, 10),
    ('Grocery', 'Ghee 500ml',                    '0405', 'PCS', 5,  345, 298, 30, 8),
    ('Grocery', 'Tea 250g',                      '0902', 'PCS', 5,  140, 112, 70, 15),
    ('Grocery', 'Instant Coffee 50g',            '2101', 'PCS', 5,  175, 142, 40, 10),
    ('Grocery', 'Poha 500g',                     '1904', 'PCS', 5,   42,  33, 45, 10),
    ('Grocery', 'Besan 500g',                    '1106', 'PCS', 5,   68,  54, 38, 10),
    ('Grocery', 'Turmeric Powder 100g',          '0910', 'PCS', 5,   38,  28, 65, 15),
    ('Grocery', 'Red Chilli Powder 100g',        '0904', 'PCS', 5,   45,  34, 60, 15),
    ('Snacks',  'Glucose Biscuits 100g',         '1905', 'PCS', 5,   10,   8, 200, 40),
    ('Snacks',  'Cream Biscuits 120g',           '1905', 'PCS', 5,   30,  24, 120, 30),
    ('Snacks',  'Potato Chips 52g',              '2005', 'PCS', 5,   20,  16, 150, 30),
    ('Snacks',  'Namkeen Mixture 200g',          '2106', 'PCS', 5,   55,  43, 80, 20),
    ('Snacks',  'Instant Noodles 70g',           '1902', 'PCS', 5,   14,  11, 240, 50),
    ('Snacks',  'Milk Chocolate 40g',            '1806', 'PCS', 5,   40,  32, 100, 25),
    ('Snacks',  'Roasted Peanuts 200g',          '2008', 'PCS', 5,   60,  46, 70, 15),
    ('Snacks',  'Cola 750ml',                    '2202', 'PCS', 40,  45,  30, 96, 24),
    ('Snacks',  'Mango Drink 600ml',             '2202', 'PCS', 5,   40,  31, 72, 18),
    ('Snacks',  'Packaged Water 1L',             '2201', 'PCS', 5,   20,  14, 180, 36),
    ('Personal Care', 'Bath Soap 100g',          '3401', 'PCS', 5,   38,  30, 140, 30),
    ('Personal Care', 'Shampoo 180ml',           '3305', 'PCS', 5,  165, 132, 45, 10),
    ('Personal Care', 'Toothpaste 150g',         '3306', 'PCS', 5,   98,  78, 80, 20),
    ('Personal Care', 'Toothbrush',              '9603', 'PCS', 5,   30,  22, 90, 20),
    ('Personal Care', 'Hair Oil 200ml',          '3305', 'PCS', 5,  120,  95, 50, 12),
    ('Personal Care', 'Talcum Powder 100g',      '3304', 'PCS', 5,   85,  66, 35, 8),
    ('Personal Care', 'Face Wash 100ml',         '3401', 'PCS', 5,  175, 138, 30, 8),
    ('Personal Care', 'Hand Wash 200ml',         '3401', 'PCS', 5,   95,  74, 40, 10),
    ('Personal Care', 'Shaving Cream 70g',       '3307', 'PCS', 5,   78,  60, 28, 8),
    ('Personal Care', 'Sanitary Pads (pack of 8)','9619', 'PAC', 0,   45,  36, 60, 15),
    ('Home Care', 'Detergent Powder 1kg',        '3402', 'PCS', 18, 135, 104, 65, 15),
    ('Home Care', 'Detergent Bar 250g',          '3401', 'PCS', 18,  30,  23, 110, 25),
    ('Home Care', 'Dishwash Liquid 500ml',       '3402', 'PCS', 18, 110,  84, 48, 12),
    ('Home Care', 'Floor Cleaner 1L',            '3402', 'PCS', 18, 199, 152, 30, 8),
    ('Home Care', 'Toilet Cleaner 500ml',        '3402', 'PCS', 18,  99,  76, 36, 10),
    ('Home Care', 'Scrub Pad (pack of 3)',       '6805', 'PAC', 18,  45,  32, 70, 15),
    ('Home Care', 'Garbage Bags (pack of 30)',   '3923', 'PAC', 18,  85,  62, 40, 10),
    ('Home Care', 'Agarbatti (pack of 20)',      '3307', 'PAC', 5,   25,  18, 130, 30),
    ('Home Care', 'Matchbox (pack of 10)',       '3605', 'PAC', 5,   20,  15, 90, 20),
    ('Home Care', 'Mosquito Coil (pack of 10)',  '3808', 'PAC', 18,  38,  29, 55, 12),
    ('Stationery', 'Ball Pen Blue',              '9608', 'PCS', 18,  10,   6, 300, 60),
    ('Stationery', 'Notebook 200 pages',         '4820', 'PCS', 0,   60,  45, 120, 25),
    ('Stationery', 'Pencil Box (10 pencils)',    '9609', 'BOX', 0,   50,  38, 60, 15),
    ('Stationery', 'AA Batteries (pack of 4)',   '8506', 'PAC', 18, 120,  92, 44, 10),
    ('Stationery', 'LED Bulb 9W',                '8539', 'PCS', 18, 110,  82, 6, 12);

  for v_product in select distinct category from ekdum_seed_products loop
    insert into public.product_categories (business_id, name, created_by) values (v_biz, v_product.category, v_user);
  end loop;

  for v_product in select * from ekdum_seed_products order by n loop
    select id into v_cat from public.product_categories where business_id = v_biz and name = v_product.category;
    insert into public.products (business_id, name, sku, barcode, category_id, hsn_code, unit_code, gst_rate,
                                 sale_price_paise, price_includes_tax, mrp_paise, track_inventory, low_stock_threshold, created_by)
    values (v_biz, v_product.name, 'SKU-' || lpad(v_product.n::text, 4, '0'), '8901234' || lpad(v_product.n::text, 6, '0'),
            v_cat, v_product.hsn, v_product.unit, v_product.gst, (v_product.price * 100)::bigint, true,
            (v_product.price * 100)::bigint, true, v_product.low, v_user)
    returning id into v_inv;
    v_products := v_products || v_inv;

    insert into public.product_costs (product_id, business_id, purchase_price_paise, updated_by)
    values (v_inv, v_biz, (v_product.cost * 100)::bigint, v_user);
    insert into public.stock_movements (business_id, outlet_id, product_id, quantity_delta, movement_type,
                                        source_table, source_id, note, created_by, created_at)
    values (v_biz, v_outlet, v_inv, v_product.stock, 'opening', 'products', v_inv, 'Opening stock', v_user, now() - interval '7 days');
  end loop;

  -- ── Customers and vendors ─────────────────────────────────────────────────
  with ins as (
    insert into public.customers (business_id, name, phone, email, city, pincode, state_code, whatsapp_opt_in, created_by) values
      (v_biz, 'Anita Deshmukh',  '+919820011001', 'anita.d@example.com',  'Mumbai', '400069', '27', true,  v_user),
      (v_biz, 'Rahul Verma',     '+919820011002', null,                   'Mumbai', '400058', '27', false, v_user),
      (v_biz, 'Fatima Shaikh',   '+919820011003', 'fatima.s@example.com', 'Mumbai', '400093', '27', true,  v_user),
      (v_biz, 'Suresh Iyer',     '+919820011004', null,                   'Thane',  '400601', '27', false, v_user),
      (v_biz, 'Pooja Nair',      '+919820011005', 'pooja.n@example.com',  'Mumbai', '400072', '27', false, v_user),
      (v_biz, 'Imran Khan',      '+919820011006', null,                   'Mumbai', '400070', '27', true,  v_user)
    returning id
  )
  select array_agg(id) into v_customers from ins;

  insert into public.customers (business_id, name, phone, email, gstin, address_line1, city, pincode, state_code, created_by)
  values (v_biz, 'Shree Caterers', '+919820011007', 'accounts@shreecaterers.example', '27AAKCS9876L1Z9',
          '4 Industrial Estate, Marol', 'Mumbai', '400059', '27', v_user)
  returning id into v_b2b;
  insert into public.customers (business_id, name, phone, gstin, address_line1, city, pincode, state_code, created_by)
  values (v_biz, 'Gujarat Canteen Services', '+919820011008', '24AABCG4321K1ZW', '18 GIDC Phase 2', 'Vapi', '396195', '24', v_user);

  with ins as (
    insert into public.vendors (business_id, name, gstin, phone, city, pincode, state_code, created_by) values
      (v_biz, 'Mahalaxmi Distributors', '27AADFM5566P1ZL', '+912228501111', 'Mumbai',    '400011', '27', v_user),
      (v_biz, 'Bengaluru FMCG Supply',  '29AAGCB7788Q1ZH', '+918041232222', 'Bengaluru', '560002', '29', v_user),
      (v_biz, 'Tirupati Traders',       '27AAEPT1122R1ZC', '+912225773333', 'Mumbai',    '400009', '27', v_user),
      (v_biz, 'Local Stationery Mart',  null,              '+919833344444', 'Mumbai',    '400069', '27', v_user)
    returning id
  )
  select array_agg(id) into v_vendors from ins;

  -- ── Purchases: three posted bills (intra-state) ───────────────────────────
  for v_n in 1..3 loop
    insert into public.purchase_bills (business_id, outlet_id, vendor_id, vendor_invoice_number, vendor_invoice_date,
                                       financial_year, place_of_supply_state, is_inter_state, status, created_by)
    values (v_biz, v_outlet, v_vendors[case v_n when 2 then 3 else 1 end], 'MD/' || (1040 + v_n), v_today - (6 - v_n),
            public.financial_year(v_today - (6 - v_n)), '27', false, 'draft', v_user)
    returning id into v_bill;

    v_sum_taxable := 0; v_sum_cgst := 0; v_sum_sgst := 0;
    for v_k in 1..4 loop
      v_idx := ((v_n - 1) * 4 + v_k - 1) * 3 % 50 + 1;
      select p.id, p.name, p.hsn_code, p.unit_code, p.gst_rate, pc.purchase_price_paise
        into v_product
      from public.products p join public.product_costs pc on pc.product_id = p.id
      where p.id = v_products[v_idx];
      v_qty := 24 * v_k;
      v_taxable := (v_qty * v_product.purchase_price_paise)::bigint;
      v_tax := round(v_taxable * v_product.gst_rate / 100.0)::bigint;
      v_cgst := floor(v_tax / 2.0)::bigint;
      v_sgst := v_tax - v_cgst;
      insert into public.purchase_bill_items (purchase_bill_id, business_id, line_no, product_id, description, hsn_code,
                                              quantity, unit_code, rate_paise, taxable_paise, gst_rate, cgst_paise, sgst_paise, total_paise)
      values (v_bill, v_biz, v_k, v_product.id, v_product.name, v_product.hsn_code, v_qty, v_product.unit_code,
              v_product.purchase_price_paise, v_taxable, v_product.gst_rate, v_cgst, v_sgst, v_taxable + v_tax);
      insert into public.stock_movements (business_id, outlet_id, product_id, quantity_delta, movement_type,
                                          source_table, source_id, note, created_by, created_at)
      values (v_biz, v_outlet, v_product.id, v_qty, 'purchase', 'purchase_bills', v_bill, 'Purchase MD/' || (1040 + v_n),
              v_user, (v_today - (6 - v_n))::timestamp at time zone 'Asia/Kolkata' + interval '11 hours');
      v_sum_taxable := v_sum_taxable + v_taxable; v_sum_cgst := v_sum_cgst + v_cgst; v_sum_sgst := v_sum_sgst + v_sgst;
    end loop;

    update public.purchase_bills
    set subtotal_paise = v_sum_taxable, taxable_paise = v_sum_taxable, cgst_paise = v_sum_cgst, sgst_paise = v_sum_sgst,
        total_paise = v_sum_taxable + v_sum_cgst + v_sum_sgst, status = 'posted', posted_at = now(), posted_by = v_user
    where id = v_bill;

    if v_n = 1 then
      insert into public.purchase_payments (purchase_bill_id, business_id, amount_paise, mode, paid_on, reference, created_by)
      values (v_bill, v_biz, v_sum_taxable + v_sum_cgst + v_sum_sgst, 'bank_transfer', v_today - 4, 'NEFT-DEMO-001', v_user);
    elsif v_n = 2 then
      insert into public.purchase_payments (purchase_bill_id, business_id, amount_paise, mode, paid_on, created_by)
      values (v_bill, v_biz, 500000, 'upi', v_today - 2, v_user);
    end if;
  end loop;

  -- ── Sales: five days of bills (all prices include tax, intra-state) ───────
  for v_day in reverse 4..0 loop
    v_date := v_today - v_day;
    for v_n in 1..(7 + v_day % 3) loop
      v_seq := v_seq + 1;
      v_number := public.format_document_number('D', public.financial_year(v_date), v_seq);
      v_lines := 1 + (v_seq % 3);
      v_customer := null;
      if v_seq % 9 = 0 then
        select * into v_customer from public.customers where id = v_b2b;
      elsif v_seq % 3 = 0 then
        select * into v_customer from public.customers where id = v_customers[1 + (v_seq % 6)];
      end if;

      -- First pass: totals.
      v_sum_gross := 0; v_sum_taxable := 0; v_sum_cgst := 0; v_sum_sgst := 0;
      for v_k in 1..v_lines loop
        v_idx := 1 + ((v_seq * 7 + v_k * 13) % 50);
        select p.sale_price_paise, p.gst_rate into v_product from public.products p where p.id = v_products[v_idx];
        v_qty := 1 + ((v_seq + v_k) % 3);
        v_gross := (v_qty * v_product.sale_price_paise)::bigint;
        v_tax := round(v_gross - v_gross / (1 + v_product.gst_rate / 100.0))::bigint;
        v_cgst := floor(v_tax / 2.0)::bigint;
        v_sum_gross := v_sum_gross + v_gross;
        v_sum_taxable := v_sum_taxable + (v_gross - v_tax);
        v_sum_cgst := v_sum_cgst + v_cgst;
        v_sum_sgst := v_sum_sgst + (v_tax - v_cgst);
      end loop;
      v_total := v_sum_taxable + v_sum_cgst + v_sum_sgst;
      v_rounded := (round(v_total / 100.0) * 100)::bigint;

      insert into public.sales_invoices (
        business_id, outlet_id, series_id, invoice_number, financial_year, document_type, invoice_date,
        seller_gstin, seller_state_code, customer_id, customer_name, customer_phone, customer_email, customer_gstin,
        customer_address, customer_pincode, customer_state_code, supply_type, place_of_supply_state, is_inter_state,
        subtotal_paise, discount_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, cess_paise,
        round_off_paise, total_paise, amount_due_paise, amount_in_words, client_uuid, source, created_by, created_at
      ) values (
        v_biz, v_outlet, v_series, v_number, public.financial_year(v_date), 'tax_invoice', v_date,
        '27ABCDE1234F1Z0', '27', v_customer.id, v_customer.name, v_customer.phone, v_customer.email, v_customer.gstin,
        nullif(concat_ws(', ', v_customer.address_line1, v_customer.city), ''), v_customer.pincode, v_customer.state_code,
        case when v_customer.gstin is not null then 'b2b' else 'b2c' end, '27', false,
        v_sum_gross, 0, v_sum_taxable, v_sum_cgst, v_sum_sgst, 0, 0,
        v_rounded - v_total, v_rounded, 0, pg_temp.ekdum_amount_in_words(v_rounded), gen_random_uuid(), 'pos_online', v_user,
        v_date::timestamp at time zone 'Asia/Kolkata' + interval '10 hours' + (v_n * interval '55 minutes')
      ) returning id into v_inv;

      -- Second pass: lines and stock.
      v_line_no := 0;
      for v_k in 1..v_lines loop
        v_idx := 1 + ((v_seq * 7 + v_k * 13) % 50);
        select p.id, p.name, p.hsn_code, p.unit_code, p.sale_price_paise, p.gst_rate into v_product
        from public.products p where p.id = v_products[v_idx];
        v_qty := 1 + ((v_seq + v_k) % 3);
        v_gross := (v_qty * v_product.sale_price_paise)::bigint;
        v_tax := round(v_gross - v_gross / (1 + v_product.gst_rate / 100.0))::bigint;
        v_cgst := floor(v_tax / 2.0)::bigint;
        v_line_no := v_line_no + 1;
        insert into public.sales_invoice_items (invoice_id, business_id, line_no, product_id, description, hsn_code, quantity,
                                                unit_code, unit_price_paise, price_includes_tax, discount_paise, taxable_paise,
                                                gst_rate, cgst_paise, sgst_paise, total_paise)
        values (v_inv, v_biz, v_line_no, v_product.id, v_product.name, v_product.hsn_code, v_qty, v_product.unit_code,
                v_product.sale_price_paise, true, 0, v_gross - v_tax, v_product.gst_rate, v_cgst, v_tax - v_cgst, v_gross);
        insert into public.stock_movements (business_id, outlet_id, product_id, quantity_delta, movement_type,
                                            source_table, source_id, note, created_by, created_at)
        values (v_biz, v_outlet, v_product.id, -v_qty, 'sale', 'sales_invoices', v_inv, 'Sale ' || v_number, v_user,
                v_date::timestamp at time zone 'Asia/Kolkata' + interval '10 hours' + (v_n * interval '55 minutes'));
      end loop;

      -- Payments: mostly cash or UPI, some card, some split.
      if v_rounded > 0 then
        if v_seq % 7 = 0 and v_rounded > 20000 then
          insert into public.sales_payments (invoice_id, business_id, mode, amount_paise, received_on, created_by) values
            (v_inv, v_biz, 'cash', 10000, v_date, v_user),
            (v_inv, v_biz, 'upi', v_rounded - 10000, v_date, v_user);
        else
          insert into public.sales_payments (invoice_id, business_id, mode, amount_paise, received_on, created_by)
          values (v_inv, v_biz, (array['cash', 'upi', 'upi', 'card'])[1 + v_seq % 4], v_rounded, v_date, v_user);
        end if;
      end if;
    end loop;
  end loop;

  update public.invoice_series set next_number = v_seq + 1 where id = v_series;

  -- ── Shipments ─────────────────────────────────────────────────────────────
  insert into public.courier_partners (business_id, name, tracking_url_template, created_by)
  values (v_biz, 'Demo Express', 'https://example.com/track?awb={awb}', v_user) returning id into v_courier;

  insert into public.shipments (business_id, outlet_id, recipient_name, recipient_phone, address_line1, city, pincode, state_code,
                                courier_partner_id, tracking_number, shipped_on, package_count, weight_grams, created_by)
  values (v_biz, v_outlet, 'Gujarat Canteen Services', '+919820011008', '18 GIDC Phase 2', 'Vapi', '396195', '24',
          v_courier, 'DX100200301', v_today - 8, 2, 4500, v_user) returning id into v_ship;
  update public.shipments set status = 'in_transit', last_status_note = 'Handed over at Andheri hub' where id = v_ship;

  insert into public.shipments (business_id, outlet_id, recipient_name, recipient_phone, city, pincode, state_code,
                                courier_partner_id, tracking_number, shipped_on, created_by)
  values (v_biz, v_outlet, 'Pooja Nair', '+919820011005', 'Pune', '411001', '27', v_courier, 'DX100200302', v_today - 3, v_user)
  returning id into v_ship;
  update public.shipments set status = 'delivered', last_status_note = 'Received by customer' where id = v_ship;

  insert into public.shipments (business_id, outlet_id, recipient_name, recipient_phone, city, pincode, state_code,
                                courier_partner_id, tracking_number, shipped_on, created_by)
  values (v_biz, v_outlet, 'Suresh Iyer', '+919820011004', 'Thane', '400601', '27', v_courier, 'DX100200303', v_today, v_user);

  raise notice 'Demo business created: % bills, 50 products. Switch to "Sharma General Store (Demo)" in the app.', v_seq;
end
$seed$;
