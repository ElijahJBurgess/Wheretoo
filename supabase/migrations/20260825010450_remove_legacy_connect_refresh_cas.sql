create or replace function private.persist_connect_status_if_current(
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
      last_sync_sequence = p_refresh_sequence
  where accounts.organizer_id = v_account.organizer_id;

  update private.connect_refresh_tokens as tokens
  set persistence_result = 'updated',
      result_synced_at = v_synced_at,
      completed_at = v_synced_at
  where tokens.refresh_sequence = p_refresh_sequence;

  return query select 'updated'::text, v_synced_at;
end;
$$;

drop function public.server_persist_connect_status_if_current(
  text, timestamptz, text, text, text, text, integer, integer, text
);
drop function private.persist_connect_status_if_current(
  text, timestamptz, text, text, text, text, integer, integer, text
);

alter table public.organizer_stripe_accounts
  drop column last_sync_revision;
