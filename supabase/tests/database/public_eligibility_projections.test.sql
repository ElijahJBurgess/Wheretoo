begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

select has_function(
  'private', 'event_is_publicly_eligible', array['uuid', 'timestamp with time zone'],
  'one private helper owns the final public eligibility answer'
);
select has_function(
  'public', 'get_public_event', array['uuid'],
  'public event detail has one narrow RPC boundary'
);
select has_function(
  'public', 'get_public_event_ticketing', array['uuid'],
  'public paid ticketing retains its narrow RPC boundary'
);
select has_function(
  'public', 'get_public_map_events',
  array[
    'double precision', 'double precision', 'double precision', 'double precision',
    'timestamp with time zone', 'timestamp with time zone', 'text[]'
  ],
  'the future map consumes one viewport and time bounded RPC'
);

select results_eq(
  $$
    select pg_catalog.pg_get_function_result(
      'public.get_public_map_events(double precision,double precision,double precision,double precision,timestamp with time zone,timestamp with time zone,text[])'::regprocedure
    )
  $$,
  $$ values (
    'TABLE(event_id uuid, title text, category text, starts_at timestamp with time zone, ends_at timestamp with time zone, timezone text, latitude double precision, longitude double precision, animation_preset text, venue_label text, admission_type text, minimum_price_minor bigint, minimum_age text, advisories text[], artwork_reference text)'::text
  ) $$,
  'map-safe projection exposes exactly the approved Build 3 dependency contract'
);

select results_eq(
  $$
    select procedures.prosecdef,
      procedures.proconfig = array['search_path=""']::text[]
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'private'
      and procedures.proname = 'event_is_publicly_eligible'
  $$,
  $$ values (true, true) $$,
  'the canonical final eligibility helper is security-definer with an empty search path'
);

select results_eq(
  $$
    select procedures.proname,
      procedures.prosecdef,
      procedures.proconfig = array['search_path=""']::text[]
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname in (
        'get_public_event', 'get_public_event_ticketing', 'get_public_map_events'
      )
    order by procedures.proname
  $$,
  $$ values
    ('get_public_event'::name, true, true),
    ('get_public_event_ticketing'::name, true, true),
    ('get_public_map_events'::name, true, true)
  $$,
  'all public projections are security-definer with empty search paths'
);

select function_privs_are(
  'private', 'event_is_publicly_eligible', array['uuid', 'timestamp with time zone'],
  'anon', array[]::text[],
  'anonymous callers cannot probe the private eligibility helper'
);
select function_privs_are(
  'private', 'event_is_publicly_eligible', array['uuid', 'timestamp with time zone'],
  'authenticated', array[]::text[],
  'authenticated callers cannot probe the private eligibility helper'
);
select has_function(
  'private', 'event_has_current_public_eligibility', array['uuid'],
  'one cheap trusted epoch helper supports non-discovery compatibility checks'
);
select function_privs_are(
  'public', 'get_public_event', array['uuid'],
  'anon', array['EXECUTE'],
  'anonymous clients may execute only the narrow public event projection'
);
select function_privs_are(
  'public', 'get_public_event_ticketing', array['uuid'],
  'anon', array['EXECUTE'],
  'anonymous clients retain the narrow public ticketing projection'
);
select function_privs_are(
  'public', 'get_public_map_events',
  array[
    'double precision', 'double precision', 'double precision', 'double precision',
    'timestamp with time zone', 'timestamp with time zone', 'text[]'
  ],
  'anon', array['EXECUTE'],
  'anonymous clients may execute only the bounded map-safe projection'
);

select results_eq(
  $$
    select procedures.proname,
      case procedures.proname
        when 'fulfill_paid_order' then pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedures.oid),
          'private.event_has_current_public_eligibility'
        ) > 0
        else pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedures.oid),
          'private.event_is_publicly_eligible'
        ) > 0
      end as uses_required_eligibility_boundary,
      pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(procedures.oid),
        'moderation_status not in (''clear'', ''flagged'')'
      ) = 0 as omits_legacy_predicate
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'private'
      and procedures.proname in (
        'checkout_reservation_v1', 'get_checkout_preflight', 'fulfill_paid_order'
      )
    order by procedures.proname
  $$,
  $$ values
    ('checkout_reservation_v1'::name, true, true),
    ('fulfill_paid_order'::name, true, true),
    ('get_checkout_preflight'::name, true, true)
  $$,
  'reservation, preflight, and fulfillment route through one canonical eligibility helper'
);

select results_eq(
  $$
    select procedures.proname,
      pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(procedures.oid),
        'event_meets_public_candidate'
      ) = 0,
      pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(procedures.oid),
        'compute_event_input_sha256'
      ) = 0
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'private'
      and procedures.proname in (
        'event_has_current_public_eligibility', 'event_is_publicly_eligible'
      )
    order by procedures.proname
  $$,
  $$ values
    ('event_has_current_public_eligibility'::name, true, true),
    ('event_is_publicly_eligible'::name, true, true)
  $$,
  'public reads consume trusted epoch facts without rebuilding moderation JSON or digests'
);

insert into auth.users (id, email)
values ('78000000-0000-4000-8000-000000000001', 'projection-owner@example.invalid');

insert into public.organizers (
  id, display_name, organizer_type, bio, website_url, base_city
)
values (
  '78000000-0000-4000-8000-000000000001',
  'Projection Organizer', 'Community group',
  'Private organizer biography that public projections must not expose.',
  'https://private.example.invalid', 'Private Base City'
);

insert into public.events (
  id, organizer_id, title, description, category, starts_at, ends_at, timezone,
  venue_name, address_line1, address_line2, city, region, postal_code,
  country_code, mapbox_feature_id, latitude, longitude, admission_type
)
select
  event_id,
  '78000000-0000-4000-8000-000000000001'::uuid,
  event_title,
  'A complete low-risk event used to prove canonical public projection behavior.',
  event_category,
  now() + starts_offset,
  now() + starts_offset + interval '2 hours',
  'America/Los_Angeles',
  venue_name,
  address_line1,
  null,
  'San Francisco', 'CA', '94105', 'US',
  mapbox_feature_id,
  latitude,
  longitude,
  admission_type
from (values
  ('78100000-0000-4000-8000-000000000001'::uuid, 'Canonical free event'::text, 'community'::text, interval '1 day', 'Civic Hall'::text, '1 Market Street'::text, 'mapbox.projection.valid-free'::text, 37.7936::double precision, -122.3958::double precision, 'free'::text),
  ('78100000-0000-4000-8000-000000000002'::uuid, 'Canonical paid event'::text, 'music'::text, interval '2 days', 'Music Hall'::text, '2 Market Street'::text, 'mapbox.projection.valid-paid'::text, 37.7940::double precision, -122.3960::double precision, 'paid'::text),
  ('78100000-0000-4000-8000-000000000003'::uuid, 'Draft exclusion event'::text, 'community'::text, interval '3 days', 'Draft Hall'::text, '3 Market Street'::text, 'mapbox.projection.draft'::text, 37.7941::double precision, -122.3961::double precision, 'free'::text),
  ('78100000-0000-4000-8000-000000000004'::uuid, 'Cancelled exclusion event'::text, 'community'::text, interval '4 days', 'Cancelled Hall'::text, '4 Market Street'::text, 'mapbox.projection.cancelled'::text, 37.7942::double precision, -122.3962::double precision, 'free'::text),
  ('78100000-0000-4000-8000-000000000005'::uuid, 'Review exclusion event'::text, 'community'::text, interval '5 days', 'Review Hall'::text, '5 Market Street'::text, 'mapbox.projection.review'::text, 37.7943::double precision, -122.3963::double precision, 'free'::text),
  ('78100000-0000-4000-8000-000000000006'::uuid, 'Blocked exclusion event'::text, 'community'::text, interval '6 days', 'Blocked Hall'::text, '6 Market Street'::text, 'mapbox.projection.blocked'::text, 37.7944::double precision, -122.3964::double precision, 'free'::text),
  ('78100000-0000-4000-8000-000000000007'::uuid, 'Removed exclusion event'::text, 'community'::text, interval '7 days', 'Removed Hall'::text, '7 Market Street'::text, 'mapbox.projection.removed'::text, 37.7945::double precision, -122.3965::double precision, 'free'::text),
  ('78100000-0000-4000-8000-000000000008'::uuid, 'Stale revision exclusion event'::text, 'community'::text, interval '8 days', 'Stale Hall'::text, '8 Market Street'::text, 'mapbox.projection.stale'::text, 37.7946::double precision, -122.3966::double precision, 'free'::text),
  ('78100000-0000-4000-8000-000000000009'::uuid, 'Unknown history exclusion event'::text, 'community'::text, interval '9 days', 'History Hall'::text, '9 Market Street'::text, 'mapbox.projection.unknown'::text, 37.7947::double precision, -122.3967::double precision, 'free'::text),
  ('78100000-0000-4000-8000-000000000010'::uuid, 'Invalid location exclusion event'::text, 'community'::text, interval '10 days', 'Location Hall'::text, '10 Market Street'::text, 'mapbox.projection.invalid-location'::text, 37.7948::double precision, -122.3968::double precision, 'free'::text),
  ('78100000-0000-4000-8000-000000000011'::uuid, 'Ended exclusion event'::text, 'community'::text, interval '11 days', 'Ended Hall'::text, '11 Market Street'::text, 'mapbox.projection.ended'::text, 37.7949::double precision, -122.3969::double precision, 'free'::text),
  ('78100000-0000-4000-8000-000000000012'::uuid, 'Outside viewport event'::text, 'other'::text, interval '12 days', 'Oakland Hall'::text, '12 Broadway'::text, 'mapbox.projection.outside'::text, 37.8044::double precision, -122.2712::double precision, 'free'::text)
) as fixtures(
  event_id, event_title, event_category, starts_offset, venue_name, address_line1,
  mapbox_feature_id, latitude, longitude, admission_type
);

insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present,
  explicit_adult_content, gambling_present, weapons_present, high_risk_activity
)
select
  events.id,
  case when events.id = '78100000-0000-4000-8000-000000000002' then '21_plus' else 'all_ages' end,
  events.id = '78100000-0000-4000-8000-000000000002',
  false, false, false, false, false
from public.events as events
where events.organizer_id = '78000000-0000-4000-8000-000000000001';

insert into public.ticket_tiers (
  id, event_id, name, description, unit_amount_minor, currency,
  quantity_total, status, sort_order
)
values (
  '78200000-0000-4000-8000-000000000001',
  '78100000-0000-4000-8000-000000000002',
  'General admission', 'Safe public tier copy', 2500, 'usd', 20, 'active', 1
);

insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, transfers_status, payouts_status,
  requirements_status, requirements_currently_due_count,
  requirements_past_due_count, last_synced_at
)
values (
  '78000000-0000-4000-8000-000000000001', 'acct_projectionfixture',
  'active', 'active', 'clear', 0, 0, now()
);

update private.organizer_policy_requirements
set policy_version_id = case policy_kind
  when 'organizer_terms' then 'dev-organizer-terms-v1'
  else 'dev-event-policy-v1'
end;
update private.organizer_policy_release_settings
set environment = 'development', updated_at = statement_timestamp()
where singleton_id;

select set_config(
  'request.jwt.claim.sub', '78000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select public.accept_current_event_policies(events.id)
from public.events as events
where events.organizer_id = '78000000-0000-4000-8000-000000000001'
order by events.id;
select public.publish_event(events.id)
from public.events as events
where events.organizer_id = '78000000-0000-4000-8000-000000000001'
order by events.id;
reset role;

update public.events set status = 'draft'
where id = '78100000-0000-4000-8000-000000000003';
update public.events set status = 'cancelled'
where id = '78100000-0000-4000-8000-000000000004';
update public.events set moderation_status = 'under_review'
where id = '78100000-0000-4000-8000-000000000005';
update public.events set moderation_status = 'blocked'
where id = '78100000-0000-4000-8000-000000000006';
update public.events set moderation_status = 'removed'
where id = '78100000-0000-4000-8000-000000000007';
update public.events set content_revision = content_revision + 1
where id = '78100000-0000-4000-8000-000000000008';
update public.events
set public_history_status = 'unknown', first_publicly_eligible_at = null
where id = '78100000-0000-4000-8000-000000000009';
update public.events set latitude = null, longitude = null
where id = '78100000-0000-4000-8000-000000000010';
update public.events
set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour'
where id = '78100000-0000-4000-8000-000000000011';

set local role anon;
select throws_ok(
  $$ select * from public.events limit 1 $$,
  '42501', 'permission denied for table events',
  'anonymous clients cannot select base event rows'
);
select throws_ok(
  $$ select * from public.organizers limit 1 $$,
  '42501', 'permission denied for table organizers',
  'anonymous clients cannot select base organizer rows'
);
reset role;

set local role anon;
select results_eq(
  $$
    select jsonb_object_keys(public_event)
    from public.get_public_event('78100000-0000-4000-8000-000000000001') as public_event
    order by 1
  $$,
  $$ values
    ('address_line1'::text), ('address_line2'), ('admission_type'), ('advisories'),
    ('animation_preset'), ('artwork_path'), ('category'), ('city'), ('country_code'),
    ('description'), ('ends_at'), ('id'), ('latitude'), ('longitude'), ('minimum_age'),
    ('organizer'), ('postal_code'), ('region'), ('starts_at'), ('timezone'), ('title'),
    ('venue_name')
  $$,
  'public detail returns only the exact allowlisted event keys'
);

select results_eq(
  $$
    select jsonb_object_keys(public_event -> 'organizer')
    from public.get_public_event('78100000-0000-4000-8000-000000000001') as public_event
    order by 1
  $$,
  $$ values ('display_name'::text), ('id') $$,
  'public organizer identity omits bio, site, base city, and operational fields'
);

select results_eq(
  $$
    select public_event -> 'advisories'
    from public.get_public_event('78100000-0000-4000-8000-000000000002') as public_event
  $$,
  $$ values ('["alcohol"]'::jsonb) $$,
  'public advisories expose only curated labels and not raw disclosure inputs'
);

select results_eq(
  $$
    select ticketing -> 'event'
    from public.get_public_event_ticketing('78100000-0000-4000-8000-000000000002') as ticketing
  $$,
  $$
    select public_event
    from public.get_public_event('78100000-0000-4000-8000-000000000002') as public_event
  $$,
  'event detail and ticketing consume the same canonical safe event projection'
);

select results_eq(
  $$
    select jsonb_object_keys(ticketing -> 'tiers' -> 0)
    from public.get_public_event_ticketing('78100000-0000-4000-8000-000000000002') as ticketing
    order by 1
  $$,
  $$ values
    ('availability_status'::text), ('currency'), ('description'), ('id'), ('name'),
    ('unit_amount_minor')
  $$,
  'ticketing exposes only the existing safe tier fields'
);

select results_eq(
  $$
    select event_id, title, category, admission_type, minimum_price_minor,
      minimum_age, advisories
    from public.get_public_map_events(
      -122.45, 37.70, -122.35, 37.84,
      now(), now() + interval '7 days', null
    )
    order by event_id
  $$,
  $$ values
    (
      '78100000-0000-4000-8000-000000000001'::uuid,
      'Canonical free event'::text, 'community'::text, 'free'::text,
      null::bigint, 'all_ages'::text, array[]::text[]
    ),
    (
      '78100000-0000-4000-8000-000000000002'::uuid,
      'Canonical paid event'::text, 'music'::text, 'paid'::text,
      2500::bigint, '21_plus'::text, array['alcohol']::text[]
    )
  $$,
  'map projection returns only eligible in-viewport events in the requested time window'
);

select results_eq(
  $$
    select event_id
    from public.get_public_map_events(
      -122.45, 37.70, -122.35, 37.84,
      now(), now() + interval '7 days', array['music']::text[]
    )
  $$,
  $$ values ('78100000-0000-4000-8000-000000000002'::uuid) $$,
  'map category filters are applied before rows reach the browser'
);

select throws_ok(
  $$
    select * from public.get_public_map_events(
      -122.45, 37.70, -122.35, 37.84,
      now(), now() + interval '7 days 1 second', null
    )
  $$,
  '22023', 'PUBLIC_MAP_QUERY_INVALID',
  'anonymous map queries cannot exceed the approved seven-day window'
);

select results_eq(
  $$
    select count(*)::bigint
    from unnest(array[
      '78100000-0000-4000-8000-000000000003'::uuid,
      '78100000-0000-4000-8000-000000000004'::uuid,
      '78100000-0000-4000-8000-000000000005'::uuid,
      '78100000-0000-4000-8000-000000000006'::uuid,
      '78100000-0000-4000-8000-000000000007'::uuid,
      '78100000-0000-4000-8000-000000000008'::uuid,
      '78100000-0000-4000-8000-000000000009'::uuid,
      '78100000-0000-4000-8000-000000000010'::uuid,
      '78100000-0000-4000-8000-000000000011'::uuid
    ]) as excluded(event_id)
    cross join lateral public.get_public_event(excluded.event_id)
  $$,
  $$ values (0::bigint) $$,
  'draft, cancelled, held, blocked, removed, stale, unknown, invalid, and ended events are absent'
);

select results_eq(
  $$
    select count(*)::bigint
    from unnest(array[
      '78100000-0000-4000-8000-000000000003'::uuid,
      '78100000-0000-4000-8000-000000000004'::uuid,
      '78100000-0000-4000-8000-000000000005'::uuid,
      '78100000-0000-4000-8000-000000000006'::uuid,
      '78100000-0000-4000-8000-000000000007'::uuid,
      '78100000-0000-4000-8000-000000000008'::uuid,
      '78100000-0000-4000-8000-000000000009'::uuid,
      '78100000-0000-4000-8000-000000000010'::uuid,
      '78100000-0000-4000-8000-000000000011'::uuid
    ]) as excluded(event_id)
    cross join lateral public.get_public_event_ticketing(excluded.event_id)
  $$,
  $$ values (0::bigint) $$,
  'ticketing applies the same canonical exclusions before browser receipt'
);
reset role;

update private.organizer_policy_release_settings
set environment = 'unconfigured', updated_at = statement_timestamp()
where singleton_id;
select is(
  (select count(*) from public.get_public_event('78100000-0000-4000-8000-000000000001')),
  0::bigint,
  'public projections fail closed while policy environment is unconfigured'
);

update private.organizer_policy_release_settings
set environment = 'production', updated_at = statement_timestamp()
where singleton_id;
select is(
  (select count(*) from public.get_public_event('78100000-0000-4000-8000-000000000001')),
  0::bigint,
  'development placeholder requirements cannot satisfy a production public projection'
);

insert into private.organizer_policy_versions (
  id, policy_kind, stage, public_url, content_sha256, effective_at
)
values
  (
    'projection-prod-organizer-terms-v1', 'organizer_terms', 'production_approved',
    'https://policies.example.invalid/organizer-terms/v1', repeat('a', 64),
    '2026-08-27 00:00:00+00'
  ),
  (
    'projection-prod-event-policy-v1', 'event_policy', 'production_approved',
    'https://policies.example.invalid/event-policy/v1', repeat('b', 64),
    '2026-08-27 00:00:00+00'
  );
update private.organizer_policy_requirements
set policy_version_id = case policy_kind
  when 'organizer_terms' then 'projection-prod-organizer-terms-v1'
  else 'projection-prod-event-policy-v1'
end;

select is(
  (select count(*) from public.get_public_event('78100000-0000-4000-8000-000000000001')),
  1::bigint,
  'a valid production pair and production environment preserve an already-authorized eligible event'
);

select * from finish();
rollback;
