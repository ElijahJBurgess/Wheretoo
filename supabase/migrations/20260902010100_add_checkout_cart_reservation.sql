create or replace function private.calculate_checkout_money(
  p_subtotal_minor bigint,
  p_quantity integer,
  p_platform_percent_bps integer,
  p_platform_fixed_minor bigint,
  p_processing_fee_treatment text,
  p_processing_estimate_percent_bps integer,
  p_processing_estimate_fixed_minor bigint
)
returns table (
  subtotal_minor bigint,
  platform_product_fee_minor bigint,
  stripe_fee_estimate_minor bigint,
  application_fee_amount_minor bigint,
  expected_organizer_proceeds_minor bigint,
  total_minor bigint
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_platform_product_fee_minor bigint;
  v_stripe_fee_estimate_minor bigint;
  v_application_fee_amount_minor bigint;
begin
  if p_subtotal_minor <= 0
    or p_quantity not between 1 and 10
    or p_platform_percent_bps not between 0 and 10000
    or p_platform_fixed_minor < 0
    or p_processing_fee_treatment not in ('stripe_fee_estimate', 'platform_fee_only')
    or (
      p_processing_fee_treatment = 'stripe_fee_estimate'
      and (p_processing_estimate_percent_bps not between 0 and 10000
        or p_processing_estimate_fixed_minor < 0)
    )
    or (
      p_processing_fee_treatment = 'platform_fee_only'
      and (p_processing_estimate_percent_bps is not null
        or p_processing_estimate_fixed_minor is not null)
    ) then
    raise exception using errcode = 'P0001', message = 'CHECKOUT_INPUT_INVALID';
  end if;

  v_platform_product_fee_minor :=
    floor(p_subtotal_minor::numeric * p_platform_percent_bps::numeric / 10000::numeric)::bigint
    + p_platform_fixed_minor * p_quantity;
  v_stripe_fee_estimate_minor := case
    when p_processing_fee_treatment = 'stripe_fee_estimate' then
      floor(
        p_subtotal_minor::numeric * p_processing_estimate_percent_bps::numeric / 10000::numeric
      )::bigint + p_processing_estimate_fixed_minor
    else 0
  end;
  v_application_fee_amount_minor :=
    v_platform_product_fee_minor + v_stripe_fee_estimate_minor;

  return query select
    p_subtotal_minor,
    v_platform_product_fee_minor,
    v_stripe_fee_estimate_minor,
    v_application_fee_amount_minor,
    p_subtotal_minor - v_application_fee_amount_minor,
    p_subtotal_minor;
end;
$$;

create or replace function private.checkout_cart_request_digest(
  p_order_id uuid,
  p_event_id uuid,
  p_client_request_id uuid,
  p_confirmation_token_hash text,
  p_buyer_email text,
  p_currency text,
  p_subtotal_minor bigint,
  p_application_fee_amount_minor bigint,
  p_destination_account_id text,
  p_checkout_expires_at timestamptz,
  p_integration_identifier text,
  p_order_items jsonb
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(
    extensions.digest(
      concat_ws(
        chr(31),
        'whereto-checkout-cart-v1',
        p_order_id::text,
        p_event_id::text,
        p_client_request_id::text,
        p_confirmation_token_hash,
        p_buyer_email,
        p_currency,
        p_subtotal_minor::text,
        p_application_fee_amount_minor::text,
        p_destination_account_id,
        extract(epoch from p_checkout_expires_at)::bigint::text,
        p_integration_identifier,
        p_order_items::text
      ),
      'sha256'
    ),
    'hex'
  );
$$;

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
    or v_account.last_synced_at < v_now - interval '5 minutes'
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

create or replace function public.server_get_checkout_preflight(
  p_event_id uuid,
  p_tier_ids uuid[]
)
returns table (organizer_id uuid, stripe_account_id text)
language sql
security definer
set search_path = ''
as $$ select * from private.get_checkout_preflight(p_event_id, p_tier_ids); $$;

create or replace function private.reserve_checkout(
  p_event_id uuid,
  p_items jsonb,
  p_name text,
  p_email text,
  p_client_request_id uuid,
  p_confirmation_token_hash text
)
returns table (
  order_id uuid,
  organizer_id uuid,
  quantity integer,
  subtotal_minor bigint,
  currency text,
  platform_product_fee_minor bigint,
  stripe_fee_estimate_minor bigint,
  application_fee_amount_minor bigint,
  expected_organizer_proceeds_minor bigint,
  total_minor bigint,
  stripe_account_id text,
  checkout_expires_at timestamptz,
  existing_checkout_session_id text,
  integration_identifier text,
  create_request_digest text,
  order_items jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_name text := btrim(p_name);
  v_email text := lower(btrim(p_email));
  v_item jsonb;
  v_tier_id uuid;
  v_item_quantity integer;
  v_checkout_creation_enabled boolean;
  v_total_quantity integer := 0;
  v_tier_ids uuid[] := array[]::uuid[];
  v_quantities integer[] := array[]::integer[];
  v_canonical_items jsonb;
  v_event public.events;
  v_account public.organizer_stripe_accounts;
  v_fee_rule public.platform_fee_rules;
  v_existing public.orders;
  v_locked_tier_count integer;
  v_currency text;
  v_subtotal_minor bigint;
  v_platform_product_fee_minor bigint;
  v_stripe_fee_estimate_minor bigint;
  v_application_fee_amount_minor bigint;
  v_expected_organizer_proceeds_minor bigint;
  v_total_minor bigint;
  v_order_id uuid;
  v_order_items jsonb;
begin
  if p_event_id is null
    or p_client_request_id is null
    or jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_items) not between 1 and 3
    or v_name is null or char_length(v_name) not between 1 and 120
    or v_email is null or char_length(v_email) not between 3 and 320
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
    or p_confirmation_token_hash is null
    or p_confirmation_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = 'P0001', message = 'CHECKOUT_INPUT_INVALID';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or jsonb_object_length(v_item) <> 2
      or not (v_item ? 'tier_id' and v_item ? 'quantity')
      or jsonb_typeof(v_item -> 'tier_id') is distinct from 'string'
      or jsonb_typeof(v_item -> 'quantity') is distinct from 'number'
      or (v_item ->> 'quantity') !~ '^[1-9][0-9]*$' then
      raise exception using errcode = 'P0001', message = 'CHECKOUT_INPUT_INVALID';
    end if;
    begin
      v_tier_id := (v_item ->> 'tier_id')::uuid;
      v_item_quantity := (v_item ->> 'quantity')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = 'P0001', message = 'CHECKOUT_INPUT_INVALID';
    end;
    if v_item_quantity not between 1 and 10 or v_tier_id = any(v_tier_ids) then
      raise exception using errcode = 'P0001', message = 'CHECKOUT_INPUT_INVALID';
    end if;
    v_total_quantity := v_total_quantity + v_item_quantity;
    if v_total_quantity > 10 then
      raise exception using errcode = 'P0001', message = 'CHECKOUT_INPUT_INVALID';
    end if;
    v_tier_ids := array_append(v_tier_ids, v_tier_id);
    v_quantities := array_append(v_quantities, v_item_quantity);
  end loop;

  select array_agg(tier_id order by tier_id), array_agg(item_quantity order by tier_id),
    jsonb_agg(jsonb_build_object('tier_id', tier_id, 'quantity', item_quantity) order by tier_id)
  into v_tier_ids, v_quantities, v_canonical_items
  from unnest(v_tier_ids, v_quantities) as requested(tier_id, item_quantity);

  -- The control-row share lock stays held to commit, serializing owner disable
  -- with admission of new carts while exact persisted requests remain resumable.
  select controls.checkout_creation_enabled
  into strict v_checkout_creation_enabled
  from private.checkout_runtime_control as controls
  where controls.singleton
  for share;

  -- Stable hierarchy: event advisory lock -> tier UUIDs -> event -> order.
  perform public.lock_event_ticketing_operation(p_event_id);
  select count(*) into v_locked_tier_count
  from (
    select tiers.id
    from public.ticket_tiers as tiers
    where tiers.id = any(v_tier_ids)
    order by tiers.id
    for update
  ) as locked_tiers;

  select events.* into v_event
  from public.events as events
  where events.id = p_event_id
  for update;

  select orders.* into v_existing
  from public.orders as orders
  where orders.event_id = p_event_id
    and orders.client_request_id = p_client_request_id
  for update;

  if found then
    if v_existing.buyer_name is distinct from v_name
      or v_existing.buyer_email is distinct from v_email
      or v_existing.confirmation_token_hash is distinct from p_confirmation_token_hash
      or (select jsonb_agg(jsonb_build_object('tier_id', items.ticket_tier_id, 'quantity', items.quantity)
          order by items.ticket_tier_id)
          from public.order_items as items where items.order_id = v_existing.id)
         is distinct from v_canonical_items then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    if v_existing.status in ('creating_checkout', 'checkout_open')
      and v_existing.reservation_expires_at <= v_now then
      update public.orders as orders
      set status = 'expired', expired_at = coalesce(orders.expired_at, v_now),
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
    select jsonb_agg(jsonb_build_object(
      'order_item_id', items.id, 'ticket_tier_id', items.ticket_tier_id,
      'tier_name', items.tier_name, 'unit_amount_minor', items.unit_amount_minor,
      'quantity', items.quantity, 'subtotal_minor', items.subtotal_minor,
      'currency', items.currency
    ) order by items.ticket_tier_id) into v_order_items
    from public.order_items as items where items.order_id = v_existing.id;
    return query select v_existing.id, v_existing.organizer_id, v_existing.quantity,
      v_existing.subtotal_minor, v_existing.currency, v_existing.platform_product_fee_minor,
      v_existing.stripe_fee_estimate_minor, v_existing.application_fee_amount_minor,
      v_existing.expected_organizer_proceeds_minor, v_existing.total_minor,
      v_existing.stripe_destination_account_id, v_existing.checkout_expires_at,
      v_existing.stripe_checkout_session_id, v_existing.stripe_checkout_integration_identifier,
      v_existing.stripe_checkout_request_digest, v_order_items;
    return;
  end if;

  if not v_checkout_creation_enabled then
    raise exception using errcode = 'P0001', message = 'CHECKOUT_DISABLED';
  end if;
  if not found or v_event.admission_type is distinct from 'paid'
    or not private.event_is_publicly_eligible(p_event_id, v_now) then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_SELLABLE';
  end if;
  if v_locked_tier_count <> cardinality(v_tier_ids) then
    raise exception using errcode = 'P0001', message = 'TIER_NOT_FOUND';
  end if;
  if exists (
    select 1 from public.ticket_tiers as tiers
    where tiers.id = any(v_tier_ids)
      and (tiers.event_id is distinct from p_event_id or tiers.status is distinct from 'active')
  ) then
    raise exception using errcode = 'P0001', message = 'TIER_NOT_ACTIVE';
  end if;
  select min(tiers.currency), sum(tiers.unit_amount_minor * requested.item_quantity)::bigint
  into v_currency, v_subtotal_minor
  from public.ticket_tiers as tiers
  join unnest(v_tier_ids, v_quantities) as requested(tier_id, item_quantity)
    on requested.tier_id = tiers.id;
  if v_currency is distinct from 'usd' or exists (
    select 1 from public.ticket_tiers as tiers where tiers.id = any(v_tier_ids)
      and tiers.currency is distinct from v_currency
  ) then
    raise exception using errcode = 'P0001', message = 'TIER_NOT_ACTIVE';
  end if;

  select accounts.* into v_account
  from public.organizer_stripe_accounts as accounts
  where accounts.organizer_id = v_event.organizer_id and not accounts.livemode
  for share;
  if not found
    or v_account.last_synced_at < v_now - interval '5 minutes'
    or v_account.transfers_status <> 'active'
    or v_account.payouts_status <> 'active' then
    raise exception using errcode = 'P0001', message = 'CONNECT_NOT_READY';
  end if;
  if v_account.requirements_status <> 'clear'
    or v_account.requirements_currently_due_count <> 0
    or v_account.requirements_past_due_count <> 0 then
    raise exception using errcode = 'P0001', message = 'CONNECT_ACTION_REQUIRED';
  end if;
  select fee_rules.* into v_fee_rule
  from public.platform_fee_rules as fee_rules
  where not fee_rules.livemode and fee_rules.currency = v_currency
    and fee_rules.effective_from <= v_now
    and (fee_rules.effective_until is null or fee_rules.effective_until > v_now)
  order by fee_rules.effective_from desc limit 1 for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'FEE_RULE_NOT_CONFIGURED';
  end if;

  update public.orders as orders
  set status = 'expired', expired_at = coalesce(orders.expired_at, v_now),
      failure_code = coalesce(orders.failure_code, 'CHECKOUT_EXPIRED')
  where orders.status in ('creating_checkout', 'checkout_open')
    and orders.reservation_expires_at <= v_now
    and exists (
      select 1 from public.order_items as items
      where items.order_id = orders.id and items.ticket_tier_id = any(v_tier_ids)
    );
  if exists (
    select 1
    from public.ticket_tiers as tiers
    join unnest(v_tier_ids, v_quantities) as requested(tier_id, item_quantity)
      on requested.tier_id = tiers.id
    left join public.order_items as items on items.ticket_tier_id = tiers.id
    left join public.orders as orders on orders.id = items.order_id
    group by tiers.id, tiers.quantity_total, requested.item_quantity
    having coalesce(sum(items.quantity) filter (
      where orders.status in ('paid', 'payment_processing', 'requires_review', 'partially_refunded')
        or (orders.status in ('creating_checkout', 'checkout_open')
          and orders.reservation_expires_at > v_now)
    ), 0)::bigint + requested.item_quantity > tiers.quantity_total
  ) then
    raise exception using errcode = 'P0001', message = 'TIER_SOLD_OUT';
  end if;

  select money.platform_product_fee_minor, money.stripe_fee_estimate_minor,
    money.application_fee_amount_minor, money.expected_organizer_proceeds_minor,
    money.total_minor
  into v_platform_product_fee_minor, v_stripe_fee_estimate_minor,
    v_application_fee_amount_minor, v_expected_organizer_proceeds_minor, v_total_minor
  from private.calculate_checkout_money(
    v_subtotal_minor, v_total_quantity, v_fee_rule.platform_percent_bps,
    v_fee_rule.platform_fixed_minor, v_fee_rule.processing_fee_treatment,
    v_fee_rule.processing_estimate_percent_bps, v_fee_rule.processing_estimate_fixed_minor
  ) as money;
  if v_application_fee_amount_minor >= v_subtotal_minor then
    raise exception using errcode = 'P0001', message = 'CHECKOUT_CREATION_FAILED';
  end if;

  v_order_id := gen_random_uuid();
  insert into public.orders (
    id, order_number, event_id, organizer_id, livemode, status, buyer_name, buyer_email,
    client_request_id, confirmation_token_hash, quantity, currency, subtotal_minor,
    tax_amount_minor, total_minor, platform_product_fee_minor, stripe_fee_estimate_minor,
    application_fee_amount_minor, expected_organizer_proceeds_minor, fee_rule_id,
    platform_percent_bps, platform_fixed_minor, processing_fee_treatment,
    processing_estimate_percent_bps, processing_estimate_fixed_minor
  ) values (
    v_order_id, 'WT-' || upper(replace(v_order_id::text, '-', '')), p_event_id,
    v_event.organizer_id, false, 'creating_checkout', v_name, v_email,
    p_client_request_id, p_confirmation_token_hash, v_total_quantity, v_currency,
    v_subtotal_minor, 0, v_total_minor, v_platform_product_fee_minor,
    v_stripe_fee_estimate_minor, v_application_fee_amount_minor,
    v_expected_organizer_proceeds_minor, v_fee_rule.id, v_fee_rule.platform_percent_bps,
    v_fee_rule.platform_fixed_minor, v_fee_rule.processing_fee_treatment,
    v_fee_rule.processing_estimate_percent_bps, v_fee_rule.processing_estimate_fixed_minor
  );
  insert into public.order_items (
    order_id, ticket_tier_id, tier_version, tier_name, tier_description,
    unit_amount_minor, quantity, subtotal_minor, currency
  )
  select v_order_id, tiers.id, tiers.version, tiers.name, tiers.description,
    tiers.unit_amount_minor, requested.item_quantity,
    tiers.unit_amount_minor * requested.item_quantity, tiers.currency
  from public.ticket_tiers as tiers
  join unnest(v_tier_ids, v_quantities) as requested(tier_id, item_quantity)
    on requested.tier_id = tiers.id
  order by tiers.id;
  if (select count(*) from public.order_items where order_id = v_order_id) <> cardinality(v_tier_ids)
    or (select coalesce(sum(quantity), 0) from public.order_items where order_id = v_order_id) <> v_total_quantity
    or (select coalesce(sum(subtotal_minor), 0) from public.order_items where order_id = v_order_id) <> v_subtotal_minor then
    raise exception using errcode = 'P0001', message = 'CHECKOUT_CREATION_FAILED';
  end if;
  select jsonb_agg(jsonb_build_object(
    'order_item_id', items.id, 'ticket_tier_id', items.ticket_tier_id,
    'tier_name', items.tier_name, 'unit_amount_minor', items.unit_amount_minor,
    'quantity', items.quantity, 'subtotal_minor', items.subtotal_minor,
    'currency', items.currency
  ) order by items.ticket_tier_id) into v_order_items
  from public.order_items as items where items.order_id = v_order_id;
  update public.orders as orders
  set stripe_checkout_request_digest = private.checkout_cart_request_digest(
    orders.id, orders.event_id, orders.client_request_id, orders.confirmation_token_hash,
    orders.buyer_email, orders.currency, orders.subtotal_minor,
    orders.application_fee_amount_minor, orders.stripe_destination_account_id,
    orders.checkout_expires_at, orders.stripe_checkout_integration_identifier, v_order_items
  ) where orders.id = v_order_id;

  return query select orders.id, orders.organizer_id, orders.quantity, orders.subtotal_minor,
    orders.currency, orders.platform_product_fee_minor, orders.stripe_fee_estimate_minor,
    orders.application_fee_amount_minor, orders.expected_organizer_proceeds_minor,
    orders.total_minor, orders.stripe_destination_account_id, orders.checkout_expires_at,
    orders.stripe_checkout_session_id, orders.stripe_checkout_integration_identifier,
    orders.stripe_checkout_request_digest, v_order_items
  from public.orders as orders where orders.id = v_order_id;
end;
$$;

create or replace function public.server_reserve_checkout(
  p_event_id uuid,
  p_items jsonb,
  p_name text,
  p_email text,
  p_client_request_id uuid,
  p_confirmation_token_hash text
)
returns table (
  order_id uuid, organizer_id uuid, quantity integer, subtotal_minor bigint,
  currency text, platform_product_fee_minor bigint, stripe_fee_estimate_minor bigint,
  application_fee_amount_minor bigint, expected_organizer_proceeds_minor bigint,
  total_minor bigint, stripe_account_id text, checkout_expires_at timestamptz,
  existing_checkout_session_id text, integration_identifier text,
  create_request_digest text, order_items jsonb
)
language sql
security definer
set search_path = ''
as $$ select * from private.reserve_checkout(
  p_event_id, p_items, p_name, p_email, p_client_request_id, p_confirmation_token_hash
); $$;

create or replace function public.get_public_event_ticketing(p_event_id uuid)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'event', private.public_event_projection(p_event_id),
    'tiers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tier_availability.id, 'name', tier_availability.name,
        'description', tier_availability.description,
        'unit_amount_minor', tier_availability.unit_amount_minor,
        'currency', tier_availability.currency,
        'availability_status', case when tier_availability.quantity_total > tier_availability.reserved_quantity
          then 'available' else 'sold_out' end
      ) order by tier_availability.sort_order)
      from (
        select tiers.id, tiers.name, tiers.description, tiers.unit_amount_minor,
          tiers.currency, tiers.quantity_total, tiers.sort_order,
          coalesce(sum(items.quantity) filter (
            where orders.status in ('paid', 'payment_processing', 'requires_review', 'partially_refunded')
              or (orders.status in ('creating_checkout', 'checkout_open')
                and orders.reservation_expires_at > pg_catalog.statement_timestamp())
          ), 0)::bigint as reserved_quantity
        from public.ticket_tiers as tiers
        left join public.order_items as items on items.ticket_tier_id = tiers.id
        left join public.orders as orders on orders.id = items.order_id
        where tiers.event_id = p_event_id and tiers.status = 'active'
        group by tiers.id
      ) as tier_availability
    ), '[]'::jsonb)
  )
  where private.event_is_publicly_eligible(p_event_id, pg_catalog.statement_timestamp());
$$;

revoke all on function private.calculate_checkout_money(bigint,integer,integer,bigint,text,integer,bigint)
from public, anon, authenticated, service_role;
revoke all on function private.checkout_cart_request_digest(uuid,uuid,uuid,text,text,text,bigint,bigint,text,timestamptz,text,jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.get_checkout_preflight(uuid,uuid[])
from public, anon, authenticated, service_role;
revoke all on function private.reserve_checkout(uuid,jsonb,text,text,uuid,text)
from public, anon, authenticated, service_role;
revoke all on function public.server_get_checkout_preflight(uuid,uuid[])
from public, anon, authenticated, service_role;
revoke all on function public.server_reserve_checkout(uuid,jsonb,text,text,uuid,text)
from public, anon, authenticated, service_role;
grant execute on function public.server_get_checkout_preflight(uuid,uuid[]) to service_role;
grant execute on function public.server_reserve_checkout(uuid,jsonb,text,text,uuid,text) to service_role;
