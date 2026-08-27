create function private.event_is_publicly_eligible(
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
    and private.policy_environment_matches_current_requirements()
    and private.event_meets_public_candidate(p_event_id, p_as_of)
    and exists (
      select 1
      from public.events as events
      join private.event_public_eligibility_intervals as intervals
        on intervals.event_id = events.id
        and intervals.public_eligibility_version = events.public_eligibility_version
        and intervals.eligibility_state = 'eligible'
        and intervals.ended_at is null
      where events.id = p_event_id
        and events.public_history_status = 'previously_public'
        and events.first_publicly_eligible_at is not null
    ),
    false
  );
$$;

create function private.public_event_projection(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
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
    'minimum_age', disclosures.minimum_age,
    'advisories', to_jsonb(array_remove(array[
      case when disclosures.alcohol_present then 'alcohol' end,
      case when disclosures.cannabis_present then 'cannabis' end,
      case when disclosures.explicit_adult_content then 'mature_content' end
    ]::text[], null)),
    'organizer', jsonb_build_object(
      'id', organizers.id,
      'display_name', organizers.display_name
    )
  )
  from public.events as events
  join public.organizers as organizers on organizers.id = events.organizer_id
  join private.event_risk_disclosures as disclosures
    on disclosures.event_id = events.id
  where events.id = p_event_id;
$$;

create function public.get_public_event(p_event_id uuid)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.public_event_projection(p_event_id)
  where private.event_is_publicly_eligible(
    p_event_id,
    pg_catalog.statement_timestamp()
  );
$$;

create or replace function public.get_public_event_ticketing(p_event_id uuid)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'event', private.public_event_projection(p_event_id),
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
                and orders.reservation_expires_at > pg_catalog.statement_timestamp()
              )
          ), 0)::bigint as reserved_quantity
        from public.ticket_tiers as tiers
        left join public.order_items as items on items.ticket_tier_id = tiers.id
        left join public.orders as orders on orders.id = items.order_id
        where tiers.event_id = p_event_id
          and tiers.status = 'active'
        group by tiers.id
      ) as tier_availability
    )
  )
  where private.event_is_publicly_eligible(
      p_event_id,
      pg_catalog.statement_timestamp()
    )
    and exists (
      select 1
      from public.events as events
      where events.id = p_event_id
        and events.admission_type = 'paid'
    )
    and exists (
      select 1
      from public.ticket_tiers as active_tiers
      where active_tiers.event_id = p_event_id
        and active_tiers.status = 'active'
    );
$$;

create function public.get_public_map_events(
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

drop policy if exists events_public_read on public.events;
drop policy if exists organizers_public_read on public.organizers;

create policy organizers_self_read on public.organizers
for select to authenticated
using ((select auth.uid()) = id);

revoke select on table public.events from anon;
revoke select on table public.organizers from anon;

create index events_public_discovery_idx
on public.events (starts_at, ends_at, category, id)
where status = 'published'
  and moderation_status = 'clear'
  and moderated_revision = content_revision;

revoke all on function private.event_is_publicly_eligible(uuid, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function private.public_event_projection(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.get_public_event(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.get_public_event_ticketing(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.get_public_map_events(
  double precision, double precision, double precision, double precision,
  timestamptz, timestamptz, text[]
)
from public, anon, authenticated, service_role;

grant execute on function public.get_public_event(uuid) to anon, authenticated;
grant execute on function public.get_public_event_ticketing(uuid) to anon, authenticated;
grant execute on function public.get_public_map_events(
  double precision, double precision, double precision, double precision,
  timestamptz, timestamptz, text[]
) to anon, authenticated;

-- Keep the frozen Day 2 payment implementations byte-for-byte except for the
-- obsolete public-eligibility clauses. The guarded replacements make a clean
-- install fail instead of silently retaining a legacy predicate if an earlier
-- function definition ever differs from the reviewed migration history.
do $$
declare
  v_definition text;
  v_rewritten text;
  v_legacy text;
  v_canonical text;
begin
  select pg_catalog.pg_get_functiondef(
    'private.checkout_reservation_v1(uuid,uuid,text,text,uuid,text)'::regprocedure
  ) into v_definition;

  v_legacy := $legacy$if v_event.status is distinct from 'published'
    or v_event.admission_type is distinct from 'paid'
    or v_event.moderation_status not in ('clear', 'flagged')$legacy$;
  v_canonical := $canonical$if not private.event_is_publicly_eligible(p_event_id, v_now)
    or v_event.admission_type is distinct from 'paid'$canonical$;
  v_rewritten := pg_catalog.replace(v_definition, v_legacy, v_canonical);

  if v_rewritten = v_definition then
    raise exception using
      errcode = 'P0001',
      message = 'RESERVATION_ELIGIBILITY_REWRITE_NOT_APPLIED';
  end if;
  execute v_rewritten;

  select pg_catalog.pg_get_functiondef(
    'private.get_checkout_preflight(uuid,uuid)'::regprocedure
  ) into v_definition;

  v_legacy := $legacy$if not found or v_event.status is distinct from 'published'
    or v_event.admission_type is distinct from 'paid'
    or v_event.moderation_status not in ('clear', 'flagged')$legacy$;
  v_canonical := $canonical$if not found
    or not private.event_is_publicly_eligible(p_event_id, v_now)
    or v_event.admission_type is distinct from 'paid'$canonical$;
  v_rewritten := pg_catalog.replace(v_definition, v_legacy, v_canonical);

  if v_rewritten = v_definition then
    raise exception using
      errcode = 'P0001',
      message = 'PREFLIGHT_ELIGIBILITY_REWRITE_NOT_APPLIED';
  end if;
  execute v_rewritten;

  select pg_catalog.pg_get_functiondef(
    'private.fulfill_paid_order(text,uuid,text,text,text,text,text,text,text,text,text,text,bigint,bigint,bigint,text)'::regprocedure
  ) into v_definition;

  v_legacy := $legacy$or v_event.status is distinct from 'published'
    or v_event.admission_type is distinct from 'paid'
    or v_event.moderation_status not in ('clear', 'flagged')$legacy$;
  v_canonical := $canonical$or not private.event_is_publicly_eligible(
      v_event.id,
      pg_catalog.statement_timestamp()
    )
    or v_event.admission_type is distinct from 'paid'$canonical$;
  v_rewritten := pg_catalog.replace(v_definition, v_legacy, v_canonical);

  if v_rewritten = v_definition then
    raise exception using
      errcode = 'P0001',
      message = 'FULFILLMENT_ELIGIBILITY_REWRITE_NOT_APPLIED';
  end if;
  execute v_rewritten;
end;
$$;

revoke all on function private.reserve_checkout(uuid, uuid, text, text, uuid, text)
from public, anon, authenticated, service_role;
revoke all on function private.checkout_reservation_v1(uuid, uuid, text, text, uuid, text)
from public, anon, authenticated, service_role;
revoke all on function private.get_checkout_preflight(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.fulfill_paid_order(
  text, uuid, text, text, text, text, text, text, text, text, text, text,
  bigint, bigint, bigint, text
)
from public, anon, authenticated, service_role;
