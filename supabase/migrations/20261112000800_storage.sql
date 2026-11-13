-- ════════════════════════════════════════════════════════════════════════════
-- EkDum · 08 · Storage buckets and policies
-- ════════════════════════════════════════════════════════════════════════════
-- Every object path starts with "{business_id}/". Policies check membership
-- and permission for that business.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('logos', 'logos', true, 1048576, array['image/png', 'image/jpeg', 'image/webp']),
  ('purchase-attachments', 'purchase-attachments', false, 10485760,
     array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']),
  ('shipment-receipts', 'shipment-receipts', false, 5242880, array['image/png', 'image/jpeg', 'image/webp']),
  ('invoice-pdfs', 'invoice-pdfs', false, 5242880, array['application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- First path segment as a business id (null when it is not a uuid).
create or replace function public.storage_business_id(p_name text)
returns uuid
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;

-- logos: public read (bucket is public); only settings managers can write.
create policy ekdum_logos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'logos' and public.has_perm(public.storage_business_id(name), 'settings.manage'));
create policy ekdum_logos_update on storage.objects for update to authenticated
  using (bucket_id = 'logos' and public.has_perm(public.storage_business_id(name), 'settings.manage'))
  with check (bucket_id = 'logos' and public.has_perm(public.storage_business_id(name), 'settings.manage'));
create policy ekdum_logos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'logos' and public.has_perm(public.storage_business_id(name), 'settings.manage'));
create policy ekdum_logos_select on storage.objects for select to authenticated
  using (bucket_id = 'logos' and public.is_member(public.storage_business_id(name)));

-- purchase-attachments: private.
create policy ekdum_purchase_attachments_select on storage.objects for select to authenticated
  using (bucket_id = 'purchase-attachments' and public.has_perm(public.storage_business_id(name), 'purchases.view'));
create policy ekdum_purchase_attachments_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'purchase-attachments' and public.has_perm(public.storage_business_id(name), 'purchases.create'));
create policy ekdum_purchase_attachments_delete on storage.objects for delete to authenticated
  using (bucket_id = 'purchase-attachments' and public.has_perm(public.storage_business_id(name), 'purchases.create'));

-- shipment-receipts: private.
create policy ekdum_shipment_receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'shipment-receipts' and public.has_perm(public.storage_business_id(name), 'shipments.view'));
create policy ekdum_shipment_receipts_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'shipment-receipts'
    and (public.has_perm(public.storage_business_id(name), 'shipments.create')
         or public.has_perm(public.storage_business_id(name), 'shipments.update'))
  );
create policy ekdum_shipment_receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'shipment-receipts' and public.has_perm(public.storage_business_id(name), 'shipments.update'));

-- invoice-pdfs: no client policies. Only the server (service role) reads and
-- writes it, and serves files through signed URLs or the public-token route.
