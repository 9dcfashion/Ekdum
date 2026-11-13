-- ════════════════════════════════════════════════════════════════════════════
-- EkDum · 09 · API privileges
-- ════════════════════════════════════════════════════════════════════════════
-- Explicit grants, so behaviour does not depend on project-level defaults.
--   anon           → nothing in the public schema.
--   authenticated  → table access (always filtered by RLS) + the RPCs listed below.
--   service_role   → everything (server only; never shipped to the browser).
--
-- IMPORTANT for future migrations: new functions are NOT callable through the
-- API until they are granted here-style, and new tables need RLS + a grant.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- ── Tables: read (RLS decides which rows) ───────────────────────────────────
grant select on all tables in schema public to authenticated;
revoke select on public.rate_limits from authenticated;

-- ── Tables: direct writes that RLS policies allow ───────────────────────────
grant update                 on public.profiles            to authenticated;
grant update                 on public.businesses          to authenticated;
grant insert, update         on public.outlets             to authenticated;
grant insert, update, delete on public.roles               to authenticated;
grant insert, delete         on public.role_permissions    to authenticated;
grant update                 on public.business_members    to authenticated;
grant insert, update, delete on public.invitations         to authenticated;
grant insert, update, delete on public.product_categories  to authenticated;
grant insert, update, delete on public.products            to authenticated;
grant insert, update         on public.product_costs       to authenticated;
grant insert, update, delete on public.customers           to authenticated;
grant insert, update, delete on public.vendors             to authenticated;
grant insert, delete         on public.purchase_payments   to authenticated;
grant update                 on public.pos_devices         to authenticated;
grant insert, update         on public.invoice_series      to authenticated;
grant insert, update, delete on public.courier_partners    to authenticated;
grant insert, update         on public.shipments           to authenticated;
-- Everything else (invoices, credit notes, stock, purchase bills, audit log,
-- notification jobs, memberships) is written only by SECURITY DEFINER functions.

-- ── Functions used inside RLS policies and column defaults ──────────────────
grant execute on function public.is_member(uuid)               to authenticated;
grant execute on function public.has_perm(uuid, text)          to authenticated;
grant execute on function public.can_access_outlet(uuid)       to authenticated;
grant execute on function public.can_access_outlet_of(uuid, uuid) to authenticated;
grant execute on function public.shares_business_with(uuid)    to authenticated;
grant execute on function public.storage_business_id(text)     to authenticated;
grant execute on function public.ist_today()                   to authenticated;
grant execute on function public.ist_date(timestamptz)         to authenticated;
grant execute on function public.financial_year(date)          to authenticated;

-- ── RPCs the signed-in user may call (each checks its own permissions) ──────
grant execute on function public.create_business(jsonb)                                  to authenticated;
grant execute on function public.set_member_outlets(uuid, boolean, uuid[])               to authenticated;
grant execute on function public.touch_member_activity(uuid)                             to authenticated;
grant execute on function public.set_opening_stock(uuid, uuid, numeric)                  to authenticated;
grant execute on function public.adjust_stock(uuid, uuid, numeric, text, text)           to authenticated;
grant execute on function public.post_purchase_bill(uuid)                                to authenticated;
grant execute on function public.cancel_purchase_bill(uuid, text)                        to authenticated;
grant execute on function public.retry_notification_job(uuid)                            to authenticated;
grant execute on function public.register_pos_device(uuid, text, text, text)             to authenticated;
grant execute on function public.send_invoice_notification(uuid, text, text)             to authenticated;
grant execute on function public.cancel_sales_invoice(uuid, text)                        to authenticated;
grant execute on function public.create_credit_note(uuid, jsonb, text, boolean, text)    to authenticated;
grant execute on function public.record_sale_collection(uuid, text, bigint, text)        to authenticated;
grant execute on function public.set_invoice_public_link(uuid, boolean)                  to authenticated;
grant execute on function public.dashboard_summary(uuid, uuid, date, date)               to authenticated;
grant execute on function public.report_sales_register(uuid, uuid, date, date)           to authenticated;
grant execute on function public.report_item_sales(uuid, uuid, date, date)               to authenticated;
grant execute on function public.report_hsn_summary(uuid, uuid, date, date)              to authenticated;
grant execute on function public.report_purchase_register(uuid, uuid, date, date)        to authenticated;
grant execute on function public.report_stock_summary(uuid, uuid)                        to authenticated;
grant execute on function public.report_stock_movements(uuid, uuid, date, date)          to authenticated;
grant execute on function public.report_payment_modes(uuid, uuid, date, date)            to authenticated;
grant execute on function public.report_shipments(uuid, uuid, date, date)                to authenticated;
grant execute on function public.report_credit_notes(uuid, uuid, date, date)             to authenticated;
grant execute on function public.vendor_payables(uuid)                                   to authenticated;

-- Server-only (service role): post_sales_invoice, save_purchase_bill,
-- accept_invitation, claim_notification_jobs, complete_notification_job,
-- check_rate_limit and all internal helpers.
