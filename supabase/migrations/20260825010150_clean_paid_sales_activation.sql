create or replace function public.activate_paid_sales(p_event_id uuid)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_connect public.organizer_stripe_accounts;
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

  perform fee_rules.id
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

revoke all on function public.activate_paid_sales(uuid) from public, anon, authenticated;
grant execute on function public.activate_paid_sales(uuid) to authenticated;
