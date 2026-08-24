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

  select * into v_event
  from public.events
  where id = p_event_id
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
    raise exception using errcode = 'P0001', message = 'PAID_PUBLISHING_NOT_AVAILABLE';
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

  update public.events
  set status = 'published',
      published_at = coalesce(published_at, now())
  where id = p_event_id
  returning * into v_event;

  return v_event;
end;
$$;
