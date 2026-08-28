begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

select has_column(
  'private', 'organizer_policy_versions', 'stage',
  'policy versions record an immutable release stage'
);
select has_table(
  'private', 'organizer_policy_release_settings',
  'the policy release environment is private'
);
select col_default_is(
  'private', 'organizer_policy_release_settings', 'environment',
  'unconfigured',
  'the policy environment defaults fail closed'
);

select has_function(
  'public', 'get_required_event_policies', array[]::text[],
  'the browser has one narrow current-policy projection'
);
select has_function(
  'public', 'get_owned_event_requirements', array['uuid'],
  'the organizer has one owner-safe disclosure projection'
);
select has_function(
  'public', 'accept_current_event_policies', array['uuid'],
  'the organizer acceptance boundary accepts only an event id'
);
select hasnt_function(
  'public', 'accept_current_event_policies',
  array['uuid', 'text', 'timestamp with time zone', 'uuid', 'boolean'],
  'versions, time, actor, and browser booleans are not acceptance inputs'
);
select has_function(
  'private', 'configure_policy_environment', array['text'],
  'the policy environment has one operational configuration boundary'
);
select has_function(
  'private', 'production_policy_configuration_is_ready', array[]::text[],
  'production readiness has one operational boolean boundary'
);
select has_function(
  'private', 'is_canonical_production_policy_url', array['text'],
  'production policy URL validation has one database-owned canonical boundary'
);

select function_privs_are(
  'public', 'get_required_event_policies', array[]::text[],
  'anon', array['EXECUTE'],
  'anonymous browsers can render only current policy display metadata'
);
select function_privs_are(
  'public', 'get_required_event_policies', array[]::text[],
  'authenticated', array['EXECUTE'],
  'authenticated browsers can render current policy display metadata'
);
select function_privs_are(
  'public', 'get_owned_event_requirements', array['uuid'],
  'anon', array[]::text[],
  'anonymous browsers cannot read event requirements'
);
select function_privs_are(
  'public', 'get_owned_event_requirements', array['uuid'],
  'authenticated', array['EXECUTE'],
  'authenticated organizers can execute the owner-safe requirement read'
);
select function_privs_are(
  'public', 'accept_current_event_policies', array['uuid'],
  'anon', array[]::text[],
  'anonymous browsers cannot accept organizer policies'
);
select function_privs_are(
  'public', 'accept_current_event_policies', array['uuid'],
  'authenticated', array['EXECUTE'],
  'authenticated organizers can execute the acceptance boundary'
);
select function_privs_are(
  'private', 'configure_policy_environment', array['text'],
  'anon', array[]::text[],
  'anonymous browsers cannot configure a policy environment'
);
select function_privs_are(
  'private', 'configure_policy_environment', array['text'],
  'authenticated', array[]::text[],
  'authenticated browsers cannot configure a policy environment'
);
select function_privs_are(
  'private', 'configure_policy_environment', array['text'],
  'service_role', array['EXECUTE'],
  'the service boundary can configure a reviewed policy environment'
);
select function_privs_are(
  'private', 'production_policy_configuration_is_ready', array[]::text[],
  'anon', array[]::text[],
  'anonymous browsers cannot probe production readiness'
);
select function_privs_are(
  'private', 'production_policy_configuration_is_ready', array[]::text[],
  'authenticated', array[]::text[],
  'authenticated browsers cannot probe production readiness'
);
select function_privs_are(
  'private', 'production_policy_configuration_is_ready', array[]::text[],
  'service_role', array['EXECUTE'],
  'the service boundary can evaluate production readiness'
);
select function_privs_are(
  'private', 'is_canonical_production_policy_url', array['text'],
  'service_role', array[]::text[],
  'the service role cannot bypass the policy write boundaries with the URL helper'
);

select results_eq(
  $$
    select count(*)::bigint
    from information_schema.role_table_grants
    where table_schema = 'private'
      and table_name in (
        'organizer_policy_versions',
        'organizer_policy_requirements',
        'organizer_policy_release_settings',
        'event_policy_acceptances',
        'event_policy_legacy_exemptions',
        'event_risk_disclosures'
      )
      and grantee in ('PUBLIC', 'anon', 'authenticated')
  $$,
  $$ values (0::bigint) $$,
  'policy, acceptance, exemption, environment, and disclosure tables deny browsers'
);

select results_eq(
  $$
    select (
      array_to_string(
        array_agg(parameters.parameter_name order by parameters.ordinal_position),
        ','
      )::text collate "C"
    ) = (
      'minimum_age,alcohol_present,cannabis_present,explicit_adult_content,'
      'gambling_present,weapons_present,high_risk_activity,needs_acceptance,'
      'organizer_terms_label,organizer_terms_version_id,organizer_terms_stage,'
      'organizer_terms_url,event_policy_label,event_policy_version_id,'
      'event_policy_stage,event_policy_url'::text collate "C"
    )
    from information_schema.parameters
    where parameters.specific_schema = 'public'
      and parameters.specific_name like 'get_owned_event_requirements_%'
      and parameters.parameter_mode = 'OUT'
  $$,
  $$
    values (true)
  $$,
  'the sole disclosure read returns seven disclosures and minimal current agreement display only'
);

select results_eq(
  $$
    select (
      array_to_string(
        array_agg(parameters.parameter_name order by parameters.ordinal_position),
        ','
      )::text collate "C"
    ) = ('p_event_id'::text collate "C")
    from information_schema.parameters
    where parameters.specific_schema = 'public'
      and parameters.specific_name like 'accept_current_event_policies_%'
      and parameters.parameter_mode = 'IN'
  $$,
  $$ values (true) $$,
  'the acceptance boundary has no client authority beyond event identity'
);

insert into auth.users (id, email)
values
  ('73000000-0000-4000-8000-000000000001', 'policy-owner-a@example.invalid'),
  ('73000000-0000-4000-8000-000000000002', 'policy-owner-b@example.invalid');

insert into public.organizers (id, display_name)
values
  ('73000000-0000-4000-8000-000000000001', 'Policy Organizer A'),
  ('73000000-0000-4000-8000-000000000002', 'Policy Organizer B');

insert into public.events (
  id,
  organizer_id,
  status,
  moderation_status,
  title,
  description,
  category,
  venue_name,
  starts_at,
  ends_at,
  timezone,
  address_line1,
  city,
  region,
  postal_code,
  country_code,
  mapbox_feature_id,
  latitude,
  longitude,
  admission_type,
  public_history_status,
  first_publicly_eligible_at
)
values
  (
    '73100000-0000-4000-8000-000000000001',
    '73000000-0000-4000-8000-000000000001',
    'draft',
    'not_evaluated',
    'Policy acceptance fixture',
    'A stable event used to prove exact policy acceptance binding.',
    'community',
    'Policy Test Hall',
    '2026-09-05 18:00:00+00',
    '2026-09-05 20:00:00+00',
    'America/Los_Angeles',
    '1 Market Street',
    'San Francisco',
    'CA',
    '94105',
    'US',
    'mapbox.policy-acceptance-fixture',
    37.7936,
    -122.3958,
    'free',
    'never_public',
    null
  ),
  (
    '73100000-0000-4000-8000-000000000002',
    '73000000-0000-4000-8000-000000000001',
    'published',
    'clear',
    'Untouched published policy fixture',
    'A policy version change must not hide this untouched published event.',
    'community',
    'Policy Test Hall',
    '2026-09-06 18:00:00+00',
    '2026-09-06 20:00:00+00',
    'America/Los_Angeles',
    '1 Market Street',
    'San Francisco',
    'CA',
    '94105',
    'US',
    'mapbox.policy-published-fixture',
    37.7936,
    -122.3958,
    'free',
    'previously_public',
    '2026-08-20 12:00:00+00'
  );

insert into private.event_risk_disclosures (
  event_id,
  minimum_age,
  alcohol_present,
  cannabis_present,
  explicit_adult_content,
  gambling_present,
  weapons_present,
  high_risk_activity
)
values (
  '73100000-0000-4000-8000-000000000001',
  '21_plus',
  true,
  false,
  false,
  false,
  false,
  false
);

insert into public.ticket_tiers (
  id,
  event_id,
  name,
  description,
  unit_amount_minor,
  quantity_total,
  sort_order
)
values
  (
    '73200000-0000-4000-8000-000000000002',
    '73100000-0000-4000-8000-000000000001',
    'Second by UUID',
    'Inserted first but digested second.',
    2000,
    20,
    1
  ),
  (
    '73200000-0000-4000-8000-000000000001',
    '73100000-0000-4000-8000-000000000001',
    'First by UUID',
    'Inserted second but digested first.',
    1000,
    10,
    2
  );

create temporary table policy_event_before_acceptance on commit drop as
select
  events.id,
  events.status,
  events.moderation_status,
  events.moderated_revision,
  events.moderation_version,
  events.public_history_status,
  events.first_publicly_eligible_at,
  events.public_eligibility_version,
  events.publicly_authorized_revision,
  events.publicly_authorized_action_id,
  (
    select count(*)
    from private.event_moderation_actions as actions
    where actions.event_id = events.id
  ) as action_count,
  (
    select count(*)
    from private.event_public_eligibility_intervals as intervals
    where intervals.event_id = events.id
  ) as interval_count
from public.events as events
where events.id = '73100000-0000-4000-8000-000000000001';

select lives_ok(
  $$
    update private.organizer_policy_release_settings
    set environment = 'unconfigured'
    where singleton_id
  $$,
  'the test can restore the migration default inside its rollback boundary'
);

select results_eq(
  $$
    select count(*)::bigint, min(environment), bool_and(singleton_id)
    from private.organizer_policy_release_settings
  $$,
  $$ values (1::bigint, 'unconfigured'::text, true) $$,
  'the release settings contain exactly one fail-closed singleton'
);

select results_eq(
  $$
    select id, policy_kind, stage, public_url, effective_at, content_sha256
    from private.organizer_policy_versions
    where stage = 'development_placeholder'
    order by policy_kind
  $$,
  $$
    values
      (
        'dev-event-policy-v1'::text,
        'event_policy'::text,
        'development_placeholder'::text,
        '/event-policy'::text,
        '2026-08-26 00:00:00+00'::timestamptz,
        '797aa818b4e7ee9b1d9eb8e7b5b4dba013616080cdf09ccf33875c9a81429de3'::text
      ),
      (
        'dev-organizer-terms-v1'::text,
        'organizer_terms'::text,
        'development_placeholder'::text,
        '/organizer-terms'::text,
        '2026-08-26 00:00:00+00'::timestamptz,
        '5adc8a233232f30a58152a663394ce01d0af29ddbff8401bdad7f836ee49d475'::text
      )
  $$,
  'the exact founder-approved placeholder pair is immutable development metadata'
);

select results_eq(
  $$
    select policy_kind, policy_version_id
    from private.organizer_policy_requirements
    order by policy_kind
  $$,
  $$
    values
      ('event_policy'::text, 'dev-event-policy-v1'::text),
      ('organizer_terms'::text, 'dev-organizer-terms-v1'::text)
  $$,
  'the server controls exactly the two current development requirements'
);

set local role anon;
select is_empty(
  $$ select * from public.get_required_event_policies() $$,
  'the public policy display fails closed while the environment is unconfigured'
);
reset role;

select set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$ select * from public.accept_current_event_policies('73100000-0000-4000-8000-000000000001') $$,
  'P0001',
  'POLICY_ENVIRONMENT_UNCONFIGURED',
  'acceptance fails closed while the policy environment is unconfigured'
);
reset role;

set local role anon;
select throws_ok(
  $$ select private.configure_policy_environment('development') $$,
  '42501',
  null,
  'anonymous callers cannot invoke the private environment operation'
);
reset role;

select set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$ select private.configure_policy_environment('development') $$,
  '42501',
  null,
  'authenticated callers cannot invoke the private environment operation'
);
reset role;

set local role service_role;
select lives_ok(
  $$ select private.configure_policy_environment('development') $$,
  'the service boundary can configure the confirmed development pair'
);
select is(
  private.production_policy_configuration_is_ready(),
  false,
  'development placeholders can never report production readiness'
);
reset role;

set local role anon;
select results_eq(
  $$
    select policy_kind, label, version_id, stage, public_url, effective_at
    from public.get_required_event_policies()
    order by policy_kind
  $$,
  $$
    values
      (
        'event_policy'::text,
        'Event Policy'::text,
        'dev-event-policy-v1'::text,
        'development_placeholder'::text,
        '/event-policy'::text,
        '2026-08-26 00:00:00+00'::timestamptz
      ),
      (
        'organizer_terms'::text,
        'Organizer Terms'::text,
        'dev-organizer-terms-v1'::text,
        'development_placeholder'::text,
        '/organizer-terms'::text,
        '2026-08-26 00:00:00+00'::timestamptz
      )
  $$,
  'the public projection exposes only the exact current display metadata'
);
reset role;

select set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$ select * from public.get_owned_event_requirements('73100000-0000-4000-8000-000000000001') $$,
  'P0001',
  'EVENT_NOT_FOUND',
  'another organizer receives an authorization-safe not-found requirement result'
);
select throws_ok(
  $$ select * from public.accept_current_event_policies('73100000-0000-4000-8000-000000000001') $$,
  'P0001',
  'EVENT_NOT_FOUND',
  'another organizer cannot accept for an event it does not own'
);
select throws_ok(
  $$ select * from public.get_owned_event_requirements('73100000-0000-4000-8000-000000000099') $$,
  'P0001',
  'EVENT_NOT_FOUND',
  'missing and unauthorized events have the same owner-safe result'
);
reset role;

set local role anon;
select throws_ok(
  $$ select * from public.get_owned_event_requirements('73100000-0000-4000-8000-000000000001') $$,
  '42501',
  null,
  'anonymous callers cannot execute the private-disclosure projection'
);
select throws_ok(
  $$ select * from public.accept_current_event_policies('73100000-0000-4000-8000-000000000001') $$,
  '42501',
  null,
  'anonymous callers cannot execute organizer acceptance'
);
reset role;

select set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select results_eq(
  $$
    select
      minimum_age,
      alcohol_present,
      cannabis_present,
      explicit_adult_content,
      gambling_present,
      weapons_present,
      high_risk_activity,
      needs_acceptance,
      organizer_terms_version_id,
      organizer_terms_stage,
      organizer_terms_url,
      event_policy_version_id,
      event_policy_stage,
      event_policy_url
    from public.get_owned_event_requirements('73100000-0000-4000-8000-000000000001')
  $$,
  $$
    values (
      '21_plus'::text,
      true,
      false,
      false,
      false,
      false,
      false,
      true,
      'dev-organizer-terms-v1'::text,
      'development_placeholder'::text,
      '/organizer-terms'::text,
      'dev-event-policy-v1'::text,
      'development_placeholder'::text,
      '/event-policy'::text
    )
  $$,
  'the owner sees seven disclosures and only minimal current agreement display state'
);

select results_eq(
  $$
    select needs_acceptance, organizer_terms_version_id, organizer_terms_stage,
      event_policy_version_id, event_policy_stage
    from public.accept_current_event_policies('73100000-0000-4000-8000-000000000001')
  $$,
  $$
    values (
      false,
      'dev-organizer-terms-v1'::text,
      'development_placeholder'::text,
      'dev-event-policy-v1'::text,
      'development_placeholder'::text
    )
  $$,
  'the owner accepts only the locked server-selected development pair'
);
reset role;

select results_eq(
  $$
    select
      acceptances.organizer_id,
      acceptances.accepted_by_user_id,
      acceptances.content_revision,
      acceptances.organizer_terms_version_id,
      acceptances.event_policy_version_id,
      acceptances.accepted_at >= transaction_timestamp(),
      acceptances.accepted_at <= statement_timestamp(),
      acceptances.input_sha256 ~ '^[a-f0-9]{64}$'
    from private.event_policy_acceptances as acceptances
    where acceptances.event_id = '73100000-0000-4000-8000-000000000001'
  $$,
  $$
    values (
      '73000000-0000-4000-8000-000000000001'::uuid,
      '73000000-0000-4000-8000-000000000001'::uuid,
      1::bigint,
      'dev-organizer-terms-v1'::text,
      'dev-event-policy-v1'::text,
      true,
      true,
      true
    )
  $$,
  'the actor, owner, revision, digest, pair, and timestamp are server-derived'
);

select results_eq(
  $$
    select
      events.status,
      events.moderation_status,
      events.moderated_revision,
      events.moderation_version,
      events.public_history_status,
      events.first_publicly_eligible_at,
      events.public_eligibility_version,
      events.publicly_authorized_revision,
      events.publicly_authorized_action_id,
      (
        select count(*)
        from private.event_moderation_actions as actions
        where actions.event_id = events.id
      ),
      (
        select count(*)
        from private.event_public_eligibility_intervals as intervals
        where intervals.event_id = events.id
      )
    from public.events as events
    where events.id = '73100000-0000-4000-8000-000000000001'
  $$,
  $$
    select
      before_acceptance.status,
      before_acceptance.moderation_status,
      before_acceptance.moderated_revision,
      before_acceptance.moderation_version,
      before_acceptance.public_history_status,
      before_acceptance.first_publicly_eligible_at,
      before_acceptance.public_eligibility_version,
      before_acceptance.publicly_authorized_revision,
      before_acceptance.publicly_authorized_action_id,
      before_acceptance.action_count,
      before_acceptance.interval_count
    from policy_event_before_acceptance as before_acceptance
  $$,
  'acceptance inserts no lifecycle, moderation, action, epoch, history, or public transition'
);

select set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select results_eq(
  $$
    select needs_acceptance
    from public.accept_current_event_policies('73100000-0000-4000-8000-000000000001')
  $$,
  $$ values (false) $$,
  'an exact retry returns the same current agreement state'
);
reset role;

select results_eq(
  $$
    select count(*)::bigint
    from private.event_policy_acceptances
    where event_id = '73100000-0000-4000-8000-000000000001'
  $$,
  $$ values (1::bigint) $$,
  'an exact retry keeps exactly one immutable acceptance row'
);

select throws_ok(
  $$
    update private.event_policy_acceptances
    set accepted_at = accepted_at
    where event_id = '73100000-0000-4000-8000-000000000001'
  $$,
  'P0001',
  'POLICY_ACCEPTANCE_IMMUTABLE',
  'acceptance history cannot be rewritten'
);

select lives_ok(
  $$
    insert into private.event_policy_legacy_exemptions (
      event_id,
      grandfathered_content_revision,
      input_sha256,
      reason,
      migration_identifier
    )
    select
      acceptances.event_id,
      acceptances.content_revision,
      acceptances.input_sha256,
      'pre_build_2_5_publication',
      'policy_acceptance_test_exact_revision'
    from private.event_policy_acceptances as acceptances
    where acceptances.event_id = '73100000-0000-4000-8000-000000000001'
  $$,
  'the rollback fixture records one exact-revision legacy exemption'
);

select lives_ok(
  $$
    update public.events
    set content_revision = 2
    where id = '73100000-0000-4000-8000-000000000001'
  $$,
  'the rollback fixture advances the event revision without advancing legacy evidence'
);

select set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select results_eq(
  $$
    select needs_acceptance
    from public.get_owned_event_requirements('73100000-0000-4000-8000-000000000001')
  $$,
  $$ values (true) $$,
  'a new event revision requires a new acceptance'
);
select results_eq(
  $$
    select needs_acceptance
    from public.accept_current_event_policies('73100000-0000-4000-8000-000000000001')
  $$,
  $$ values (false) $$,
  'the owner can accept the current pair for the new revision'
);
reset role;

select results_eq(
  $$
    select
      exemptions.grandfathered_content_revision,
      exemptions.input_sha256 = acceptances.input_sha256,
      events.content_revision
    from private.event_policy_legacy_exemptions as exemptions
    join public.events as events on events.id = exemptions.event_id
    join private.event_policy_acceptances as acceptances
      on acceptances.event_id = exemptions.event_id
      and acceptances.content_revision = 1
    where exemptions.event_id = '73100000-0000-4000-8000-000000000001'
  $$,
  $$ values (1::bigint, true, 2::bigint) $$,
  'legacy exemption evidence remains bound to its exact old revision and digest'
);

select lives_ok(
  $$
    insert into private.organizer_policy_versions (
      id,
      policy_kind,
      stage,
      public_url,
      content_sha256,
      effective_at
    )
    values
      (
        'dev-organizer-terms-v2',
        'organizer_terms',
        'development_placeholder',
        '/organizer-terms-v2',
        repeat('c', 64),
        '2026-08-27 00:00:00+00'
      ),
      (
        'dev-event-policy-v2',
        'event_policy',
        'development_placeholder',
        '/event-policy-v2',
        repeat('d', 64),
        '2026-08-27 00:00:00+00'
      );

    update private.organizer_policy_requirements
    set
      policy_version_id = case policy_kind
        when 'organizer_terms' then 'dev-organizer-terms-v2'
        else 'dev-event-policy-v2'
      end,
      updated_at = statement_timestamp();
  $$,
  'a reviewed immutable development pair can become current without rewriting v1'
);

set local role anon;
select results_eq(
  $$
    select (projection.value ->> 'id')::uuid
    from public.get_public_event(
      '73100000-0000-4000-8000-000000000002'
    ) as projection(value)
  $$,
  $$ select null::uuid where false $$,
  'the canonical public projection fails closed while the required development pair is invalid'
);
reset role;

select set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$
    select *
    from public.get_owned_event_requirements(
      '73100000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'POLICY_REQUIREMENTS_INVALID',
  'development fails closed when requirements differ from the exact placeholder pair'
);
reset role;

select results_eq(
  $$
    select count(*)::bigint
    from private.event_policy_acceptances
    where event_id = '73100000-0000-4000-8000-000000000001'
  $$,
  $$ values (2::bigint) $$,
  'a mismatched development pair cannot create acceptance history'
);

select results_eq(
  $$
    select count(*)::bigint
    from private.event_policy_acceptances as acceptances
    join private.organizer_policy_versions as organizer_terms
      on organizer_terms.id = acceptances.organizer_terms_version_id
      and organizer_terms.policy_kind = 'organizer_terms'
    join private.organizer_policy_versions as event_policy
      on event_policy.id = acceptances.event_policy_version_id
      and event_policy.policy_kind = 'event_policy'
    where acceptances.event_id = '73100000-0000-4000-8000-000000000001'
      and (
        organizer_terms.stage <> 'development_placeholder'
        or event_policy.stage <> 'development_placeholder'
      )
  $$,
  $$ values (0::bigint) $$,
  'development acceptance remains explicitly non-production'
);

select throws_ok(
  $$
    update private.organizer_policy_versions
    set stage = 'production_approved'
    where id = 'dev-organizer-terms-v1'
  $$,
  'P0001',
  'POLICY_VERSION_IMMUTABLE',
  'a placeholder version cannot be relabeled production-approved'
);

set local role service_role;
select throws_ok(
  $$ select private.configure_policy_environment('development') $$,
  'P0001',
  'DEVELOPMENT_POLICY_CONFIGURATION_INVALID',
  'development configuration requires the exact founder-approved placeholder pair'
);
select throws_ok(
  $$ select private.configure_policy_environment('production') $$,
  'P0001',
  'PRODUCTION_POLICY_CONFIGURATION_NOT_READY',
  'production configuration rejects a development-placeholder pair'
);
select throws_ok(
  $$ select private.configure_policy_environment('unconfigured') $$,
  '22023',
  'POLICY_ENVIRONMENT_INVALID',
  'the operational boundary accepts only literal development or production'
);
reset role;

select throws_ok(
  $$
    insert into private.organizer_policy_versions (
      id, policy_kind, stage, public_url, content_sha256, effective_at
    )
    values (
      'dev-forged-production-v1',
      'organizer_terms',
      'production_approved',
      'https://whereto.example/legal/forged',
      repeat('e', 64),
      '2026-08-27 00:00:00+00'
    )
  $$,
  '23514',
  null,
  'a development-prefixed identifier cannot be production-approved'
);

select throws_ok(
  $$
    insert into private.organizer_policy_versions (
      id, policy_kind, stage, public_url, content_sha256, effective_at
    )
    values (
      'prod-relative-url-v1',
      'organizer_terms',
      'production_approved',
      '/relative-production-policy',
      repeat('e', 64),
      '2026-08-27 00:00:00+00'
    )
  $$,
  '23514',
  null,
  'a production-approved version requires a canonical HTTPS URL'
);

select throws_ok(
  $$
    insert into private.organizer_policy_versions (
      id, policy_kind, stage, public_url, content_sha256, effective_at
    )
    values (
      'prod-dot-host-v1', 'organizer_terms', 'production_approved',
      'https://./', repeat('e', 64), '2026-08-27 00:00:00+00'
    )
  $$,
  '23514', null,
  'a production policy rejects a dot-only host'
);

select throws_ok(
  $$
    insert into private.organizer_policy_versions (
      id, policy_kind, stage, public_url, content_sha256, effective_at
    )
    values (
      'prod-empty-label-v1', 'organizer_terms', 'production_approved',
      'https://bad..example/legal', repeat('e', 64), '2026-08-27 00:00:00+00'
    )
  $$,
  '23514', null,
  'a production policy rejects an empty DNS label'
);

select throws_ok(
  $$
    insert into private.organizer_policy_versions (
      id, policy_kind, stage, public_url, content_sha256, effective_at
    )
    values (
      'prod-leading-hyphen-v1', 'organizer_terms', 'production_approved',
      'https://-bad.example/legal', repeat('e', 64), '2026-08-27 00:00:00+00'
    )
  $$,
  '23514', null,
  'a production policy rejects a DNS label with a leading hyphen'
);

select throws_ok(
  $$
    insert into private.organizer_policy_versions (
      id, policy_kind, stage, public_url, content_sha256, effective_at
    )
    values (
      'prod-trailing-hyphen-v1', 'organizer_terms', 'production_approved',
      'https://bad-.example/legal', repeat('e', 64), '2026-08-27 00:00:00+00'
    )
  $$,
  '23514', null,
  'a production policy rejects a DNS label with a trailing hyphen'
);

select throws_ok(
  $$
    insert into private.organizer_policy_versions (
      id, policy_kind, stage, public_url, content_sha256, effective_at
    )
    values (
      'prod-ip-host-v1', 'organizer_terms', 'production_approved',
      'https://127.0.0.1/legal', repeat('e', 64), '2026-08-27 00:00:00+00'
    )
  $$,
  '23514', null,
  'a production policy requires a DNS hostname rather than an IP literal'
);

select throws_ok(
  $$
    insert into private.organizer_policy_versions (
      id, policy_kind, stage, public_url, content_sha256, effective_at
    )
    values (
      'dev-absolute-url-v1',
      'organizer_terms',
      'development_placeholder',
      'https://whereto.example/legal/development',
      repeat('e', 64),
      '2026-08-27 00:00:00+00'
    )
  $$,
  '23514',
  null,
  'a development placeholder uses only a relative application route'
);

select lives_ok(
  $$
    insert into private.organizer_policy_versions (
      id,
      policy_kind,
      stage,
      public_url,
      content_sha256,
      effective_at
    )
    values
      (
        'prod-organizer-terms-2026-08-27',
        'organizer_terms',
        'production_approved',
        'https://whereto.example/legal/organizer-terms/2026-08-27',
        repeat('a', 64),
        '2026-08-27 00:00:00+00'
      ),
      (
        'prod-event-policy-2026-08-27',
        'event_policy',
        'production_approved',
        'https://whereto.example/legal/event-policy/2026-08-27',
        repeat('b', 64),
        '2026-08-27 00:00:00+00'
      );

    update private.organizer_policy_requirements
    set
      policy_version_id = case policy_kind
        when 'organizer_terms' then 'prod-organizer-terms-2026-08-27'
        else 'prod-event-policy-2026-08-27'
      end,
      updated_at = statement_timestamp();
  $$,
  'the rollback fixture installs two distinct approved production versions'
);

set local role service_role;
select lives_ok(
  $$ select private.configure_policy_environment('production') $$,
  'production configuration accepts only the complete production-approved pair'
);
select is(
  private.production_policy_configuration_is_ready(),
  true,
  'two current production-stage HTTPS versions make the production gate ready'
);
reset role;

select set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select results_eq(
  $$
    select needs_acceptance, organizer_terms_version_id, organizer_terms_stage,
      event_policy_version_id, event_policy_stage
    from public.get_owned_event_requirements(
      '73100000-0000-4000-8000-000000000001'
    )
  $$,
  $$
    values (
      true,
      'prod-organizer-terms-2026-08-27'::text,
      'production_approved'::text,
      'prod-event-policy-2026-08-27'::text,
      'production_approved'::text
    )
  $$,
  'a valid rollback-only production pair requires a new immutable acceptance row'
);
select results_eq(
  $$
    select needs_acceptance, organizer_terms_version_id, organizer_terms_stage,
      event_policy_version_id, event_policy_stage
    from public.accept_current_event_policies(
      '73100000-0000-4000-8000-000000000001'
    )
  $$,
  $$
    values (
      false,
      'prod-organizer-terms-2026-08-27'::text,
      'production_approved'::text,
      'prod-event-policy-2026-08-27'::text,
      'production_approved'::text
    )
  $$,
  'a new valid required pair creates a new immutable acceptance row'
);
reset role;

select results_eq(
  $$
    select count(*)::bigint
    from private.event_policy_acceptances
    where event_id = '73100000-0000-4000-8000-000000000001'
  $$,
  $$ values (3::bigint) $$,
  'revision and valid required-pair changes create separate immutable rows'
);

select results_eq(
  $$
    select id, stage, public_url, content_sha256
    from private.organizer_policy_versions
    where id in ('dev-organizer-terms-v1', 'dev-event-policy-v1')
    order by id
  $$,
  $$
    values
      (
        'dev-event-policy-v1'::text,
        'development_placeholder'::text,
        '/event-policy'::text,
        '797aa818b4e7ee9b1d9eb8e7b5b4dba013616080cdf09ccf33875c9a81429de3'::text
      ),
      (
        'dev-organizer-terms-v1'::text,
        'development_placeholder'::text,
        '/organizer-terms'::text,
        '5adc8a233232f30a58152a663394ce01d0af29ddbff8401bdad7f836ee49d475'::text
      )
  $$,
  'production readiness never rewrites a development placeholder'
);

select lives_ok(
  $$
    update private.organizer_policy_requirements
    set policy_version_id = 'dev-event-policy-v1', updated_at = statement_timestamp()
    where policy_kind = 'event_policy'
  $$,
  'the rollback fixture reintroduces one placeholder requirement'
);

set local role service_role;
select is(
  private.production_policy_configuration_is_ready(),
  false,
  'either placeholder in the current production pair fails readiness closed'
);
reset role;

select lives_ok(
  $$
    update private.organizer_policy_release_settings
    set environment = 'unconfigured'
    where singleton_id
  $$,
  'the rollback fixture restores the fail-closed environment'
);

set local role service_role;
select is(
  private.production_policy_configuration_is_ready(),
  false,
  'an unconfigured environment can never report production readiness'
);
reset role;

select * from finish();
rollback;
