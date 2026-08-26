create sequence private.connect_refresh_sequence as bigint start with 1 increment by 1;

alter table public.organizer_stripe_accounts
  add column last_sync_sequence bigint not null default 0,
  add constraint organizer_stripe_accounts_last_sync_sequence_check check (
    last_sync_sequence >= 0
  );

create table private.connect_refresh_tokens (
  refresh_sequence bigint primary key
    default nextval('private.connect_refresh_sequence'::regclass),
  stripe_account_id text not null references public.organizer_stripe_accounts (
    stripe_account_id
  ) on delete cascade,
  begun_at timestamptz not null default clock_timestamp(),
  persistence_result text,
  result_synced_at timestamptz,
  completed_at timestamptz,
  constraint connect_refresh_tokens_account_check check (
    stripe_account_id ~ '^acct_[A-Za-z0-9]+$'
  ),
  constraint connect_refresh_tokens_result_check check (
    (persistence_result is null and result_synced_at is null and completed_at is null)
    or (
      persistence_result in ('updated', 'stale')
      and result_synced_at is not null
      and completed_at is not null
    )
  )
);

create index connect_refresh_tokens_account_begun_idx
on private.connect_refresh_tokens (stripe_account_id, begun_at desc);

create function private.begin_connect_refresh(p_stripe_account_id text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_refresh_sequence bigint;
begin
  if p_stripe_account_id is null
    or p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$' then
    raise exception using errcode = 'P0001', message = 'CONNECT_REFRESH_INVALID';
  end if;

  if not exists (
    select 1
    from public.organizer_stripe_accounts as accounts
    where accounts.stripe_account_id = p_stripe_account_id
      and accounts.livemode = false
  ) then
    raise exception using errcode = 'P0001', message = 'CONNECT_ACCOUNT_NOT_FOUND';
  end if;

  insert into private.connect_refresh_tokens (stripe_account_id)
  values (p_stripe_account_id)
  returning refresh_sequence into v_refresh_sequence;

  return v_refresh_sequence;
end;
$$;

create function public.server_begin_connect_refresh(p_stripe_account_id text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select private.begin_connect_refresh(p_stripe_account_id);
$$;

create function private.persist_connect_status_if_current(
  p_stripe_account_id text,
  p_refresh_sequence bigint,
  p_transfers_status text,
  p_payouts_status text,
  p_requirements_status text,
  p_currently_due_count integer,
  p_past_due_count integer,
  p_last_status_code text
)
returns table (persistence_result text, last_synced_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.organizer_stripe_accounts;
  v_token private.connect_refresh_tokens;
  v_synced_at timestamptz;
begin
  if p_stripe_account_id is null
    or p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$'
    or p_refresh_sequence is null or p_refresh_sequence <= 0
    or p_transfers_status not in ('inactive', 'pending', 'active', 'restricted')
    or p_payouts_status not in ('inactive', 'pending', 'active', 'restricted')
    or p_requirements_status not in (
      'not_started', 'pending', 'action_required', 'restricted', 'clear'
    )
    or p_currently_due_count is null or p_currently_due_count < 0
    or p_past_due_count is null or p_past_due_count < 0
    or (
      p_last_status_code is not null
      and p_last_status_code !~ '^[A-Z][A-Z0-9_]{0,254}$'
    ) then
    raise exception using errcode = 'P0001', message = 'CONNECT_STATUS_INVALID';
  end if;

  select tokens.* into v_token
  from private.connect_refresh_tokens as tokens
  where tokens.refresh_sequence = p_refresh_sequence
    and tokens.stripe_account_id = p_stripe_account_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'CONNECT_REFRESH_INVALID';
  end if;

  if v_token.persistence_result is not null then
    return query select v_token.persistence_result, v_token.result_synced_at;
    return;
  end if;

  select accounts.* into v_account
  from public.organizer_stripe_accounts as accounts
  where accounts.stripe_account_id = p_stripe_account_id
    and accounts.livemode = false
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'CONNECT_ACCOUNT_NOT_FOUND';
  end if;

  if v_account.last_sync_sequence > p_refresh_sequence then
    update private.connect_refresh_tokens as tokens
    set persistence_result = 'stale',
        result_synced_at = v_account.last_synced_at,
        completed_at = clock_timestamp()
    where tokens.refresh_sequence = p_refresh_sequence;
    return query select 'stale'::text, v_account.last_synced_at;
    return;
  end if;

  v_synced_at := clock_timestamp();
  update public.organizer_stripe_accounts as accounts
  set transfers_status = p_transfers_status,
      payouts_status = p_payouts_status,
      requirements_status = p_requirements_status,
      requirements_currently_due_count = p_currently_due_count,
      requirements_past_due_count = p_past_due_count,
      last_status_code = p_last_status_code,
      last_synced_at = v_synced_at,
      last_sync_sequence = p_refresh_sequence,
      last_sync_revision = null
  where accounts.organizer_id = v_account.organizer_id;

  update private.connect_refresh_tokens as tokens
  set persistence_result = 'updated',
      result_synced_at = v_synced_at,
      completed_at = v_synced_at
  where tokens.refresh_sequence = p_refresh_sequence;

  return query select 'updated'::text, v_synced_at;
end;
$$;

create function public.server_persist_connect_status_if_current(
  p_stripe_account_id text,
  p_refresh_sequence bigint,
  p_transfers_status text,
  p_payouts_status text,
  p_requirements_status text,
  p_currently_due_count integer,
  p_past_due_count integer,
  p_last_status_code text
)
returns table (persistence_result text, last_synced_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select * from private.persist_connect_status_if_current(
    p_stripe_account_id, p_refresh_sequence, p_transfers_status,
    p_payouts_status, p_requirements_status, p_currently_due_count,
    p_past_due_count, p_last_status_code
  );
$$;

revoke all on sequence private.connect_refresh_sequence
from public, anon, authenticated, service_role;
revoke all on table private.connect_refresh_tokens
from public, anon, authenticated, service_role;
revoke all on function private.begin_connect_refresh(text)
from public, anon, authenticated, service_role;
revoke all on function private.persist_connect_status_if_current(
  text, bigint, text, text, text, integer, integer, text
) from public, anon, authenticated, service_role;
revoke all on function public.server_begin_connect_refresh(text)
from public, anon, authenticated, service_role;
revoke all on function public.server_persist_connect_status_if_current(
  text, bigint, text, text, text, integer, integer, text
) from public, anon, authenticated, service_role;

grant execute on function public.server_begin_connect_refresh(text)
to service_role;
grant execute on function public.server_persist_connect_status_if_current(
  text, bigint, text, text, text, integer, integer, text
) to service_role;
