-- ════════════════════════════════════════════════════════════════════════════
-- EkDum · 11 · Photos of the goods handed over on a bill
-- ════════════════════════════════════════════════════════════════════════════
-- Optional proof photos attached to a sales invoice (what was given to the
-- customer), mainly for manual items that are not in the product list.
-- Stored in their own table so posted invoices stay immutable. Rows are
-- append-only; only owners and managers (sales.cancel) can remove a photo,
-- and every removal is written to the audit log.
-- Object path: sale-photos/{business_id}/{invoice_id}/{file}

create table public.sales_invoice_photos (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  invoice_id    uuid not null references public.sales_invoices (id) on delete cascade,
  storage_path  text not null unique,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint sales_invoice_photos_path_scoped check (
    storage_path like business_id::text || '/' || invoice_id::text || '/%'
    and length(storage_path) <= 300
  )
);

create index sales_invoice_photos_invoice_idx on public.sales_invoice_photos (invoice_id, created_at);
create index sales_invoice_photos_business_idx on public.sales_invoice_photos (business_id);

-- The invoice must belong to the business, and a bill holds at most 10 photos.
create or replace function public.guard_sales_invoice_photos()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Bill photos cannot be changed. Remove the photo and add it again.';
  end if;

  if tg_op = 'DELETE' then
    if exists (select 1 from public.businesses b where b.id = old.business_id) then
      perform public.write_audit(old.business_id, auth.uid(), 'sale.photo_removed', 'sales_invoices', old.invoice_id,
        jsonb_build_object('storage_path', old.storage_path, 'added_by', old.created_by, 'added_at', old.created_at), null);
    end if;
    return old;
  end if;

  if not exists (
    select 1 from public.sales_invoices i where i.id = new.invoice_id and i.business_id = new.business_id
  ) then
    raise exception 'Bill not found';
  end if;
  if (select count(*) from public.sales_invoice_photos p where p.invoice_id = new.invoice_id) >= 10 then
    raise exception 'A bill can have at most 10 photos';
  end if;
  return new;
end;
$$;

create trigger sales_invoice_photos_guard before insert or update or delete on public.sales_invoice_photos
  for each row execute function public.guard_sales_invoice_photos();

-- New functions are executable by PUBLIC by default; trigger functions never need to be.
revoke execute on function public.guard_sales_invoice_photos() from public, anon, authenticated;

-- ── Row Level Security ──────────────────────────────────────────────────────

alter table public.sales_invoice_photos enable row level security;

-- Visible exactly when the bill itself is visible (RLS on sales_invoices applies in the subquery).
create policy sales_invoice_photos_select on public.sales_invoice_photos for select to authenticated
  using (exists (select 1 from public.sales_invoices i where i.id = invoice_id));

-- Anyone who can bill may add photos to a bill they can see (a cashier: only their own bills).
create policy sales_invoice_photos_insert on public.sales_invoice_photos for insert to authenticated
  with check (
    public.has_perm(business_id, 'sales.create')
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.sales_invoices i
      where i.id = invoice_id and i.business_id = sales_invoice_photos.business_id and i.status = 'posted'
    )
  );

create policy sales_invoice_photos_delete on public.sales_invoice_photos for delete to authenticated
  using (public.has_perm(business_id, 'sales.cancel') and exists (select 1 from public.sales_invoices i where i.id = invoice_id));

-- Supabase grants ALL on new tables to anon and authenticated by default, and
-- TRUNCATE ignores RLS. Start from nothing, then grant only what the policies cover.
revoke all on public.sales_invoice_photos from public, anon, authenticated;
grant select, insert, delete on public.sales_invoice_photos to authenticated;
grant all on public.sales_invoice_photos to service_role;

-- ── Storage ─────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('sale-photos', 'sale-photos', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Path segment n (1-based) as a uuid, or null when it is not one.
create or replace function public.storage_uuid_segment(p_name text, p_index integer)
returns uuid
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  return split_part(p_name, '/', p_index)::uuid;
exception when others then
  return null;
end;
$$;

revoke execute on function public.storage_uuid_segment(text, integer) from public, anon;
grant execute on function public.storage_uuid_segment(text, integer) to authenticated;

-- Read: when the bill in the path is visible to the user.
create policy ekdum_sale_photos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'sale-photos'
    and exists (
      select 1 from public.sales_invoices i
      where i.id = public.storage_uuid_segment(name, 2) and i.business_id = public.storage_uuid_segment(name, 1)
    )
  );

-- Upload: needs sales.create and a visible, posted bill in the path.
create policy ekdum_sale_photos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'sale-photos'
    and public.has_perm(public.storage_uuid_segment(name, 1), 'sales.create')
    and exists (
      select 1 from public.sales_invoices i
      where i.id = public.storage_uuid_segment(name, 2) and i.business_id = public.storage_uuid_segment(name, 1)
        and i.status = 'posted'
    )
  );

-- Delete: owners and managers only, matching the table policy.
create policy ekdum_sale_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'sale-photos' and public.has_perm(public.storage_uuid_segment(name, 1), 'sales.cancel'));
