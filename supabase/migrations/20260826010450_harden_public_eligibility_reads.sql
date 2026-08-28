create function private.event_has_current_public_eligibility(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
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
$$;

create or replace function private.event_is_publicly_eligible(
  p_event_id uuid,
  p_as_of timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_as_of is not null
    and private.event_has_current_public_eligibility(p_event_id)
    and exists (
      select 1
      from public.events as events
      where events.id = p_event_id
        and events.ends_at > p_as_of
    ),
    false
  );
$$;

create or replace function public.get_public_map_events(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_categories text[] default null
)
returns table (
  event_id uuid,
  title text,
  category text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  latitude double precision,
  longitude double precision,
  animation_preset text,
  venue_label text,
  admission_type text,
  minimum_price_minor bigint,
  minimum_age text,
  advisories text[],
  artwork_reference text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    events.artwork_path
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
$$;

do $$
declare
  v_definition text;
  v_rewritten text;
  v_legacy text;
  v_canonical text;
begin
  select pg_catalog.pg_get_functiondef(
    'private.fulfill_paid_order(text,uuid,text,text,text,text,text,text,text,text,text,text,bigint,bigint,bigint,text)'::regprocedure
  ) into v_definition;

  v_legacy := $legacy$or not private.event_is_publicly_eligible(
      v_event.id,
      pg_catalog.statement_timestamp()
    )$legacy$;
  v_canonical := $canonical$or not private.event_has_current_public_eligibility(
      v_event.id
    )$canonical$;
  v_rewritten := pg_catalog.replace(v_definition, v_legacy, v_canonical);

  if v_rewritten = v_definition then
    raise exception using
      errcode = 'P0001',
      message = 'FULFILLMENT_CURRENT_ELIGIBILITY_REWRITE_NOT_APPLIED';
  end if;
  execute v_rewritten;
end;
$$;

revoke all on function private.event_has_current_public_eligibility(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.event_is_publicly_eligible(uuid, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.get_public_map_events(
  double precision, double precision, double precision, double precision,
  timestamptz, timestamptz, text[]
)
from public, anon, authenticated, service_role;
grant execute on function public.get_public_map_events(
  double precision, double precision, double precision, double precision,
  timestamptz, timestamptz, text[]
) to anon, authenticated;
revoke all on function private.fulfill_paid_order(
  text, uuid, text, text, text, text, text, text, text, text, text, text,
  bigint, bigint, bigint, text
)
from public, anon, authenticated, service_role;
