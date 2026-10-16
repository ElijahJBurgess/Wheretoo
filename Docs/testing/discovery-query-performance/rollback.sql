-- Task 2.5 atomic rollback, verified in a disposable clone.
-- Recheck target ownership/ACL metadata and intervening changes before use.
BEGIN;
DO $rollback_guard$
BEGIN
  IF md5((SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'private.current_publicly_eligible_event_ids()'::regprocedure)) <> '33c776ce741941746dfd20d7a5029a0d'
     OR md5((SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'private.event_has_current_public_eligibility(uuid)'::regprocedure)) <> '0ba48d6e08330354971cc37baa644a9e'
     OR md5((SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'public.get_public_map_events(float8,float8,float8,float8,timestamptz,timestamptz,text[])'::regprocedure)) <> 'af87985fed15815a89c4bec2b82f2991'
     OR md5((SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'public.server_get_public_discovery_events(jsonb)'::regprocedure)) <> '89ba43808693861c7a373a2b1d9efd65' THEN
    RAISE EXCEPTION 'DISCOVERY_OPTIMIZATION_ROLLBACK_DRIFT';
  END IF;
END;
$rollback_guard$;
CREATE OR REPLACE FUNCTION public.get_public_map_events(p_west double precision, p_south double precision, p_east double precision, p_north double precision, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_categories text[] DEFAULT NULL::text[])
 RETURNS TABLE(event_id uuid, title text, category text, starts_at timestamp with time zone, ends_at timestamp with time zone, timezone text, latitude double precision, longitude double precision, animation_preset text, venue_label text, admission_type text, minimum_price_minor bigint, minimum_age text, advisories text[], artwork_reference text, map_icon_version_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_west is null
    or p_south is null
    or p_east is null
    or p_north is null
    or p_starts_at is null
    or p_ends_at is null
    or p_west < -180
    or p_east > 180
    or p_south < -90
    or p_north > 90
    or p_west >= p_east
    or p_south >= p_north
    or p_starts_at >= p_ends_at
    or p_ends_at > p_starts_at + interval '7 days'
    or p_categories is not null and (
      pg_catalog.cardinality(p_categories) = 0
      or exists (
        select 1
        from pg_catalog.unnest(p_categories) as requested(category)
        where requested.category is null
          or requested.category not in (
            'food_drink', 'music', 'fitness', 'art_culture',
            'shopping', 'community', 'nightlife', 'other'
          )
      )
    ) then
    raise exception using errcode = '22023', message = 'PUBLIC_MAP_QUERY_INVALID';
  end if;

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
  where private.event_is_publicly_eligible(
      events.id,
      pg_catalog.statement_timestamp()
    )
    and events.starts_at < p_ends_at
    and events.ends_at > p_starts_at
    and (p_categories is null or events.category = any(p_categories))
    and extensions.st_intersects(
      events.location,
      extensions.st_makeenvelope(
        p_west, p_south, p_east, p_north, 4326
      )::extensions.geography
    )
    and (
      events.admission_type = 'free'
      or prices.minimum_price_minor is not null
    )
  order by events.starts_at, events.id;
end;
$function$;
CREATE OR REPLACE FUNCTION public.server_get_public_discovery_events(p_query jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
CREATE OR REPLACE FUNCTION private.event_has_current_public_eligibility(p_event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    private.policy_environment_matches_current_requirements()
    and exists (
      select 1
      from public.events as events
      join public.organizers as organizers
        on organizers.id = events.organizer_id
      join private.event_risk_disclosures as disclosures
        on disclosures.event_id = events.id
      join private.event_public_eligibility_intervals as intervals
        on intervals.event_id = events.id
        and intervals.public_eligibility_version = events.public_eligibility_version
        and intervals.eligibility_state = 'eligible'
        and intervals.ended_at is null
      join private.event_moderation_actions as actions
        on actions.id = events.publicly_authorized_action_id
        and actions.event_id = events.id
        and actions.content_revision = events.content_revision
        and actions.action = 'authorize_publication'
      where events.id = p_event_id
        and events.status = 'published'
        and events.published_at is not null
        and events.moderation_status = 'clear'
        and events.moderated_revision = events.content_revision
        and events.publicly_authorized_revision = events.content_revision
        and events.public_history_status = 'previously_public'
        and events.first_publicly_eligible_at is not null
        and events.title is not null
        and pg_catalog.char_length(pg_catalog.btrim(events.title)) between 3 and 120
        and events.description is not null
        and pg_catalog.char_length(pg_catalog.btrim(events.description)) between 20 and 5000
        and events.category is not null
        and events.starts_at is not null
        and events.ends_at is not null
        and events.ends_at > events.starts_at
        and events.address_line1 is not null
        and events.address_line1 ~ '[^[:space:]]'
        and events.city is not null
        and events.city ~ '[^[:space:]]'
        and events.region = 'CA'
        and events.postal_code is not null
        and events.postal_code ~ '[^[:space:]]'
        and events.country_code = 'US'
        and events.mapbox_feature_id is not null
        and events.mapbox_feature_id ~ '[^[:space:]]'
        and events.latitude between 36.8 and 38.9
        and events.longitude between -123.6 and -121.0
        and events.location is not null
        and events.artwork_path is null
        and organizers.display_name is not null
        and organizers.display_name ~ '[^[:space:]]'
        and not (
          disclosures.cannabis_present
          and disclosures.minimum_age <> '21_plus'
        )
        and not (
          disclosures.explicit_adult_content
          and disclosures.minimum_age = 'all_ages'
        )
        and (
          (
            actions.policy_acceptance_id is not null
            and actions.policy_legacy_exemption_id is null
            and exists (
              select 1
              from private.event_policy_acceptances as acceptances
              join private.organizer_policy_versions as organizer_terms
                on organizer_terms.id = acceptances.organizer_terms_version_id
                and organizer_terms.policy_kind = 'organizer_terms'
              join private.organizer_policy_versions as event_policy
                on event_policy.id = acceptances.event_policy_version_id
                and event_policy.policy_kind = 'event_policy'
              where acceptances.id = actions.policy_acceptance_id
                and acceptances.event_id = events.id
                and acceptances.organizer_id = events.organizer_id
                and acceptances.accepted_by_user_id = actions.actor_user_id
                and acceptances.content_revision = events.content_revision
                and acceptances.input_sha256 = actions.input_sha256
            )
          )
          or (
            actions.policy_acceptance_id is null
            and actions.policy_legacy_exemption_id is not null
            and exists (
              select 1
              from private.event_policy_legacy_exemptions as exemptions
              where exemptions.id = actions.policy_legacy_exemption_id
                and exemptions.event_id = events.id
                and exemptions.grandfathered_content_revision = events.content_revision
                and exemptions.input_sha256 = actions.input_sha256
                and exemptions.reason = 'pre_build_2_5_publication'
            )
          )
        )
    ),
    false
  );
$function$;
DROP FUNCTION private.current_publicly_eligible_event_ids();
COMMIT;
