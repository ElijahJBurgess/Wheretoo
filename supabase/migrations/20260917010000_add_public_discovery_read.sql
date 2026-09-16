-- A bounded service-only discovery projection. Publication and map ownership stay unchanged.
create function private.discovery_window(p_when text, p_as_of timestamptz)
returns jsonb language plpgsql stable set search_path='' as $$
declare
  local_day date := (p_as_of at time zone 'America/Los_Angeles')::date;
  start_at timestamptz;
  end_at timestamptz;
  friday date;
begin
  if p_as_of is null or not isfinite(p_as_of) or p_when is null or p_when not in ('upcoming','today','weekend') then
    raise exception using errcode='22023',message='DISCOVERY_QUERY_INVALID';
  end if;
  if p_when='upcoming' then
    start_at:=p_as_of;
    end_at:=(local_day+30)::timestamp at time zone 'America/Los_Angeles';
  elsif p_when='today' then
    start_at:=local_day::timestamp at time zone 'America/Los_Angeles';
    end_at:=(local_day+1)::timestamp at time zone 'America/Los_Angeles';
  else
    friday:=local_day + (5-extract(isodow from local_day)::integer);
    start_at:=friday::timestamp at time zone 'America/Los_Angeles';
    end_at:=(friday+3)::timestamp at time zone 'America/Los_Angeles';
  end if;
  return jsonb_build_object('start',start_at,'end',end_at,'timezone','America/Los_Angeles');
end;
$$;

create function private.discovery_encode_cursor(p_payload jsonb)
returns text language sql immutable set search_path='' as $$
  select rtrim(translate(replace(encode(convert_to(p_payload::text,'UTF8'),'base64'), E'\n',''),'+/','-_'),'=');
$$;

create function public.server_get_public_discovery_events(p_query jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  now_at timestamptz:=statement_timestamp();
  issued_at timestamptz:=now_at;
  preset text;
  category_filter text;
  admission_filter text;
  page_limit integer:=20;
  cursor_text text;
  cursor_data jsonb;
  window_data jsonb;
  last_start timestamptz;
  last_id uuid;
  row_data record;
  row_count integer:=0;
  items jsonb:='[]';
  next_cursor text:=null;
  last_cursor text;
begin
  if p_query is null or jsonb_typeof(p_query) is distinct from 'object'
    or octet_length(p_query::text)>2048
    or p_query->>'region' is distinct from 'sf_bay_area'
    or jsonb_typeof(p_query->'when') is distinct from 'string'
    or p_query->>'when' not in ('upcoming','today','weekend')
    or exists(select 1 from jsonb_object_keys(p_query) k where k not in ('region','when','category','admissionType','limit','cursor'))
    or (p_query ? 'category' and (jsonb_typeof(p_query->'category') is distinct from 'string' or p_query->>'category' not in ('food_drink','music','fitness','art_culture','shopping','community','nightlife','other')))
    or (p_query ? 'admissionType' and (jsonb_typeof(p_query->'admissionType') is distinct from 'string' or p_query->>'admissionType' not in ('free','paid')))
    or (p_query ? 'limit' and (jsonb_typeof(p_query->'limit') is distinct from 'number' or (p_query->>'limit')::numeric not between 1 and 50 or trunc((p_query->>'limit')::numeric)<>(p_query->>'limit')::numeric)) then
    raise exception using errcode='22023',message='DISCOVERY_QUERY_INVALID';
  end if;
  preset:=p_query->>'when'; category_filter:=p_query->>'category'; admission_filter:=p_query->>'admissionType';
  if p_query ? 'limit' then page_limit:=(p_query->>'limit')::numeric::integer; end if;
  if p_query ? 'cursor' then
    cursor_text:=p_query->>'cursor';
    if jsonb_typeof(p_query->'cursor') is distinct from 'string' or octet_length(cursor_text) not between 1 and 1024 or cursor_text !~ '^[A-Za-z0-9_-]+$' then
      raise exception using errcode='22023',message='DISCOVERY_CURSOR_INVALID';
    end if;
    begin
      cursor_data:=convert_from(decode(translate(cursor_text,'-_','+/')||repeat('=',(4-length(cursor_text)%4)%4),'base64'),'UTF8')::jsonb;
      if private.discovery_encode_cursor(cursor_data)<>cursor_text
        or jsonb_typeof(cursor_data) is distinct from 'object'
        or (select array_agg(k order by k) from jsonb_object_keys(cursor_data) k) is distinct from array['admissionType','category','end','issuedAt','lastId','lastStart','region','start','v','when']::text[]
        or cursor_data->'v' is distinct from '1'::jsonb
        or cursor_data->>'region' is distinct from 'sf_bay_area'
        or cursor_data->>'when' is distinct from preset
        or cursor_data->'category' is distinct from coalesce(to_jsonb(category_filter),'null'::jsonb)
        or cursor_data->'admissionType' is distinct from coalesce(to_jsonb(admission_filter),'null'::jsonb)
        or jsonb_typeof(cursor_data->'lastId') is distinct from 'string'
        or cursor_data->>'lastId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or exists(select 1 from unnest(array['issuedAt','start','end','lastStart']) k where jsonb_typeof(cursor_data->k) is distinct from 'string' or cursor_data->>k !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}:\d{2}$') then
        raise exception 'Invalid cursor';
      end if;
      issued_at:=(cursor_data->>'issuedAt')::timestamptz;
      last_start:=(cursor_data->>'lastStart')::timestamptz;
      last_id:=(cursor_data->>'lastId')::uuid;
      window_data:=private.discovery_window(preset,issued_at);
      if not isfinite(issued_at) or not isfinite(last_start) or issued_at>now_at
        or (cursor_data->>'start')::timestamptz<>(window_data->>'start')::timestamptz
        or (cursor_data->>'end')::timestamptz<>(window_data->>'end')::timestamptz
        or last_start>=(window_data->>'end')::timestamptz then raise exception 'Invalid cursor'; end if;
    exception when others then
      raise exception using errcode='22023',message='DISCOVERY_CURSOR_INVALID';
    end;
    if issued_at<now_at-interval '15 minutes' then
      raise exception using errcode='22023',message='DISCOVERY_CURSOR_EXPIRED';
    end if;
  else
    window_data:=private.discovery_window(preset,now_at);
  end if;
  for row_data in
    select candidates.* from (
    select e.id,e.title,e.category,e.admission_type,e.starts_at,e.ends_at,e.timezone,e.venue_name,e.city
    from public.events e
    where e.status='published' and e.moderation_status='clear'
      and e.starts_at<(window_data->>'end')::timestamptz
      and e.ends_at>(window_data->>'start')::timestamptz and e.ends_at>now_at
      and (category_filter is null or e.category=category_filter)
      and (admission_filter is null or e.admission_type=admission_filter)
      and (last_id is null or (e.starts_at,e.id)>(last_start,last_id))
      and extensions.st_intersects(e.location::extensions.geometry,extensions.st_makeenvelope(-123.6,36.8,-121.0,38.9,4326))
      and (e.admission_type='free' or exists(select 1 from public.ticket_tiers t where t.event_id=e.id and t.status='active'))
    -- Keep the expensive canonical authority above the ordered candidate stream.
    -- Without this fence, equal-start groups can evaluate every authority check
    -- merely to sort. There is no inner limit: every filter still precedes LIMIT.
    order by e.starts_at,e.id offset 0
    ) candidates
    where private.event_is_publicly_eligible(candidates.id,now_at)
    order by candidates.starts_at,candidates.id limit page_limit+1
  loop
    row_count:=row_count+1;
    if row_count>page_limit then next_cursor:=last_cursor; exit; end if;
    items:=items||jsonb_build_array(jsonb_build_object(
      'id',row_data.id,'title',row_data.title,'category',row_data.category,'admissionType',row_data.admission_type,
      'startsAt',row_data.starts_at,'endsAt',row_data.ends_at,'timezone',row_data.timezone,
      'venueName',row_data.venue_name,'city',row_data.city,'artworkReference',null,
      'admission',jsonb_build_object('state','unknown','minimumBuyerAmountMinor',null,'currency',null)));
    last_cursor:=private.discovery_encode_cursor(jsonb_build_object('v',1,'region','sf_bay_area','when',preset,
      'category',category_filter,'admissionType',admission_filter,'issuedAt',issued_at,
      'start',window_data->'start','end',window_data->'end','lastStart',row_data.starts_at,'lastId',row_data.id));
  end loop;
  return jsonb_build_object('items',items,'nextCursor',next_cursor,'window',window_data,'serverNow',now_at);
end;
$$;
revoke all on function private.discovery_window(text,timestamptz),private.discovery_encode_cursor(jsonb),public.server_get_public_discovery_events(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.server_get_public_discovery_events(jsonb) to service_role;
