create index orders_checkout_reservation_expiry_idx
on public.orders (reservation_expires_at)
where status in ('creating_checkout', 'checkout_open');

create or replace function private.reserve_checkout(
  p_event_id uuid,
  p_tier_id uuid,
  p_name text,
  p_email text,
  p_client_request_id uuid,
  p_confirmation_token_hash text
)
returns table (
  order_id uuid,
  organizer_id uuid,
  subtotal_minor bigint,
  currency text,
  application_fee_amount_minor bigint,
  stripe_account_id text,
  checkout_expires_at timestamptz,
  existing_checkout_session_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_name text := btrim(p_name);
  v_email text := lower(btrim(p_email));
  v_tier public.ticket_tiers;
  v_event public.events;
  v_connect public.organizer_stripe_accounts;
  v_fee_rule public.platform_fee_rules;
  v_existing public.orders;
  v_existing_tier_id uuid;
  v_reserved_quantity bigint;
  v_order_id uuid;
  v_checkout_expires_at timestamptz;
  v_platform_product_fee_minor bigint;
  v_stripe_fee_estimate_minor bigint;
  v_application_fee_amount_minor bigint;
begin
  if p_event_id is null
    or p_tier_id is null
    or p_client_request_id is null
    or v_name is null
    or char_length(v_name) not between 1 and 120
    or v_email is null
    or char_length(v_email) not between 3 and 320
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
    or p_confirmation_token_hash is null
    or p_confirmation_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = 'P0001', message = 'CHECKOUT_INPUT_INVALID';
  end if;

  -- This is the first transaction lock. All event ticketing operations share it.
  perform public.lock_event_ticketing_operation(p_event_id);

  select tiers.* into v_tier
  from public.ticket_tiers as tiers
  where tiers.id = p_tier_id
  for update;

  select events.* into v_event
  from public.events as events
  where events.id = p_event_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  if v_event.status is distinct from 'published'
    or v_event.admission_type is distinct from 'paid'
    or v_event.moderation_status not in ('clear', 'flagged')
    or v_event.starts_at is null
    or v_event.starts_at <= v_now
    or v_event.ends_at is null
    or v_event.ends_at <= v_event.starts_at then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_SELLABLE';
  end if;

  if v_tier.id is null or v_tier.event_id is distinct from p_event_id then
    raise exception using errcode = 'P0001', message = 'TIER_NOT_FOUND';
  end if;

  if v_tier.status is distinct from 'active'
    or v_tier.currency is distinct from 'usd' then
    raise exception using errcode = 'P0001', message = 'TIER_NOT_ACTIVE';
  end if;

  select accounts.* into v_connect
  from public.organizer_stripe_accounts as accounts
  where accounts.organizer_id = v_event.organizer_id
    and accounts.livemode = false
  for share;

  if not found
    or v_connect.last_synced_at < v_now - interval '5 minutes'
    or v_connect.transfers_status <> 'active'
    or v_connect.payouts_status <> 'active' then
    raise exception using errcode = 'P0001', message = 'CONNECT_NOT_READY';
  end if;

  if v_connect.requirements_status <> 'clear'
    or v_connect.requirements_currently_due_count <> 0
    or v_connect.requirements_past_due_count <> 0 then
    raise exception using errcode = 'P0001', message = 'CONNECT_ACTION_REQUIRED';
  end if;

  select fee_rules.* into v_fee_rule
  from public.platform_fee_rules as fee_rules
  where fee_rules.livemode = false
    and fee_rules.currency = v_tier.currency
    and fee_rules.effective_from <= v_now
    and (fee_rules.effective_until is null or fee_rules.effective_until > v_now)
  order by fee_rules.effective_from desc
  limit 1
  for share;

  if not found then
    raise exception using errcode = 'P0001', message = 'FEE_RULE_NOT_CONFIGURED';
  end if;

  select orders.* into v_existing
  from public.orders as orders
  where orders.organizer_id = v_event.organizer_id
    and orders.event_id = p_event_id
    and orders.client_request_id = p_client_request_id
  for update;

  if found then
    select items.ticket_tier_id into v_existing_tier_id
    from public.order_items as items
    where items.order_id = v_existing.id;

    if v_existing_tier_id is distinct from p_tier_id
      or v_existing.buyer_name is distinct from v_name
      or v_existing.buyer_email is distinct from v_email
      or v_existing.confirmation_token_hash is distinct from p_confirmation_token_hash then
      raise exception using errcode = 'P0001', message = 'CHECKOUT_ALREADY_EXISTS';
    end if;

    if v_existing.status in ('creating_checkout', 'checkout_open')
      and v_existing.reservation_expires_at <= v_now then
      update public.orders as orders
      set status = 'expired',
          expired_at = coalesce(orders.expired_at, v_now),
          failure_code = coalesce(orders.failure_code, 'CHECKOUT_EXPIRED')
      where orders.id = v_existing.id;
      return;
    end if;

    if v_existing.status in ('expired', 'payment_failed', 'cancelled') then
      return;
    end if;

    if v_existing.status = 'requires_review' then
      raise exception using errcode = 'P0001', message = 'ORDER_REQUIRES_REVIEW';
    end if;

    return query
    select
      v_existing.id,
      v_existing.organizer_id,
      v_existing.subtotal_minor,
      v_existing.currency,
      v_existing.application_fee_amount_minor,
      v_connect.stripe_account_id,
      v_existing.checkout_expires_at,
      v_existing.stripe_checkout_session_id;
    return;
  end if;

  update public.orders as orders
  set status = 'expired',
      expired_at = coalesce(orders.expired_at, v_now),
      failure_code = coalesce(orders.failure_code, 'CHECKOUT_EXPIRED')
  where orders.id in (
    select items.order_id
    from public.order_items as items
    where items.ticket_tier_id = p_tier_id
  )
    and orders.status in ('creating_checkout', 'checkout_open')
    and orders.reservation_expires_at <= v_now;

  select coalesce(sum(items.quantity), 0)::bigint into v_reserved_quantity
  from public.order_items as items
  join public.orders as orders on orders.id = items.order_id
  where items.ticket_tier_id = p_tier_id
    and (
      orders.status in ('paid', 'payment_processing')
      or (
        orders.status in ('creating_checkout', 'checkout_open')
        and orders.reservation_expires_at > v_now
      )
    );

  if v_reserved_quantity >= v_tier.quantity_total then
    raise exception using errcode = 'P0001', message = 'TIER_SOLD_OUT';
  end if;

  v_platform_product_fee_minor :=
    floor(
      v_tier.unit_amount_minor::numeric
      * v_fee_rule.platform_percent_bps::numeric
      / 10000::numeric
    )::bigint
    + v_fee_rule.platform_fixed_minor;

  v_stripe_fee_estimate_minor := case
    when v_fee_rule.processing_fee_treatment = 'stripe_fee_estimate' then
      floor(
        v_tier.unit_amount_minor::numeric
        * v_fee_rule.processing_estimate_percent_bps::numeric
        / 10000::numeric
      )::bigint
      + v_fee_rule.processing_estimate_fixed_minor
    else 0
  end;

  v_application_fee_amount_minor :=
    v_platform_product_fee_minor + v_stripe_fee_estimate_minor;

  if v_application_fee_amount_minor >= v_tier.unit_amount_minor then
    raise exception using errcode = 'P0001', message = 'CHECKOUT_CREATION_FAILED';
  end if;

  v_order_id := gen_random_uuid();
  v_checkout_expires_at := v_now + interval '30 minutes';

  insert into public.orders (
    id,
    order_number,
    event_id,
    organizer_id,
    livemode,
    status,
    checkout_expires_at,
    reservation_expires_at,
    buyer_name,
    buyer_email,
    client_request_id,
    confirmation_token_hash,
    quantity,
    currency,
    subtotal_minor,
    tax_amount_minor,
    total_minor,
    platform_product_fee_minor,
    stripe_fee_estimate_minor,
    application_fee_amount_minor,
    expected_organizer_proceeds_minor,
    fee_rule_id,
    platform_percent_bps,
    platform_fixed_minor,
    processing_fee_treatment,
    processing_estimate_percent_bps,
    processing_estimate_fixed_minor
  )
  values (
    v_order_id,
    'WT-' || upper(replace(v_order_id::text, '-', '')),
    p_event_id,
    v_event.organizer_id,
    false,
    'creating_checkout',
    v_checkout_expires_at,
    v_checkout_expires_at + interval '5 minutes',
    v_name,
    v_email,
    p_client_request_id,
    p_confirmation_token_hash,
    1,
    v_tier.currency,
    v_tier.unit_amount_minor,
    0,
    v_tier.unit_amount_minor,
    v_platform_product_fee_minor,
    v_stripe_fee_estimate_minor,
    v_application_fee_amount_minor,
    v_tier.unit_amount_minor - v_application_fee_amount_minor,
    v_fee_rule.id,
    v_fee_rule.platform_percent_bps,
    v_fee_rule.platform_fixed_minor,
    v_fee_rule.processing_fee_treatment,
    v_fee_rule.processing_estimate_percent_bps,
    v_fee_rule.processing_estimate_fixed_minor
  );

  insert into public.order_items (
    order_id,
    ticket_tier_id,
    tier_version,
    tier_name,
    tier_description,
    unit_amount_minor,
    quantity,
    subtotal_minor,
    currency
  )
  values (
    v_order_id,
    v_tier.id,
    v_tier.version,
    v_tier.name,
    v_tier.description,
    v_tier.unit_amount_minor,
    1,
    v_tier.unit_amount_minor,
    v_tier.currency
  );

  return query
  select
    v_order_id,
    v_event.organizer_id,
    v_tier.unit_amount_minor,
    v_tier.currency,
    v_application_fee_amount_minor,
    v_connect.stripe_account_id,
    v_checkout_expires_at,
    null::text;
end;
$$;

create or replace function public.server_reserve_checkout(
  p_event_id uuid,
  p_tier_id uuid,
  p_name text,
  p_email text,
  p_client_request_id uuid,
  p_confirmation_token_hash text
)
returns table (
  order_id uuid,
  organizer_id uuid,
  subtotal_minor bigint,
  currency text,
  application_fee_amount_minor bigint,
  stripe_account_id text,
  checkout_expires_at timestamptz,
  existing_checkout_session_id text
)
language sql
security definer
set search_path = ''
as $$
  select *
  from private.reserve_checkout(
    p_event_id,
    p_tier_id,
    p_name,
    p_email,
    p_client_request_id,
    p_confirmation_token_hash
  );
$$;

comment on function public.server_reserve_checkout(uuid, uuid, text, text, uuid, text) is
  'Service-only Checkout boundary. The caller derives the 32-byte clear confirmation token as SHA-256 bytes of p_client_request_id::text, URL-safe encodes those bytes for redirect URLs, and passes the lowercase hexadecimal SHA-256 of those bytes as p_confirmation_token_hash. The same request UUID therefore reproduces both values without server state.';

create or replace function public.server_attach_checkout_session(
  p_order_id uuid,
  p_session_id text,
  p_expires_at timestamptz
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.attach_checkout_session(p_order_id, p_session_id, p_expires_at);
$$;

create or replace function public.server_cancel_checkout_reservation(
  p_order_id uuid,
  p_reason text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.cancel_checkout_reservation(p_order_id, p_reason);
$$;

create or replace function public.server_expire_checkout_reservations(p_now timestamptz)
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.expire_checkout_reservations(p_now);
$$;

revoke all on schema private from service_role;

revoke all on function private.reserve_checkout(uuid, uuid, text, text, uuid, text)
from service_role;
revoke all on function private.attach_checkout_session(uuid, text, timestamptz)
from service_role;
revoke all on function private.cancel_checkout_reservation(uuid, text)
from service_role;
revoke all on function private.expire_checkout_reservations(timestamptz)
from service_role;

revoke all on function public.server_reserve_checkout(uuid, uuid, text, text, uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.server_attach_checkout_session(uuid, text, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.server_cancel_checkout_reservation(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.server_expire_checkout_reservations(timestamptz)
from public, anon, authenticated, service_role;

grant execute on function public.server_reserve_checkout(uuid, uuid, text, text, uuid, text)
to service_role;
grant execute on function public.server_attach_checkout_session(uuid, text, timestamptz)
to service_role;
grant execute on function public.server_cancel_checkout_reservation(uuid, text)
to service_role;
grant execute on function public.server_expire_checkout_reservations(timestamptz)
to service_role;
