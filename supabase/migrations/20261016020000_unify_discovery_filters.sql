-- Discovery V1 Task4. Additive map contract; existing raw map RPC and canonical
-- eligibility helper are untouched. No tables, indexes, policy or RLS changes.
BEGIN;
DO $baseline$ BEGIN
 IF md5(pg_get_functiondef('public.server_get_public_discovery_events(jsonb)'::regprocedure)) <> 'fddf17ca1f14533d2564b31c62bdd5b4'
 OR md5(pg_get_functiondef('private.discovery_window(text,timestamptz)'::regprocedure)) <> '5449fb8bb6395e8f6f88af1133cab8c0'
 OR md5(pg_get_functiondef('private.current_publicly_eligible_event_ids()'::regprocedure)) <> 'bcd0a0afb46bf6a0f6fa0d842560e1b8'
 OR md5(pg_get_functiondef('public.get_public_map_events(float8,float8,float8,float8,timestamptz,timestamptz,text[])'::regprocedure)) <> 'be37cfa8e4b0d7ec4cf46a401ae76468' THEN
  RAISE EXCEPTION 'UNIFIED_DISCOVERY_BASELINE_CHANGED';
 END IF;
END $baseline$;
CREATE OR REPLACE FUNCTION private.discovery_window(p_when text, p_as_of timestamptz)
returns jsonb language plpgsql stable set search_path='' as $$
declare
  local_day date := (p_as_of at time zone 'America/Los_Angeles')::date;
  start_at timestamptz;
  end_at timestamptz;
  friday date;
begin
  if p_as_of is null or not isfinite(p_as_of) or p_when is null or p_when not in ('next7','upcoming','today','weekend') then
    raise exception using errcode='22023',message='DISCOVERY_QUERY_INVALID';
  end if;
  if p_when='next7' then
    start_at:=p_as_of;
    end_at:=p_as_of+interval '168 hours';
  elsif p_when='upcoming' then
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

-- Canonical rectangular membership, independent of geography edge curvature.
CREATE FUNCTION private.discovery_bounds(p_bounds jsonb) RETURNS extensions.geometry
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $bounds$
DECLARE w float8; s float8; e float8; n float8;
BEGIN
 IF p_bounds IS NULL THEN RETURN extensions.st_makeenvelope(-123.6,36.8,-121,38.9,4326); END IF;
 IF jsonb_typeof(p_bounds) IS DISTINCT FROM 'object'
  OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_bounds) k) IS DISTINCT FROM ARRAY['east','north','south','west']::text[]
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['west','south','east','north']) k WHERE jsonb_typeof(p_bounds->k) IS DISTINCT FROM 'number') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='DISCOVERY_QUERY_INVALID';
 END IF;
 w:=(p_bounds->>'west')::float8;s:=(p_bounds->>'south')::float8;e:=(p_bounds->>'east')::float8;n:=(p_bounds->>'north')::float8;
 IF NOT (w>=-123.6 AND e<=-121 AND s>=36.8 AND n<=38.9 AND w<e AND s<n) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='DISCOVERY_QUERY_INVALID';
 END IF;
 RETURN extensions.st_makeenvelope(w,s,e,n,4326);
EXCEPTION WHEN numeric_value_out_of_range THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='DISCOVERY_QUERY_INVALID';
END;
$bounds$;
ALTER FUNCTION private.discovery_bounds(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.discovery_bounds(jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.get_public_filtered_map_events(p_west float8,p_south float8,p_east float8,p_north float8,p_when text,p_categories text[],p_admission_type text)
 RETURNS TABLE(event_id uuid, title text, category text, starts_at timestamp with time zone, ends_at timestamp with time zone, timezone text, latitude double precision, longitude double precision, animation_preset text, venue_label text, admission_type text, minimum_price_minor bigint, minimum_age text, advisories text[], artwork_reference text, map_icon_version_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE window_data jsonb; area extensions.geometry; now_at timestamptz:=statement_timestamp();
BEGIN
 area:=private.discovery_bounds(jsonb_build_object('west',p_west,'south',p_south,'east',p_east,'north',p_north));
 window_data:=private.discovery_window(p_when,now_at);
 IF (p_admission_type IS NOT NULL AND p_admission_type NOT IN ('free','paid'))
 OR (p_categories IS NOT NULL AND (cardinality(p_categories)=0 OR EXISTS(SELECT 1 FROM unnest(p_categories) c WHERE c IS NULL OR c NOT IN ('food_drink','music','fitness','art_culture','shopping','community','nightlife','other')))) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='DISCOVERY_QUERY_INVALID';
 END IF;
  -- A small response header retains authoritative timing even for an empty set,
  -- without repeating metadata on every event or bypassing PostgREST row limits.
  PERFORM pg_catalog.set_config('response.headers',jsonb_build_array(
    jsonb_build_object('X-Wheretoo-Discovery',jsonb_build_object('window',window_data,'serverNow',now_at)::text),
    jsonb_build_object('Access-Control-Expose-Headers','Content-Range, X-Wheretoo-Discovery')
  )::text,true);
  return query
  select
    events.id,
    events.title,
    events.category,
    events.starts_at,
    events.ends_at,
    events.timezone,
    events.latitude,
    events.longitude,
    events.animation_preset,
    events.venue_name,
    events.admission_type,
    case
      when events.admission_type = 'paid' then prices.minimum_price_minor
      else null::bigint
    end,
    disclosures.minimum_age,
    array_remove(array[
      case when disclosures.alcohol_present then 'alcohol' end,
      case when disclosures.cannabis_present then 'cannabis' end,
      case when disclosures.explicit_adult_content then 'mature_content' end
    ]::text[], null),
    events.artwork_path,
    case when exists(select 1 from private.map_icon_versions v
      cross join private.map_icon_settings s where v.id=events.map_icon_version_id
      and v.state in ('published','retired') and s.singleton and s.rendering_enabled)
      then events.map_icon_version_id else null::uuid end
  from public.events as events
  join private.event_risk_disclosures as disclosures
    on disclosures.event_id = events.id
  left join lateral (
    select min(tiers.unit_amount_minor)::bigint as minimum_price_minor
    from public.ticket_tiers as tiers
    where tiers.event_id = events.id
      and tiers.status = 'active'
  ) as prices on true
  where events.ends_at > pg_catalog.statement_timestamp()
    and exists (
      select 1 from private.current_publicly_eligible_event_ids() eligible
      where eligible.event_id = events.id
    )
    and events.starts_at < (window_data->>'end')::timestamptz
    and events.ends_at > (window_data->>'start')::timestamptz
    and (p_categories is null or events.category = any(p_categories))
    and (p_admission_type is null or events.admission_type=p_admission_type)
    and extensions.st_intersects(events.location::extensions.geometry,area)
    and (
      events.admission_type = 'free'
      or prices.minimum_price_minor is not null
    )
  order by events.starts_at, events.id;
end;
$function$;
ALTER FUNCTION public.get_public_filtered_map_events(float8,float8,float8,float8,text,text[],text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_public_filtered_map_events(float8,float8,float8,float8,text,text[],text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_public_filtered_map_events(float8,float8,float8,float8,text,text[],text) TO anon,authenticated;
CREATE OR REPLACE FUNCTION public.server_get_public_discovery_events(p_query jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  area extensions.geometry;
  scoped boolean:=p_query ? 'bounds';
  cursor_version integer;
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
  cursor_start timestamptz;
  cursor_id uuid;
begin
  if p_query is null or jsonb_typeof(p_query) is distinct from 'object'
    or octet_length(p_query::text)>2048
    or p_query->>'region' is distinct from 'sf_bay_area'
    or jsonb_typeof(p_query->'when') is distinct from 'string'
    or p_query->>'when' not in ('next7','upcoming','today','weekend')
    or exists(select 1 from jsonb_object_keys(p_query) k where k not in ('region','when','category','admissionType','limit','cursor','bounds'))
    or (p_query ? 'category' and (jsonb_typeof(p_query->'category') is distinct from 'string' or p_query->>'category' not in ('food_drink','music','fitness','art_culture','shopping','community','nightlife','other')))
    or (p_query ? 'admissionType' and (jsonb_typeof(p_query->'admissionType') is distinct from 'string' or p_query->>'admissionType' not in ('free','paid')))
    or (p_query ? 'limit' and (jsonb_typeof(p_query->'limit') is distinct from 'number' or (p_query->>'limit')::numeric not between 1 and 50 or trunc((p_query->>'limit')::numeric)<>(p_query->>'limit')::numeric)) then
    raise exception using errcode='22023',message='DISCOVERY_QUERY_INVALID';
  end if;
  IF scoped AND p_query->'bounds'='null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='DISCOVERY_QUERY_INVALID'; END IF;
  area:=private.discovery_bounds(p_query->'bounds');
  cursor_version:=CASE WHEN scoped THEN 2 ELSE 1 END;
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
        or (select array_agg(k order by k) from jsonb_object_keys(cursor_data) k) is distinct from (CASE WHEN scoped THEN array['admissionType','bounds','category','end','issuedAt','lastId','lastStart','region','start','v','when']::text[] ELSE array['admissionType','category','end','issuedAt','lastId','lastStart','region','start','v','when']::text[] END)
        or cursor_data->'v' is distinct from to_jsonb(cursor_version)
        or (scoped and cursor_data->'bounds' is distinct from p_query->'bounds')
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
    join private.current_publicly_eligible_event_ids() eligible on eligible.event_id=e.id
    where e.status='published' and e.moderation_status='clear'
      and e.starts_at<(window_data->>'end')::timestamptz
      and e.ends_at>(window_data->>'start')::timestamptz and e.ends_at>now_at
      and (category_filter is null or e.category=category_filter)
      and (admission_filter is null or e.admission_type=admission_filter)
      and (last_id is null or (e.starts_at,e.id)>(last_start,last_id))
      and extensions.st_intersects(e.location::extensions.geometry,area)
      and (e.admission_type='free' or exists(select 1 from public.ticket_tiers t where t.event_id=e.id and t.status='active'))
    -- Resolve eligibility as a set before ordering and the page bound.
    -- There is no inner limit: ineligible prefixes must not hide valid events.
    order by e.starts_at,e.id offset 0
    ) candidates
    order by candidates.starts_at,candidates.id limit page_limit+1
  loop
    row_count:=row_count+1;
    if row_count>page_limit then
      next_cursor:=private.discovery_encode_cursor(jsonb_build_object('v',cursor_version,'region','sf_bay_area','when',preset,
        'category',category_filter,'admissionType',admission_filter,'issuedAt',issued_at,
        'start',window_data->'start','end',window_data->'end','lastStart',cursor_start,'lastId',cursor_id)
        || CASE WHEN scoped THEN jsonb_build_object('bounds',p_query->'bounds') ELSE '{}'::jsonb END);
      exit;
    end if;
    items:=items||jsonb_build_array(jsonb_build_object(
      'id',row_data.id,'title',row_data.title,'category',row_data.category,'admissionType',row_data.admission_type,
      'startsAt',row_data.starts_at,'endsAt',row_data.ends_at,'timezone',row_data.timezone,
      'venueName',row_data.venue_name,'city',row_data.city,'artworkReference',null,
      'admission',jsonb_build_object('state','unknown','minimumBuyerAmountMinor',null,'currency',null)));
    cursor_start:=row_data.starts_at; cursor_id:=row_data.id;
  end loop;
  return jsonb_build_object('items',items,'nextCursor',next_cursor,'window',window_data,'serverNow',now_at);
end;
$function$;

COMMIT;
