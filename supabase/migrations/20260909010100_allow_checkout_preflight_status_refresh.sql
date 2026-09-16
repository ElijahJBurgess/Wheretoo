-- Preflight runs before the Edge function refreshes Stripe Connect status.
-- Permit an aged cache here; reservation still requires a fresh, ready account.
create or replace function private.get_checkout_preflight(
  p_event_id uuid,
  p_tier_ids uuid[]
)
returns table (organizer_id uuid, stripe_account_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_event public.events;
  v_account public.organizer_stripe_accounts;
  v_tier_count integer;
begin
  if p_event_id is null
    or p_tier_ids is null
    or cardinality(p_tier_ids) not between 1 and 3
    or exists (select 1 from unnest(p_tier_ids) as tier_id where tier_id is null)
    or cardinality(p_tier_ids) <> cardinality(array(select distinct tier_id from unnest(p_tier_ids) as tier_id)) then
    raise exception using errcode = 'P0001', message = 'CHECKOUT_INPUT_INVALID';
  end if;

  select events.* into v_event
  from public.events as events
  where events.id = p_event_id;
  if not found or v_event.admission_type is distinct from 'paid'
    or not private.event_is_publicly_eligible(p_event_id, v_now) then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_SELLABLE';
  end if;

  select count(*) into v_tier_count
  from public.ticket_tiers as tiers
  where tiers.id = any(p_tier_ids)
    and tiers.event_id = p_event_id
    and tiers.status = 'active'
    and tiers.currency = 'usd';
  if v_tier_count <> cardinality(p_tier_ids) then
    raise exception using errcode = 'P0001', message = 'TIER_NOT_ACTIVE';
  end if;

  select accounts.* into v_account
  from public.organizer_stripe_accounts as accounts
  where accounts.organizer_id = v_event.organizer_id
    and not accounts.livemode;
  if not found
    or v_account.transfers_status <> 'active'
    or v_account.payouts_status <> 'active'
    or v_account.requirements_status <> 'clear'
    or v_account.requirements_currently_due_count <> 0
    or v_account.requirements_past_due_count <> 0 then
    raise exception using errcode = 'P0001', message = 'CONNECT_NOT_READY';
  end if;

  return query select v_event.organizer_id, v_account.stripe_account_id;
end;
$$;

