begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(48);

select results_eq(
  $$
    select count(*) = 1
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'private'
      and procedures.proname = 'classify_legacy_event_moderation'
      and pg_catalog.pg_get_function_identity_arguments(procedures.oid) =
        'p_lifecycle_status text, p_legacy_moderation_status text, p_evidence_code text, p_prior_public_observed_at timestamp with time zone'
  $$,
  $$ values (true) $$,
  'the owner-only legacy classifier exists with the exact pure interface'
);

select results_eq(
  $$
    select procedures.provolatile = 'i' and procedures.proparallel = 's'
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'private'
      and procedures.proname = 'classify_legacy_event_moderation'
      and pg_catalog.pg_get_function_identity_arguments(procedures.oid) =
        'p_lifecycle_status text, p_legacy_moderation_status text, p_evidence_code text, p_prior_public_observed_at timestamp with time zone'
  $$,
  $$ values (true) $$,
  'the legacy classifier is immutable and parallel safe'
);

select results_eq(
  $$
    select count(*)
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(procedures.proacl, pg_catalog.acldefault('f', procedures.proowner))
    ) as privileges
    left join pg_catalog.pg_roles as roles on roles.oid = privileges.grantee
    where namespaces.nspname = 'private'
      and procedures.proname in (
        'classify_legacy_event_moderation',
        'initialize_event_public_eligibility_interval',
        'reconcile_legacy_moderation_events'
      )
      and privileges.privilege_type = 'EXECUTE'
      and (
        privileges.grantee = 0
        or roles.rolname in ('anon', 'authenticated', 'service_role')
      )
  $$,
  $$ values (0::bigint) $$,
  'legacy classification and initialization helpers remain owner-only'
);

select results_eq(
  $$
    select
      procedures.prosecdef
      and procedures.provolatile = 'v'
      and procedures.proconfig = array['search_path=""']::text[]
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'private'
      and procedures.proname = 'reconcile_legacy_moderation_events'
      and pg_catalog.pg_get_function_identity_arguments(procedures.oid) =
        'p_event_ids uuid[]'
  $$,
  $$ values (true) $$,
  'the reconciliation seam is volatile security-definer code with an empty search path'
);

select col_not_null(
  'public',
  'events',
  'public_history_status',
  'legacy migration makes public history explicit for every event'
);

select col_default_is(
  'public',
  'events',
  'public_history_status',
  'never_public',
  'new events default to never-public history'
);

select col_default_is(
  'public',
  'events',
  'moderation_status',
  'not_evaluated',
  'new events default to not-evaluated moderation'
);

select results_eq(
  $$
    select regexp_replace(
      pg_catalog.pg_get_constraintdef(constraints.oid),
      '[[:space:]]+',
      ' ',
      'g'
    )
    from pg_catalog.pg_constraint as constraints
    join pg_catalog.pg_class as relations on relations.oid = constraints.conrelid
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = relations.relnamespace
    where namespaces.nspname = 'public'
      and relations.relname = 'events'
      and constraints.conname = 'events_moderation_status_check'
  $$,
  $$
    values (
      'CHECK ((moderation_status = ANY (ARRAY[''not_evaluated''::text, ''clear''::text, ''under_review''::text, ''blocked''::text, ''removed''::text])))'::text
    )
  $$,
  'event moderation uses exactly the final vocabulary'
);

insert into auth.users (id, email)
values (
  '61000000-0000-0000-0000-000000000000',
  'legacy-moderation-test@example.invalid'
);

insert into public.organizers (id, display_name)
values (
  '61000000-0000-0000-0000-000000000000',
  'Digest Organizer'
);

insert into public.events (
  id,
  organizer_id,
  title,
  description,
  category,
  starts_at,
  ends_at,
  venue_name,
  address_line1,
  city,
  region,
  postal_code,
  country_code,
  mapbox_feature_id,
  latitude,
  longitude,
  admission_type
)
values (
  '61000000-0000-0000-0000-000000000010',
  '61000000-0000-0000-0000-000000000000',
  'Digest Fixture',
  'A deterministic legacy moderation digest fixture.',
  'community',
  '2030-01-02 18:00:00+00',
  '2030-01-02 20:00:00+00',
  'Civic Hall',
  '1 Market Street',
  'San Francisco',
  'CA',
  '94105',
  'US',
  'mapbox.digest-fixture',
  37.7936,
  -122.3958,
  'paid'
);

insert into public.ticket_tiers (
  id,
  event_id,
  name,
  description,
  unit_amount_minor,
  quantity_total,
  status,
  sort_order
)
values
  (
    '61000000-0000-0000-0000-000000000002',
    '61000000-0000-0000-0000-000000000010',
    'General',
    null,
    2500,
    100,
    'draft',
    1
  ),
  (
    '61000000-0000-0000-0000-000000000001',
    '61000000-0000-0000-0000-000000000010',
    'Gold',
    'Front section',
    5000,
    25,
    'draft',
    2
  );

select throws_ok(
  $$
    update public.events
    set moderation_status = 'flagged'
    where id = '61000000-0000-0000-0000-000000000010'
  $$,
  '23514',
  null,
  'legacy flagged can no longer be stored on an event'
);

select has_trigger(
  'public',
  'events',
  'events_initialize_public_eligibility_interval',
  'new events initialize an eligibility epoch through a trigger'
);

select results_eq(
  $$
    select moderation_status, public_history_status, public_eligibility_version
    from public.events
    where id = '61000000-0000-0000-0000-000000000010'
  $$,
  $$ values ('not_evaluated'::text, 'never_public'::text, 0::bigint) $$,
  'a new event receives final moderation and history defaults'
);

select results_eq(
  $$
    select
      public_eligibility_version,
      eligibility_state,
      ended_at is null,
      started_action_id is null,
      ended_action_id is null,
      transition_reason
    from private.event_public_eligibility_intervals
    where event_id = '61000000-0000-0000-0000-000000000010'
  $$,
  $$ values (0::bigint, 'ineligible'::text, true, true, true, 'initialization'::text) $$,
  'a new event receives exactly one open version-zero ineligible interval'
);

select results_eq(
  $$
    select
      publicly_authorized_revision is null,
      publicly_authorized_action_id is null,
      count(actions.id),
      count(exemptions.id)
    from public.events as events
    left join private.event_moderation_actions as actions on actions.event_id = events.id
    left join private.event_policy_legacy_exemptions as exemptions on exemptions.event_id = events.id
    where events.id = '61000000-0000-0000-0000-000000000010'
    group by events.publicly_authorized_revision, events.publicly_authorized_action_id
  $$,
  $$ values (true, true, 0::bigint, 0::bigint) $$,
  'post-rollout events do not receive legacy authorization evidence'
);

insert into auth.users (id, email)
values
  (
    '62000000-0000-0000-0000-000000000000',
    'legacy-reconciliation-matrix@example.invalid'
  ),
  (
    '63000000-0000-0000-0000-000000000000',
    'legacy-reconciliation-stale@example.invalid'
  );

insert into public.organizers (id, display_name)
values
  ('62000000-0000-0000-0000-000000000000', 'Matrix Organizer'),
  ('63000000-0000-0000-0000-000000000000', 'Stale Evidence Organizer');

create temporary table legacy_matrix_fixture (
  fixture_key text primary key,
  ordinal integer not null unique,
  event_id uuid not null unique,
  source_action_id uuid not null unique,
  lifecycle_status text not null,
  legacy_moderation_status text not null,
  source_evidence_code text not null,
  source_observed_at timestamptz not null,
  expected_public_history_status text not null,
  expected_legacy_exemption boolean not null
) on commit drop;

insert into legacy_matrix_fixture values
  ('01_published_clear_contradictory', 1, '62000000-0000-0000-0000-000000000001', '62100000-0000-0000-0000-000000000001', 'published', 'clear', 'contradictory_evidence', '2026-08-26 01:01:01+00', 'previously_public', true),
  ('02_published_flagged_contradictory', 2, '62000000-0000-0000-0000-000000000002', '62100000-0000-0000-0000-000000000002', 'published', 'flagged', 'contradictory_evidence', '2026-08-26 01:01:02+00', 'previously_public', true),
  ('03_published_blocked', 3, '62000000-0000-0000-0000-000000000003', '62100000-0000-0000-0000-000000000003', 'published', 'blocked', 'no_positive_evidence', '2026-08-26 01:01:03+00', 'unknown', false),
  ('04_published_removed', 4, '62000000-0000-0000-0000-000000000004', '62100000-0000-0000-0000-000000000004', 'published', 'removed', 'no_positive_evidence', '2026-08-26 01:01:04+00', 'unknown', false),
  ('05_draft_clear', 5, '62000000-0000-0000-0000-000000000005', '62100000-0000-0000-0000-000000000005', 'draft', 'clear', 'no_positive_evidence', '2026-08-26 01:01:05+00', 'unknown', false),
  ('06_draft_flagged', 6, '62000000-0000-0000-0000-000000000006', '62100000-0000-0000-0000-000000000006', 'draft', 'flagged', 'no_positive_evidence', '2026-08-26 01:01:06+00', 'unknown', false),
  ('07_draft_blocked', 7, '62000000-0000-0000-0000-000000000007', '62100000-0000-0000-0000-000000000007', 'draft', 'blocked', 'no_positive_evidence', '2026-08-26 01:01:07+00', 'unknown', false),
  ('08_draft_removed', 8, '62000000-0000-0000-0000-000000000008', '62100000-0000-0000-0000-000000000008', 'draft', 'removed', 'no_positive_evidence', '2026-08-26 01:01:08+00', 'unknown', false),
  ('09_cancelled_clear', 9, '62000000-0000-0000-0000-000000000009', '62100000-0000-0000-0000-000000000009', 'cancelled', 'clear', 'no_positive_evidence', '2026-08-26 01:01:09+00', 'unknown', false),
  ('10_cancelled_flagged', 10, '62000000-0000-0000-0000-000000000010', '62100000-0000-0000-0000-000000000010', 'cancelled', 'flagged', 'no_positive_evidence', '2026-08-26 01:01:10+00', 'unknown', false),
  ('11_cancelled_blocked', 11, '62000000-0000-0000-0000-000000000011', '62100000-0000-0000-0000-000000000011', 'cancelled', 'blocked', 'no_positive_evidence', '2026-08-26 01:01:11+00', 'unknown', false),
  ('12_cancelled_removed', 12, '62000000-0000-0000-0000-000000000012', '62100000-0000-0000-0000-000000000012', 'cancelled', 'removed', 'no_positive_evidence', '2026-08-26 01:01:12+00', 'unknown', false);

insert into public.events (
  id,
  organizer_id,
  status,
  moderation_status,
  title,
  description,
  category,
  public_history_status,
  moderation_version,
  published_at
)
select
  fixtures.event_id,
  '62000000-0000-0000-0000-000000000000',
  fixtures.lifecycle_status,
  'under_review',
  'Legacy matrix ' || fixtures.fixture_key,
  'Exercises the locked production reconciliation boundary.',
  'community',
  'unknown',
  1,
  '2026-08-20 12:00:00+00'
from legacy_matrix_fixture as fixtures;

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
select event_id, 'all_ages', false, false, false, false, false, false
from legacy_matrix_fixture;

insert into public.ticket_tiers (
  id,
  event_id,
  name,
  description,
  unit_amount_minor,
  quantity_total,
  sort_order
)
select
  ('62200000-0000-0000-0000-' || lpad(ordinal::text, 12, '0'))::uuid,
  event_id,
  'Legacy tier ' || ordinal,
  'Moderated public tier text',
  1000 + ordinal,
  10,
  1
from legacy_matrix_fixture;

create temporary table legacy_matrix_input on commit drop as
select
  events.id as event_id,
  encode(
    extensions.digest(
      jsonb_build_object(
        'event', jsonb_build_object(
          'title', events.title,
          'description', events.description,
          'category', events.category,
          'venue_name', events.venue_name,
          'starts_at', events.starts_at,
          'ends_at', events.ends_at,
          'timezone', events.timezone,
          'address_line1', events.address_line1,
          'address_line2', events.address_line2,
          'city', events.city,
          'region', events.region,
          'postal_code', events.postal_code,
          'country_code', events.country_code,
          'mapbox_feature_id', events.mapbox_feature_id,
          'latitude', events.latitude,
          'longitude', events.longitude,
          'admission_type', events.admission_type
        ),
        'disclosures', jsonb_build_object(
          'minimum_age', disclosures.minimum_age,
          'alcohol_present', disclosures.alcohol_present,
          'cannabis_present', disclosures.cannabis_present,
          'explicit_adult_content', disclosures.explicit_adult_content,
          'gambling_present', disclosures.gambling_present,
          'weapons_present', disclosures.weapons_present,
          'high_risk_activity', disclosures.high_risk_activity
        ),
        'artwork', jsonb_build_object(
          'path', events.artwork_path,
          'verification_state', case
            when events.artwork_path is null then 'not_present'
            else 'unverified'
          end
        ),
        'ticket_tiers', coalesce(tiers.public_tiers, '[]'::jsonb),
        'organizer_display_name', organizers.display_name
      )::text,
      'sha256'
    ),
    'hex'
  ) as input_sha256
from public.events as events
join legacy_matrix_fixture as fixtures on fixtures.event_id = events.id
join public.organizers as organizers on organizers.id = events.organizer_id
left join private.event_risk_disclosures as disclosures
  on disclosures.event_id = events.id
left join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'name', ticket_tiers.name,
      'description', ticket_tiers.description
    )
    order by ticket_tiers.id
  ) as public_tiers
  from public.ticket_tiers
  where ticket_tiers.event_id = events.id
) as tiers on true;

insert into private.event_moderation_actions (
  id,
  event_id,
  content_revision,
  input_sha256,
  actor_type,
  source,
  action,
  previous_status,
  new_status,
  previous_public_history_status,
  new_public_history_status,
  reason_code,
  internal_note,
  moderation_version,
  created_at
)
select
  fixtures.source_action_id,
  fixtures.event_id,
  1,
  inputs.input_sha256,
  'system',
  'migration',
  'hold',
  'under_review',
  'under_review',
  null,
  'unknown',
  'other',
  format(
    'legacy_lifecycle_status=%s;legacy_moderation_status=%s;evidence_code=%s;classification_reason=%s',
    fixtures.lifecycle_status,
    fixtures.legacy_moderation_status,
    fixtures.source_evidence_code,
    case
      when fixtures.source_evidence_code = 'contradictory_evidence'
        then 'quarantined_invalid_or_contradictory_evidence'
      else 'quarantined_without_positive_history_evidence'
    end
  ),
  1,
  fixtures.source_observed_at
from legacy_matrix_fixture as fixtures
join legacy_matrix_input as inputs on inputs.event_id = fixtures.event_id;

create temporary table legacy_matrix_actual (
  event_id uuid,
  legacy_lifecycle_status text,
  legacy_moderation_status text,
  moderation_status text,
  public_history_status text,
  qualifies_for_legacy_exemption boolean,
  authorization_state text,
  current_input_sha256 text,
  source_action_id uuid,
  reconciliation_action_id uuid
) on commit drop;

do $capture_legacy_matrix$
begin
  if pg_catalog.to_regprocedure(
    'private.reconcile_legacy_moderation_events(uuid[])'
  ) is not null then
    execute $capture$
      insert into legacy_matrix_actual
      select *
      from private.reconcile_legacy_moderation_events(
        array(
          select event_id
          from legacy_matrix_fixture
          order by event_id
        )
      )
    $capture$;
  end if;
end;
$capture_legacy_matrix$;

select results_eq(
  $$ select count(*) from legacy_matrix_actual $$,
  $$ values (12::bigint) $$,
  'the production reconciliation seam processes every matrix fixture non-vacuously'
);

select results_eq(
  $$
    select
      fixtures.fixture_key,
      events.moderation_status,
      events.public_history_status
    from legacy_matrix_fixture as fixtures
    join public.events as events on events.id = fixtures.event_id
    order by fixtures.fixture_key
  $$,
  $$
    select
      fixture_key,
      'under_review'::text,
      expected_public_history_status
    from legacy_matrix_fixture
    order by fixture_key
  $$,
  'the actual locked mutation seam maps all lifecycle and legacy-moderation combinations'
);

select results_eq(
  $$
    select
      fixtures.fixture_key,
      actual.legacy_lifecycle_status,
      actual.legacy_moderation_status,
      actual.qualifies_for_legacy_exemption
    from legacy_matrix_fixture as fixtures
    join legacy_matrix_actual as actual on actual.event_id = fixtures.event_id
    order by fixtures.fixture_key
  $$,
  $$
    select
      fixture_key,
      lifecycle_status,
      legacy_moderation_status,
      expected_legacy_exemption
    from legacy_matrix_fixture
    order by fixture_key
  $$,
  'the production seam selects immutable normalization evidence instead of caller evidence'
);

select results_eq(
  $$
    select fixtures.fixture_key, events.first_publicly_eligible_at
    from legacy_matrix_fixture as fixtures
    join public.events as events on events.id = fixtures.event_id
    order by fixtures.fixture_key
  $$,
  $$
    select
      fixture_key,
      case when expected_legacy_exemption then source_observed_at else null end
    from legacy_matrix_fixture
    order by fixture_key
  $$,
  'only conclusive old-public fixtures receive the immutable observation time'
);

select results_eq(
  $$
    select
      count(*),
      count(*) filter (where intervals.eligibility_state = 'eligible')
    from legacy_matrix_fixture as fixtures
    join private.event_public_eligibility_intervals as intervals
      on intervals.event_id = fixtures.event_id
      and intervals.public_eligibility_version = 0
      and intervals.ended_at is null
  $$,
  $$ values (12::bigint, 0::bigint) $$,
  'every matrix fixture keeps exactly its open version-zero ineligible interval'
);

select results_eq(
  $$
    select count(*)
    from legacy_matrix_fixture as fixtures
    join private.event_policy_legacy_exemptions as exemptions
      on exemptions.event_id = fixtures.event_id
      and exemptions.grandfathered_content_revision = 1
    join legacy_matrix_input as inputs
      on inputs.event_id = fixtures.event_id
      and inputs.input_sha256 = exemptions.input_sha256
    where fixtures.expected_legacy_exemption
      and exemptions.migration_identifier =
        '20260826010150_harden_legacy_moderation_migration'
  $$,
  $$ values (2::bigint) $$,
  'the two old-public precedence fixtures receive exact forward exemptions'
);

select results_eq(
  $$
    select count(*)
    from legacy_matrix_fixture as fixtures
    join public.events as events on events.id = fixtures.event_id
    join private.event_moderation_actions as authorization_actions
      on authorization_actions.id = events.publicly_authorized_action_id
    join private.event_policy_legacy_exemptions as exemptions
      on exemptions.id = authorization_actions.policy_legacy_exemption_id
    where fixtures.expected_legacy_exemption
      and events.publicly_authorized_revision = events.content_revision
      and authorization_actions.actor_type = 'system'
      and authorization_actions.actor_user_id is null
      and authorization_actions.policy_acceptance_id is null
  $$,
  $$ values (2::bigint) $$,
  'old-public authorization pointers are atomic and fabricate no actor or acceptance'
);

select results_eq(
  $$
    select count(*)
    from legacy_matrix_fixture as fixtures
    join public.events as events on events.id = fixtures.event_id
    join private.event_moderation_evaluations as evaluations
      on evaluations.event_id = events.id
      and evaluations.content_revision = events.content_revision
      and evaluations.queued_moderation_version = events.moderation_version
      and evaluations.source = 'contextual'
      and evaluations.status = 'queued'
    join private.event_moderation_actions as correction_actions
      on correction_actions.event_id = events.id
      and correction_actions.source = 'migration'
      and correction_actions.action = 'resolve_legacy_history'
      and correction_actions.evaluation_id = evaluations.id
      and correction_actions.internal_note ~
        '^source_normalization_action_id=[a-f0-9-]+;reconciliation=old_public_precedence$'
    where fixtures.expected_legacy_exemption
  $$,
  $$ values (2::bigint) $$,
  'old-public corrections have non-vacuous current evaluations and bounded audit evidence'
);

select results_eq(
  $$
    select count(*)
    from legacy_matrix_fixture as fixtures
    left join private.event_policy_legacy_exemptions as exemptions
      on exemptions.event_id = fixtures.event_id
    where not fixtures.expected_legacy_exemption
      and exemptions.id is not null
  $$,
  $$ values (0::bigint) $$,
  'ambiguous legacy combinations receive no exemption or authorization evidence'
);

insert into public.events (
  id,
  organizer_id,
  status,
  moderation_status,
  title,
  description,
  public_history_status,
  first_publicly_eligible_at,
  moderation_version,
  published_at
)
values (
  '63000000-0000-0000-0000-000000000010',
  '63000000-0000-0000-0000-000000000000',
  'published',
  'under_review',
  'Stale immutable legacy evidence',
  'The related tier will change after immutable evidence is recorded.',
  'previously_public',
  '2026-08-26 01:02:00+00',
  1,
  '2026-08-20 12:00:00+00'
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
values (
  '63200000-0000-0000-0000-000000000001',
  '63000000-0000-0000-0000-000000000010',
  'Original moderated tier',
  'Immutable input evidence',
  2000,
  20,
  1
);

create temporary table stale_original_input on commit drop as
select encode(
  extensions.digest(
    jsonb_build_object(
      'event', jsonb_build_object(
        'title', events.title,
        'description', events.description,
        'category', events.category,
        'venue_name', events.venue_name,
        'starts_at', events.starts_at,
        'ends_at', events.ends_at,
        'timezone', events.timezone,
        'address_line1', events.address_line1,
        'address_line2', events.address_line2,
        'city', events.city,
        'region', events.region,
        'postal_code', events.postal_code,
        'country_code', events.country_code,
        'mapbox_feature_id', events.mapbox_feature_id,
        'latitude', events.latitude,
        'longitude', events.longitude,
        'admission_type', events.admission_type
      ),
      'disclosures', jsonb_build_object(
        'minimum_age', disclosures.minimum_age,
        'alcohol_present', disclosures.alcohol_present,
        'cannabis_present', disclosures.cannabis_present,
        'explicit_adult_content', disclosures.explicit_adult_content,
        'gambling_present', disclosures.gambling_present,
        'weapons_present', disclosures.weapons_present,
        'high_risk_activity', disclosures.high_risk_activity
      ),
      'artwork', jsonb_build_object(
        'path', events.artwork_path,
        'verification_state', case
          when events.artwork_path is null then 'not_present'
          else 'unverified'
        end
      ),
      'ticket_tiers', coalesce(tiers.public_tiers, '[]'::jsonb),
      'organizer_display_name', organizers.display_name
    )::text,
    'sha256'
  ),
  'hex'
) as input_sha256
from public.events as events
join public.organizers as organizers on organizers.id = events.organizer_id
left join private.event_risk_disclosures as disclosures
  on disclosures.event_id = events.id
left join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'name', ticket_tiers.name,
      'description', ticket_tiers.description
    )
    order by ticket_tiers.id
  ) as public_tiers
  from public.ticket_tiers
  where ticket_tiers.event_id = events.id
) as tiers on true
where events.id = '63000000-0000-0000-0000-000000000010';

insert into private.event_moderation_evaluations (
  id,
  event_id,
  content_revision,
  input_sha256,
  queued_moderation_version,
  source,
  created_at
)
select
  '63400000-0000-0000-0000-000000000001',
  '63000000-0000-0000-0000-000000000010',
  1,
  input_sha256,
  1,
  'contextual',
  '2026-08-26 01:02:00+00'
from stale_original_input;

insert into private.event_moderation_actions (
  id,
  event_id,
  content_revision,
  input_sha256,
  actor_type,
  source,
  action,
  previous_status,
  new_status,
  previous_public_history_status,
  new_public_history_status,
  reason_code,
  internal_note,
  evaluation_id,
  moderation_version,
  created_at
)
select
  '63100000-0000-0000-0000-000000000001',
  '63000000-0000-0000-0000-000000000010',
  1,
  input_sha256,
  'system',
  'migration',
  'hold',
  'under_review',
  'under_review',
  null,
  'previously_public',
  'other',
  'legacy_lifecycle_status=published;legacy_moderation_status=clear;evidence_code=old_public_rls_observation;classification_reason=observed_old_public_rls',
  '63400000-0000-0000-0000-000000000001',
  1,
  '2026-08-26 01:02:00+00'
from stale_original_input;

insert into private.event_policy_legacy_exemptions (
  id,
  event_id,
  grandfathered_content_revision,
  input_sha256,
  migration_identifier,
  created_at
)
select
  '63500000-0000-0000-0000-000000000001',
  '63000000-0000-0000-0000-000000000010',
  1,
  input_sha256,
  '20260826010100_migrate_legacy_moderation',
  '2026-08-26 01:02:00+00'
from stale_original_input;

insert into private.event_moderation_actions (
  id,
  event_id,
  content_revision,
  input_sha256,
  actor_type,
  source,
  action,
  previous_status,
  new_status,
  previous_public_history_status,
  new_public_history_status,
  reason_code,
  internal_note,
  policy_legacy_exemption_id,
  moderation_version,
  created_at
)
select
  '63300000-0000-0000-0000-000000000001',
  '63000000-0000-0000-0000-000000000010',
  1,
  input_sha256,
  'system',
  'migration',
  'authorize_publication',
  'under_review',
  'under_review',
  'previously_public',
  'previously_public',
  'other',
  'exact unchanged pre-rollout revision authorized by migration-only legacy exemption',
  '63500000-0000-0000-0000-000000000001',
  1,
  '2026-08-26 01:02:00+00'
from stale_original_input;

update public.events
set
  publicly_authorized_revision = 1,
  publicly_authorized_action_id = '63300000-0000-0000-0000-000000000001'
where id = '63000000-0000-0000-0000-000000000010';

update public.ticket_tiers
set name = 'Changed after immutable evidence'
where id = '63200000-0000-0000-0000-000000000001';

create temporary table stale_reconciliation_actual (
  event_id uuid,
  legacy_lifecycle_status text,
  legacy_moderation_status text,
  moderation_status text,
  public_history_status text,
  qualifies_for_legacy_exemption boolean,
  authorization_state text,
  current_input_sha256 text,
  source_action_id uuid,
  reconciliation_action_id uuid
) on commit drop;

do $capture_stale_reconciliation$
begin
  if pg_catalog.to_regprocedure(
    'private.reconcile_legacy_moderation_events(uuid[])'
  ) is not null then
    execute $capture$
      insert into stale_reconciliation_actual
      select *
      from private.reconcile_legacy_moderation_events(
        array['63000000-0000-0000-0000-000000000010'::uuid]
      )
    $capture$;
  end if;
end;
$capture_stale_reconciliation$;

select results_eq(
  $$
    select event_id, authorization_state
    from stale_reconciliation_actual
  $$,
  $$
    values (
      '63000000-0000-0000-0000-000000000010'::uuid,
      'stale_evidence_unauthorized'::text
    )
  $$,
  'related-content drift is detected inside the production reconciliation seam'
);

select results_eq(
  $$
    select count(*)
    from private.event_policy_legacy_exemptions as exemptions
    join private.event_moderation_actions as authorization_actions
      on authorization_actions.policy_legacy_exemption_id = exemptions.id
    join stale_original_input as original
      on original.input_sha256 = exemptions.input_sha256
      and original.input_sha256 = authorization_actions.input_sha256
    where exemptions.event_id = '63000000-0000-0000-0000-000000000010'
      and exemptions.id = '63500000-0000-0000-0000-000000000001'
      and authorization_actions.id = '63300000-0000-0000-0000-000000000001'
  $$,
  $$ values (1::bigint) $$,
  'stale immutable exemption and authorization evidence remain unchanged'
);

select results_eq(
  $$
    select
      publicly_authorized_revision is null,
      publicly_authorized_action_id is null,
      moderation_status,
      public_history_status
    from public.events
    where id = '63000000-0000-0000-0000-000000000010'
  $$,
  $$ values (true, true, 'under_review'::text, 'previously_public'::text) $$,
  'stale immutable evidence is retained but live authorization fails closed'
);

select results_eq(
  $$
    select count(*)
    from stale_reconciliation_actual as actual
    join public.events as events on events.id = actual.event_id
    join private.event_moderation_evaluations as evaluations
      on evaluations.event_id = events.id
      and evaluations.input_sha256 = actual.current_input_sha256
      and evaluations.queued_moderation_version = events.moderation_version
      and evaluations.status = 'queued'
    join private.event_moderation_actions as hold_actions
      on hold_actions.id = actual.reconciliation_action_id
      and hold_actions.evaluation_id = evaluations.id
      and hold_actions.action = 'hold'
      and hold_actions.internal_note =
        'source_normalization_action_id=63100000-0000-0000-0000-000000000001;reconciliation=stale_evidence_unauthorized'
  $$,
  $$ values (1::bigint) $$,
  'stale authorization removal records the current digest, evaluation, and bounded hold'
);

select results_eq(
  $$ select count(*) from public.events where public_history_status is null $$,
  $$ values (0::bigint) $$,
  'every event has an explicit public-history classification'
);

select results_eq(
  $$ select count(*) from public.events where moderation_status = 'flagged' $$,
  $$ values (0::bigint) $$,
  'no legacy flagged event row remains'
);

select results_eq(
  $$
    select count(*)
    from public.events
    where moderation_status not in (
      'not_evaluated',
      'clear',
      'under_review',
      'blocked',
      'removed'
    )
  $$,
  $$ values (0::bigint) $$,
  'all event rows use the final moderation vocabulary'
);

select results_eq(
  $$
    select count(*)
    from public.events as events
    left join private.event_public_eligibility_intervals as intervals
      on intervals.event_id = events.id
      and intervals.public_eligibility_version = 0
    group by events.id
    having count(intervals.event_id) <> 1
  $$,
  $$ select 0::bigint where false $$,
  'every event has exactly one version-zero interval'
);

select results_eq(
  $$
    select count(*)
    from public.events as events
    left join private.event_public_eligibility_intervals as intervals
      on intervals.event_id = events.id
      and intervals.ended_at is null
    group by events.id
    having count(intervals.event_id) <> 1
  $$,
  $$ select 0::bigint where false $$,
  'every event has exactly one open eligibility interval'
);

select results_eq(
  $$
    select count(*)
    from private.event_public_eligibility_intervals
    where ended_at is null
      and (
        public_eligibility_version <> 0
        or eligibility_state <> 'ineligible'
        or started_action_id is not null
        or ended_action_id is not null
      )
  $$,
  $$ values (0::bigint) $$,
  'every open interval remains the version-zero ineligible initialization epoch'
);

select results_eq(
  $$
    select count(*)
    from private.event_public_eligibility_intervals
    where eligibility_state = 'eligible'
  $$,
  $$ values (0::bigint) $$,
  'legacy migration never opens an eligible interval'
);

select results_eq(
  $$
    select count(*)
    from private.event_moderation_actions
    where source = 'migration'
      and action = 'hold'
      and internal_note like 'legacy_lifecycle_status=%'
      and (
        previous_status <> new_status
        or new_status <> 'under_review'
        or previous_status = 'flagged'
        or new_status = 'flagged'
        or internal_note is null
        or char_length(internal_note) > 1000
        or internal_note !~ '^legacy_lifecycle_status=(draft|published|cancelled);legacy_moderation_status=(clear|flagged|blocked|removed);evidence_code=(old_public_rls_observation|no_positive_evidence|contradictory_evidence);classification_reason='
      )
  $$,
  $$ values (0::bigint) $$,
  'normalization actions preserve bounded legacy evidence without flagged audit states'
);

select results_eq(
  $$
    select count(*)
    from private.event_moderation_actions as actions
    join public.events as events on events.id = actions.event_id
    where actions.source = 'migration'
      and actions.action = 'hold'
      and actions.internal_note ~ '^legacy_lifecycle_status=published;legacy_moderation_status=(clear|flagged);'
      and (
        events.public_history_status <> 'previously_public'
        or events.first_publicly_eligible_at is distinct from actions.created_at
        or events.moderation_status <> 'under_review'
      )
  $$,
  $$ values (0::bigint) $$,
  'old publicly readable clear and flagged rows retain observed prior-public history but are held'
);

select results_eq(
  $$
    select count(*)
    from private.event_moderation_actions as actions
    join public.events as events on events.id = actions.event_id
    where actions.source = 'migration'
      and actions.action = 'hold'
      and actions.internal_note ~ 'legacy_moderation_status=(blocked|removed)'
      and actions.internal_note ~ 'evidence_code=no_positive_evidence'
      and (
        events.public_history_status <> 'unknown'
        or events.first_publicly_eligible_at is not null
        or events.moderation_status <> 'under_review'
      )
  $$,
  $$ values (0::bigint) $$,
  'published_at alone never promotes blocked or removed history beyond unknown quarantine'
);

select results_eq(
  $$
    select count(*)
    from private.event_moderation_actions as actions
    join public.events as events on events.id = actions.event_id
    where actions.source = 'migration'
      and actions.action = 'hold'
      and actions.internal_note ~ '^legacy_lifecycle_status=(draft|cancelled);'
      and actions.internal_note ~ 'evidence_code=no_positive_evidence'
      and (
        events.public_history_status <> 'unknown'
        or events.moderation_status <> 'under_review'
      )
  $$,
  $$ values (0::bigint) $$,
  'ambiguous draft and cancelled history remains unknown and quarantined'
);

select results_eq(
  $$
    select count(*)
    from private.event_policy_legacy_exemptions as exemptions
    join private.event_moderation_actions as normalization
      on normalization.event_id = exemptions.event_id
      and normalization.source = 'migration'
      and normalization.action = 'hold'
      and normalization.internal_note like 'legacy_lifecycle_status=%'
    where normalization.internal_note !~ '^legacy_lifecycle_status=published;legacy_moderation_status=(clear|flagged);'
  $$,
  $$ values (0::bigint) $$,
  'only rows observed through the old public RLS predicate receive an exemption'
);

select results_eq(
  $$
    select count(*)
    from private.event_policy_legacy_exemptions as exemptions
    join public.events as events on events.id = exemptions.event_id
    where exemptions.reason <> 'pre_build_2_5_publication'
      or exemptions.migration_identifier not in (
        '20260826010100_migrate_legacy_moderation',
        '20260826010150_harden_legacy_moderation_migration'
      )
      or exemptions.grandfathered_content_revision <> events.content_revision
      or exemptions.input_sha256 !~ '^[a-f0-9]{64}$'
  $$,
  $$ values (0::bigint) $$,
  'legacy exemptions are exact-revision migration evidence with the fixed reason'
);

select results_eq(
  $$
    select count(*)
    from public.events as events
    join private.event_moderation_actions as authorization_actions
      on authorization_actions.id = events.publicly_authorized_action_id
    join private.event_policy_legacy_exemptions as exemptions
      on exemptions.id = authorization_actions.policy_legacy_exemption_id
    where events.publicly_authorized_revision <> events.content_revision
      or authorization_actions.event_id <> events.id
      or authorization_actions.content_revision <> events.content_revision
      or authorization_actions.input_sha256 <> exemptions.input_sha256
  $$,
  $$ values (0::bigint) $$,
  'exemption, authorization action, and event pointers form one exact atomic chain'
);

select results_eq(
  $$
    select count(*)
    from private.event_moderation_actions
    where policy_legacy_exemption_id is not null
      and (
        source <> 'migration'
        or action <> 'authorize_publication'
        or actor_type <> 'system'
        or actor_user_id is not null
        or policy_acceptance_id is not null
        or previous_status = 'flagged'
        or new_status = 'flagged'
      )
  $$,
  $$ values (0::bigint) $$,
  'migration authorization fabricates neither organizer acceptance nor an accepting actor'
);

select results_eq(
  $$
    select count(*)
    from private.event_moderation_actions as normalization
    join public.events as events on events.id = normalization.event_id
    where normalization.source = 'migration'
      and normalization.action = 'hold'
      and normalization.internal_note ~ '^legacy_lifecycle_status=published;legacy_moderation_status=(clear|flagged);'
      and normalization.event_id in (
        select fixtures.event_id from legacy_matrix_fixture as fixtures
        union all
        select '63000000-0000-0000-0000-000000000010'::uuid
      )
      and not exists (
        select 1
        from private.event_moderation_evaluations as evaluations
        where evaluations.event_id = events.id
          and evaluations.content_revision = events.content_revision
          and evaluations.queued_moderation_version = events.moderation_version
          and evaluations.source = 'contextual'
          and evaluations.status = 'queued'
      )
  $$,
  $$ values (0::bigint) $$,
  'every legacy public row has an exact current bootstrap evaluation queued before clearance'
);

select results_eq(
  $$
    select count(*)
    from private.event_moderation_actions as normalization
    where normalization.source = 'migration'
      and normalization.action = 'hold'
      and normalization.internal_note ~ '^legacy_lifecycle_status=published;legacy_moderation_status=(clear|flagged);'
      and not exists (
        select 1
        from private.event_moderation_actions as reconciliation
        where reconciliation.event_id = normalization.event_id
          and reconciliation.source = 'migration'
          and reconciliation.evaluation_id is not null
      )
  $$,
  $$ values (0::bigint) $$,
  'the legacy-public hold action references its exact bootstrap evaluation'
);

select results_eq(
  $$
    select count(*)
    from private.event_policy_legacy_exemptions as exemptions
    join private.event_public_eligibility_intervals as intervals
      on intervals.event_id = exemptions.event_id
    where intervals.public_eligibility_version <> 0
      or intervals.eligibility_state <> 'ineligible'
      or intervals.ended_at is not null
  $$,
  $$ values (0::bigint) $$,
  'legacy authorization evidence never implies current eligibility or policy acceptance'
);

select results_eq(
  $$
    with canonical_inputs as (
      select
        events.id,
        encode(
          extensions.digest(
            jsonb_build_object(
              'event', jsonb_build_object(
                'title', events.title,
                'description', events.description,
                'category', events.category,
                'venue_name', events.venue_name,
                'starts_at', events.starts_at,
                'ends_at', events.ends_at,
                'timezone', events.timezone,
                'address_line1', events.address_line1,
                'address_line2', events.address_line2,
                'city', events.city,
                'region', events.region,
                'postal_code', events.postal_code,
                'country_code', events.country_code,
                'mapbox_feature_id', events.mapbox_feature_id,
                'latitude', events.latitude,
                'longitude', events.longitude,
                'admission_type', events.admission_type
              ),
              'disclosures', jsonb_build_object(
                'minimum_age', disclosures.minimum_age,
                'alcohol_present', disclosures.alcohol_present,
                'cannabis_present', disclosures.cannabis_present,
                'explicit_adult_content', disclosures.explicit_adult_content,
                'gambling_present', disclosures.gambling_present,
                'weapons_present', disclosures.weapons_present,
                'high_risk_activity', disclosures.high_risk_activity
              ),
              'artwork', jsonb_build_object(
                'path', events.artwork_path,
                'verification_state', case
                  when events.artwork_path is null then 'not_present'
                  else 'unverified'
                end
              ),
              'ticket_tiers', coalesce(tiers.public_tiers, '[]'::jsonb),
              'organizer_display_name', organizers.display_name
            )::text,
            'sha256'
          ),
          'hex'
        ) as input_sha256
      from public.events as events
      join public.organizers as organizers on organizers.id = events.organizer_id
      left join private.event_risk_disclosures as disclosures
        on disclosures.event_id = events.id
      left join lateral (
        select jsonb_agg(
          jsonb_build_object(
            'name', ticket_tiers.name,
            'description', ticket_tiers.description
          )
          order by ticket_tiers.id
        ) as public_tiers
        from public.ticket_tiers
        where ticket_tiers.event_id = events.id
      ) as tiers on true
    )
    select count(*)
    from public.events as events
    join canonical_inputs on canonical_inputs.id = events.id
    join private.event_moderation_actions as authorization_actions
      on authorization_actions.id = events.publicly_authorized_action_id
    join private.event_policy_legacy_exemptions as exemptions
      on exemptions.id = authorization_actions.policy_legacy_exemption_id
    where exemptions.input_sha256 <> canonical_inputs.input_sha256
      or authorization_actions.input_sha256 <> canonical_inputs.input_sha256
  $$,
  $$ values (0::bigint) $$,
  'stored legacy exemption and authorization digests equal the canonical current-input digest'
);

select results_eq(
  $$
    with canonical_input as (
      select jsonb_build_object(
        'event', jsonb_build_object(
          'title', events.title,
          'description', events.description,
          'category', events.category,
          'venue_name', events.venue_name,
          'starts_at', events.starts_at,
          'ends_at', events.ends_at,
          'timezone', events.timezone,
          'address_line1', events.address_line1,
          'address_line2', events.address_line2,
          'city', events.city,
          'region', events.region,
          'postal_code', events.postal_code,
          'country_code', events.country_code,
          'mapbox_feature_id', events.mapbox_feature_id,
          'latitude', events.latitude,
          'longitude', events.longitude,
          'admission_type', events.admission_type
        ),
        'disclosures', jsonb_build_object(
          'minimum_age', disclosures.minimum_age,
          'alcohol_present', disclosures.alcohol_present,
          'cannabis_present', disclosures.cannabis_present,
          'explicit_adult_content', disclosures.explicit_adult_content,
          'gambling_present', disclosures.gambling_present,
          'weapons_present', disclosures.weapons_present,
          'high_risk_activity', disclosures.high_risk_activity
        ),
        'artwork', jsonb_build_object(
          'path', events.artwork_path,
          'verification_state', case
            when events.artwork_path is null then 'not_present'
            else 'unverified'
          end
        ),
        'ticket_tiers', coalesce(tiers.public_tiers, '[]'::jsonb),
        'organizer_display_name', organizers.display_name
      ) as value
      from public.events as events
      join public.organizers as organizers on organizers.id = events.organizer_id
      left join private.event_risk_disclosures as disclosures
        on disclosures.event_id = events.id
      left join lateral (
        select jsonb_agg(
          jsonb_build_object(
            'name', ticket_tiers.name,
            'description', ticket_tiers.description
          )
          order by ticket_tiers.id
        ) as public_tiers
        from public.ticket_tiers
        where ticket_tiers.event_id = events.id
      ) as tiers on true
      where events.id = '61000000-0000-0000-0000-000000000010'
    )
    select encode(extensions.digest(value::text, 'sha256'), 'hex')
    from canonical_input
  $$,
  $$ values ('dcd1feed409e75c69e4664f1b70cb10f0c8da9e6533caf498904cc3b0d6955a9'::text) $$,
  'canonical JSONB and explicitly ordered tier content produce a byte-stable digest'
);

select results_eq(
  $$
    select count(*)
    from private.event_moderation_actions
    where source = 'migration'
      and (previous_status = 'flagged' or new_status = 'flagged')
  $$,
  $$ values (0::bigint) $$,
  'migration actions never reintroduce flagged into the final audit vocabulary'
);

select results_eq(
  $$
    select count(*)
    from public.events as events
    join private.event_public_eligibility_intervals as intervals
      on intervals.event_id = events.id
    where events.public_eligibility_version <> 0
      or intervals.public_eligibility_version <> 0
  $$,
  $$ values (0::bigint) $$,
  'Task 2 initializes version zero without inventing an eligibility transition'
);

select * from finish();
rollback;
