revoke all on table public.organizer_stripe_accounts from public, anon, authenticated;
revoke all on table public.platform_fee_rules from public, anon, authenticated;
revoke all on table public.ticket_tiers from public, anon, authenticated;
revoke all on table public.orders from public, anon, authenticated;
revoke all on table public.order_items from public, anon, authenticated;
revoke all on table public.tickets from public, anon, authenticated;
revoke all on table public.stripe_webhook_events from public, anon, authenticated;
revoke all on table public.refunds from public, anon, authenticated;

alter table public.organizer_stripe_accounts enable row level security;
alter table public.platform_fee_rules enable row level security;
alter table public.ticket_tiers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.tickets enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.refunds enable row level security;

create or replace function public.list_owned_ticket_tiers(p_event_id uuid)
returns setof public.ticket_tiers
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  perform events.id
  from public.events as events
  where events.id = p_event_id
    and events.organizer_id = auth.uid()
  for share;

  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  return query
  select tiers.*
  from public.ticket_tiers as tiers
  where tiers.event_id = p_event_id
    and tiers.status <> 'archived'
  order by tiers.sort_order;
end;
$$;

create or replace function public.save_ticket_tiers(p_event_id uuid, p_tiers jsonb)
returns setof public.ticket_tiers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_item jsonb;
  v_item_id uuid;
  v_existing public.ticket_tiers%rowtype;
  v_name text;
  v_description text;
  v_unit_amount_minor bigint;
  v_currency text;
  v_quantity_total integer;
  v_sort_order smallint;
  v_target_status text;
  v_seen_orders smallint[] := array[]::smallint[];
  v_committed_quantity bigint;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  select events.* into v_event
  from public.events as events
  where events.id = p_event_id
    and events.organizer_id = auth.uid()
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  if v_event.status not in ('draft', 'published') then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_SELLABLE';
  end if;

  if jsonb_typeof(p_tiers) is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'TIER_INVALID';
  end if;

  if jsonb_array_length(p_tiers) < 1 then
    raise exception using errcode = 'P0001', message = 'TIER_NOT_ACTIVE';
  end if;

  if jsonb_array_length(p_tiers) > 3 then
    raise exception using errcode = 'P0001', message = 'TIER_LIMIT_EXCEEDED';
  end if;

  perform tiers.id
  from public.ticket_tiers as tiers
  where tiers.event_id = p_event_id
  order by tiers.id
  for update;

  v_target_status := case
    when v_event.status = 'published' and v_event.admission_type = 'paid' then 'active'
    else 'draft'
  end;

  for v_item in
    select items.value
    from jsonb_array_elements(p_tiers) as items(value)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or exists (
        select 1
        from jsonb_object_keys(v_item) as item_keys(key)
        where item_keys.key <> all (array[
          'id', 'name', 'description', 'unit_amount_minor',
          'currency', 'quantity_total', 'sort_order'
        ])
      ) then
      raise exception using errcode = 'P0001', message = 'TIER_INVALID';
    end if;

    v_item_id := null;
    if v_item ? 'id' and jsonb_typeof(v_item -> 'id') <> 'null' then
      if jsonb_typeof(v_item -> 'id') <> 'string'
        or (v_item ->> 'id') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
        raise exception using errcode = 'P0001', message = 'TIER_INVALID';
      end if;
      v_item_id := (v_item ->> 'id')::uuid;
    end if;

    if jsonb_typeof(v_item -> 'name') <> 'string' then
      raise exception using errcode = 'P0001', message = 'TIER_INVALID';
    end if;
    v_name := btrim(v_item ->> 'name');
    if char_length(v_name) not between 1 and 80 then
      raise exception using errcode = 'P0001', message = 'TIER_INVALID';
    end if;

    if v_item ? 'description'
      and jsonb_typeof(v_item -> 'description') not in ('string', 'null') then
      raise exception using errcode = 'P0001', message = 'TIER_INVALID';
    end if;
    v_description := nullif(btrim(v_item ->> 'description'), '');
    if v_description is not null and char_length(v_description) > 240 then
      raise exception using errcode = 'P0001', message = 'TIER_INVALID';
    end if;

    if jsonb_typeof(v_item -> 'unit_amount_minor') <> 'number'
      or (v_item ->> 'unit_amount_minor') !~ '^[0-9]+$'
      or (v_item ->> 'unit_amount_minor')::numeric not between 1 and 99999999 then
      raise exception using errcode = 'P0001', message = 'TIER_INVALID';
    end if;
    v_unit_amount_minor := (v_item ->> 'unit_amount_minor')::bigint;

    if jsonb_typeof(v_item -> 'currency') <> 'string'
      or v_item ->> 'currency' <> 'usd' then
      raise exception using errcode = 'P0001', message = 'TIER_INVALID';
    end if;
    v_currency := 'usd';

    if jsonb_typeof(v_item -> 'quantity_total') <> 'number'
      or (v_item ->> 'quantity_total') !~ '^[0-9]+$'
      or (v_item ->> 'quantity_total')::numeric not between 1 and 2147483647 then
      raise exception using errcode = 'P0001', message = 'TIER_INVALID';
    end if;
    v_quantity_total := (v_item ->> 'quantity_total')::integer;

    if jsonb_typeof(v_item -> 'sort_order') <> 'number'
      or (v_item ->> 'sort_order') !~ '^[0-9]+$'
      or (v_item ->> 'sort_order')::numeric not between 1 and 3 then
      raise exception using errcode = 'P0001', message = 'TIER_INVALID';
    end if;
    v_sort_order := (v_item ->> 'sort_order')::smallint;

    if v_sort_order = any(v_seen_orders) then
      raise exception using errcode = 'P0001', message = 'TIER_INVALID';
    end if;
    v_seen_orders := array_append(v_seen_orders, v_sort_order);

    select tiers.* into v_existing
    from public.ticket_tiers as tiers
    where tiers.event_id = p_event_id
      and tiers.sort_order = v_sort_order;

    if found then
      if v_item_id is not null and v_item_id <> v_existing.id then
        raise exception using errcode = 'P0001', message = 'TIER_NOT_FOUND';
      end if;

      select coalesce(sum(items.quantity), 0)::bigint into v_committed_quantity
      from public.order_items as items
      join public.orders as orders on orders.id = items.order_id
      where items.ticket_tier_id = v_existing.id
        and (
          orders.status in ('paid', 'payment_processing')
          or (
            orders.status in ('creating_checkout', 'checkout_open')
            and orders.reservation_expires_at > now()
          )
        );

      if v_quantity_total < v_committed_quantity then
        raise exception using errcode = 'P0001', message = 'TIER_LOCKED_AFTER_SALE';
      end if;

      update public.ticket_tiers as tiers
      set name = v_name,
          description = v_description,
          unit_amount_minor = v_unit_amount_minor,
          currency = v_currency,
          quantity_total = v_quantity_total,
          status = v_target_status,
          version = case
            when tiers.name is distinct from v_name
              or tiers.description is distinct from v_description
              or tiers.unit_amount_minor is distinct from v_unit_amount_minor
              or tiers.currency is distinct from v_currency
              or tiers.quantity_total is distinct from v_quantity_total
            then tiers.version + 1
            else tiers.version
          end
      where tiers.id = v_existing.id;
    else
      if v_item_id is not null then
        raise exception using errcode = 'P0001', message = 'TIER_NOT_FOUND';
      end if;

      insert into public.ticket_tiers (
        event_id,
        name,
        description,
        unit_amount_minor,
        currency,
        quantity_total,
        status,
        sort_order
      )
      values (
        p_event_id,
        v_name,
        v_description,
        v_unit_amount_minor,
        v_currency,
        v_quantity_total,
        v_target_status,
        v_sort_order
      );
    end if;
  end loop;

  update public.ticket_tiers as tiers
  set status = 'archived'
  where tiers.event_id = p_event_id
    and not (tiers.sort_order = any(v_seen_orders))
    and tiers.status <> 'archived';

  return query
  select tiers.*
  from public.ticket_tiers as tiers
  where tiers.event_id = p_event_id
    and tiers.status <> 'archived'
  order by tiers.sort_order;
end;
$$;

create or replace function public.activate_paid_sales(p_event_id uuid)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_connect public.organizer_stripe_accounts;
  v_fee_rule_id uuid;
  v_tier_count integer;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  select events.* into v_event
  from public.events as events
  where events.id = p_event_id
    and events.organizer_id = auth.uid()
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  if v_event.moderation_status in ('blocked', 'removed') then
    raise exception using errcode = 'P0001', message = 'EVENT_MODERATION_BLOCKED';
  end if;

  if v_event.status not in ('draft', 'published') then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_SELLABLE';
  end if;

  if v_event.title is null or char_length(btrim(v_event.title)) not between 3 and 120
    or v_event.description is null or char_length(btrim(v_event.description)) not between 20 and 5000
    or v_event.category is null
    or v_event.address_line1 is null or v_event.address_line1 !~ '[^[:space:]]'
    or v_event.city is null or v_event.city !~ '[^[:space:]]'
    or v_event.region is null
    or v_event.postal_code is null or v_event.postal_code !~ '[^[:space:]]'
    or v_event.mapbox_feature_id is null or v_event.mapbox_feature_id !~ '[^[:space:]]' then
    raise exception using errcode = 'P0001', message = 'EVENT_INCOMPLETE';
  end if;

  if v_event.starts_at is null or v_event.ends_at is null
    or v_event.starts_at <= now() or v_event.ends_at <= v_event.starts_at then
    raise exception using errcode = 'P0001', message = 'EVENT_TIME_INVALID';
  end if;

  if v_event.country_code <> 'US' or v_event.region <> 'CA'
    or v_event.latitude is null or v_event.longitude is null or v_event.location is null then
    raise exception using errcode = 'P0001', message = 'EVENT_LOCATION_INVALID';
  end if;

  if v_event.latitude not between 36.8 and 38.9
    or v_event.longitude not between -123.6 and -121.0 then
    raise exception using errcode = 'P0001', message = 'EVENT_OUTSIDE_SERVICE_AREA';
  end if;

  perform tiers.id
  from public.ticket_tiers as tiers
  where tiers.event_id = p_event_id
  order by tiers.id
  for update;

  select count(*)::integer into v_tier_count
  from public.ticket_tiers as tiers
  where tiers.event_id = p_event_id
    and tiers.status <> 'archived';

  if v_tier_count not between 1 and 3 then
    raise exception using errcode = 'P0001', message = 'TIER_NOT_ACTIVE';
  end if;

  select accounts.* into v_connect
  from public.organizer_stripe_accounts as accounts
  where accounts.organizer_id = v_event.organizer_id
    and accounts.livemode = false
  for share;

  if not found
    or v_connect.last_synced_at < now() - interval '5 minutes'
    or v_connect.transfers_status <> 'active'
    or v_connect.payouts_status <> 'active' then
    raise exception using errcode = 'P0001', message = 'CONNECT_NOT_READY';
  end if;

  if v_connect.requirements_status <> 'clear'
    or v_connect.requirements_currently_due_count <> 0
    or v_connect.requirements_past_due_count <> 0 then
    raise exception using errcode = 'P0001', message = 'CONNECT_ACTION_REQUIRED';
  end if;

  select fee_rules.id into v_fee_rule_id
  from public.platform_fee_rules as fee_rules
  where fee_rules.livemode = false
    and fee_rules.currency = 'usd'
    and fee_rules.effective_from <= now()
    and (fee_rules.effective_until is null or fee_rules.effective_until > now())
  order by fee_rules.effective_from desc
  limit 1
  for share;

  if not found then
    raise exception using errcode = 'P0001', message = 'FEE_RULE_NOT_CONFIGURED';
  end if;

  update public.ticket_tiers as tiers
  set status = 'active'
  where tiers.event_id = p_event_id
    and tiers.status <> 'archived';

  update public.events as events
  set admission_type = 'paid',
      status = 'published',
      published_at = coalesce(events.published_at, now())
  where events.id = p_event_id
  returning events.* into v_event;

  return v_event;
end;
$$;

create or replace function public.get_public_event_ticketing(p_event_id uuid)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'event', jsonb_build_object(
      'id', events.id,
      'title', events.title,
      'description', events.description,
      'category', events.category,
      'starts_at', events.starts_at,
      'ends_at', events.ends_at,
      'timezone', events.timezone,
      'venue_name', events.venue_name,
      'address_line1', events.address_line1,
      'address_line2', events.address_line2,
      'city', events.city,
      'region', events.region,
      'postal_code', events.postal_code,
      'country_code', events.country_code,
      'latitude', events.latitude,
      'longitude', events.longitude,
      'artwork_path', events.artwork_path,
      'animation_preset', events.animation_preset,
      'admission_type', events.admission_type,
      'organizer', jsonb_build_object(
        'id', organizers.id,
        'display_name', organizers.display_name
      )
    ),
    'tiers', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', tier_availability.id,
            'name', tier_availability.name,
            'description', tier_availability.description,
            'unit_amount_minor', tier_availability.unit_amount_minor,
            'currency', tier_availability.currency,
            'availability_status', case
              when tier_availability.quantity_total > tier_availability.reserved_quantity
                then 'available'
              else 'sold_out'
            end
          )
          order by tier_availability.sort_order
        ),
        '[]'::jsonb
      )
      from (
        select
          tiers.id,
          tiers.name,
          tiers.description,
          tiers.unit_amount_minor,
          tiers.currency,
          tiers.quantity_total,
          tiers.sort_order,
          coalesce(sum(items.quantity) filter (
            where orders.status in ('paid', 'payment_processing')
              or (
                orders.status in ('creating_checkout', 'checkout_open')
                and orders.reservation_expires_at > now()
              )
          ), 0)::bigint as reserved_quantity
        from public.ticket_tiers as tiers
        left join public.order_items as items on items.ticket_tier_id = tiers.id
        left join public.orders as orders on orders.id = items.order_id
        where tiers.event_id = events.id
          and tiers.status = 'active'
        group by tiers.id
      ) as tier_availability
    )
  )
  from public.events as events
  join public.organizers as organizers on organizers.id = events.organizer_id
  where events.id = p_event_id
    and events.status = 'published'
    and events.moderation_status in ('clear', 'flagged')
    and events.admission_type = 'paid'
    and exists (
      select 1
      from public.ticket_tiers as active_tiers
      where active_tiers.event_id = events.id
        and active_tiers.status = 'active'
    );
$$;

create or replace function public.publish_event(p_event_id uuid)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_OWNED';
  end if;

  select events.* into v_event
  from public.events as events
  where events.id = p_event_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  if v_event.organizer_id <> auth.uid() then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_OWNED';
  end if;

  if v_event.moderation_status in ('blocked', 'removed') then
    raise exception using errcode = 'P0001', message = 'EVENT_MODERATION_BLOCKED';
  end if;

  if v_event.status = 'published' then
    return v_event;
  end if;

  if v_event.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'EVENT_INCOMPLETE';
  end if;

  if v_event.admission_type = 'paid' then
    return public.activate_paid_sales(p_event_id);
  end if;

  if v_event.title is null or char_length(btrim(v_event.title)) not between 3 and 120
    or v_event.description is null or char_length(btrim(v_event.description)) not between 20 and 5000
    or v_event.category is null
    or v_event.address_line1 is null or v_event.address_line1 !~ '[^[:space:]]'
    or v_event.city is null or v_event.city !~ '[^[:space:]]'
    or v_event.region is null
    or v_event.postal_code is null or v_event.postal_code !~ '[^[:space:]]'
    or v_event.mapbox_feature_id is null or v_event.mapbox_feature_id !~ '[^[:space:]]' then
    raise exception using errcode = 'P0001', message = 'EVENT_INCOMPLETE';
  end if;

  if v_event.starts_at is null or v_event.ends_at is null
    or v_event.starts_at <= now() or v_event.ends_at <= v_event.starts_at then
    raise exception using errcode = 'P0001', message = 'EVENT_TIME_INVALID';
  end if;

  if v_event.country_code <> 'US' or v_event.region <> 'CA'
    or v_event.latitude is null or v_event.longitude is null or v_event.location is null then
    raise exception using errcode = 'P0001', message = 'EVENT_LOCATION_INVALID';
  end if;

  if v_event.latitude not between 36.8 and 38.9
    or v_event.longitude not between -123.6 and -121.0 then
    raise exception using errcode = 'P0001', message = 'EVENT_OUTSIDE_SERVICE_AREA';
  end if;

  update public.events as events
  set status = 'published',
      published_at = coalesce(events.published_at, now())
  where events.id = p_event_id
  returning events.* into v_event;

  return v_event;
end;
$$;

revoke all on function public.list_owned_ticket_tiers(uuid) from public, anon, authenticated;
revoke all on function public.save_ticket_tiers(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.activate_paid_sales(uuid) from public, anon, authenticated;
revoke all on function public.get_public_event_ticketing(uuid) from public, anon, authenticated;
revoke all on function public.publish_event(uuid) from public, anon, authenticated;

grant execute on function public.list_owned_ticket_tiers(uuid) to authenticated;
grant execute on function public.save_ticket_tiers(uuid, jsonb) to authenticated;
grant execute on function public.activate_paid_sales(uuid) to authenticated;
grant execute on function public.get_public_event_ticketing(uuid) to anon, authenticated;
grant execute on function public.publish_event(uuid) to authenticated;
