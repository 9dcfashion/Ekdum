-- ════════════════════════════════════════════════════════════════════════════
-- EkDum · 04 · Notification outbox (email + WhatsApp receipts)
-- ════════════════════════════════════════════════════════════════════════════
-- Transactional outbox: the invoice-posting RPC inserts rows here in the same
-- transaction as the invoice. /api/jobs/notifications claims and sends them.

create table public.notification_jobs (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses (id) on delete cascade,
  channel              text not null check (channel in ('email', 'whatsapp')),
  template             text not null,
  recipient            text not null,
  payload              jsonb not null default '{}'::jsonb,
  related_table        text,
  related_id           uuid,
  status               text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts             integer not null default 0,
  next_attempt_at      timestamptz not null default now(),
  locked_at            timestamptz,
  last_error           text,
  provider_message_id  text,
  sent_at              timestamptz,
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index notification_jobs_due_idx on public.notification_jobs (next_attempt_at) where status = 'queued';
create index notification_jobs_business_idx on public.notification_jobs (business_id, created_at desc);
create index notification_jobs_related_idx on public.notification_jobs (related_table, related_id);
create index notification_jobs_failed_idx on public.notification_jobs (business_id) where status = 'failed';
create trigger notification_jobs_set_updated_at before update on public.notification_jobs
  for each row execute function public.set_updated_at();

-- Server-only. Claim up to p_limit due jobs. SKIP LOCKED lets several workers run safely.
-- Jobs stuck in 'sending' for over 10 minutes (a crashed worker) are picked up again.
create or replace function public.claim_notification_jobs(p_limit integer default 20)
returns setof public.notification_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with due as (
    select j.id
    from public.notification_jobs j
    where (j.status = 'queued' and j.next_attempt_at <= now())
       or (j.status = 'sending' and j.locked_at < now() - interval '10 minutes')
    order by j.next_attempt_at
    limit greatest(1, least(p_limit, 100))
    for update skip locked
  )
  update public.notification_jobs j
  set status = 'sending', attempts = j.attempts + 1, locked_at = now()
  from due
  where j.id = due.id
  returning j.*;
end;
$$;

-- Server-only. Record the outcome of a send attempt.
-- Failure → retry with exponential backoff (2, 4, 8, 16 minutes); give up after 5 attempts.
create or replace function public.complete_notification_job(
  p_job_id uuid,
  p_success boolean,
  p_provider_message_id text default null,
  p_error text default null,
  p_permanent boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_max_attempts constant integer := 5;
begin
  if p_success then
    update public.notification_jobs
    set status = 'sent', sent_at = now(), locked_at = null, last_error = null,
        provider_message_id = p_provider_message_id
    where id = p_job_id;
  else
    update public.notification_jobs
    set status = case when p_permanent or attempts >= v_max_attempts then 'failed' else 'queued' end,
        next_attempt_at = now() + (power(2, attempts) * interval '1 minute'),
        locked_at = null,
        last_error = left(coalesce(p_error, 'Unknown error'), 1000)
    where id = p_job_id;
  end if;
end;
$$;

-- Put a failed (or stuck) job back in the queue.
create or replace function public.retry_notification_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.notification_jobs;
begin
  select * into v_job from public.notification_jobs where id = p_job_id for update;
  if not found
     or not (public.has_perm(v_job.business_id, 'sales.view_all') or public.has_perm(v_job.business_id, 'sales.create')) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_job.status = 'sending' and v_job.locked_at > now() - interval '10 minutes' then
    raise exception 'This message is being sent right now';
  end if;
  update public.notification_jobs
  set status = 'queued', attempts = 0, next_attempt_at = now(), locked_at = null, last_error = null
  where id = p_job_id;
end;
$$;

alter table public.notification_jobs enable row level security;

create policy notification_jobs_select on public.notification_jobs for select to authenticated
  using (
    public.has_perm(business_id, 'sales.view_all')
    or (public.has_perm(business_id, 'sales.view_own') and created_by = (select auth.uid()))
  );
