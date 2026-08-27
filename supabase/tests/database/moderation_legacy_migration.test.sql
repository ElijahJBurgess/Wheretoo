begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(37);

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
        'initialize_event_public_eligibility_interval'
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

create temporary table legacy_matrix_fixture (
  fixture_key text primary key,
  lifecycle_status text not null,
  legacy_moderation_status text not null,
  evidence_code text not null,
  prior_public_observed_at timestamptz,
  expected_moderation_status text not null,
  expected_public_history_status text not null,
  expected_first_publicly_eligible_at timestamptz,
  expected_legacy_exemption boolean not null,
  expected_classification_reason text not null
) on commit drop;

insert into legacy_matrix_fixture values
  ('01_published_clear_observed', 'published', 'clear', 'old_public_rls_observation', '2026-08-26 01:01:00+00', 'under_review', 'previously_public', '2026-08-26 01:01:00+00', true, 'observed_old_public_rls'),
  ('02_published_flagged_observed', 'published', 'flagged', 'old_public_rls_observation', '2026-08-26 01:01:00+00', 'under_review', 'previously_public', '2026-08-26 01:01:00+00', true, 'observed_old_public_rls'),
  ('03_published_blocked_ambiguous', 'published', 'blocked', 'no_positive_evidence', null, 'under_review', 'unknown', null, false, 'quarantined_without_positive_history_evidence'),
  ('04_published_removed_ambiguous', 'published', 'removed', 'no_positive_evidence', null, 'under_review', 'unknown', null, false, 'quarantined_without_positive_history_evidence'),
  ('05_draft_blocked_ambiguous', 'draft', 'blocked', 'no_positive_evidence', null, 'under_review', 'unknown', null, false, 'quarantined_without_positive_history_evidence'),
  ('06_draft_removed_ambiguous', 'draft', 'removed', 'no_positive_evidence', null, 'under_review', 'unknown', null, false, 'quarantined_without_positive_history_evidence'),
  ('07_cancelled_blocked_ambiguous', 'cancelled', 'blocked', 'no_positive_evidence', null, 'under_review', 'unknown', null, false, 'quarantined_without_positive_history_evidence'),
  ('08_cancelled_removed_ambiguous', 'cancelled', 'removed', 'no_positive_evidence', null, 'under_review', 'unknown', null, false, 'quarantined_without_positive_history_evidence'),
  ('09_draft_clear_ambiguous', 'draft', 'clear', 'no_positive_evidence', null, 'under_review', 'unknown', null, false, 'quarantined_without_positive_history_evidence'),
  ('10_cancelled_flagged_ambiguous', 'cancelled', 'flagged', 'no_positive_evidence', null, 'under_review', 'unknown', null, false, 'quarantined_without_positive_history_evidence'),
  ('11_published_blocked_prior_public', 'published', 'blocked', 'server_prior_public', '2026-08-25 09:00:00+00', 'removed', 'previously_public', '2026-08-25 09:00:00+00', false, 'normalized_with_prior_public_evidence'),
  ('12_draft_removed_prior_public', 'draft', 'removed', 'server_prior_public', '2026-08-25 10:00:00+00', 'removed', 'previously_public', '2026-08-25 10:00:00+00', false, 'normalized_with_prior_public_evidence'),
  ('13_cancelled_blocked_never_public', 'cancelled', 'blocked', 'verified_never_public', null, 'blocked', 'never_public', null, false, 'normalized_with_never_public_evidence'),
  ('14_published_removed_never_public', 'published', 'removed', 'verified_never_public', null, 'blocked', 'never_public', null, false, 'normalized_with_never_public_evidence'),
  ('15_contradictory_history', 'published', 'blocked', 'contradictory_evidence', '2026-08-25 11:00:00+00', 'under_review', 'unknown', null, false, 'quarantined_invalid_or_contradictory_evidence'),
  ('16_missing_prior_public_timestamp', 'published', 'removed', 'server_prior_public', null, 'under_review', 'unknown', null, false, 'quarantined_invalid_or_contradictory_evidence'),
  ('17_never_public_with_timestamp', 'draft', 'blocked', 'verified_never_public', '2026-08-25 12:00:00+00', 'under_review', 'unknown', null, false, 'quarantined_invalid_or_contradictory_evidence'),
  ('18_invalid_lifecycle', 'ended', 'clear', 'no_positive_evidence', null, 'under_review', 'unknown', null, false, 'quarantined_invalid_or_contradictory_evidence');

create temporary table legacy_matrix_actual (
  fixture_key text primary key,
  moderation_status text,
  public_history_status text,
  first_publicly_eligible_at timestamptz,
  qualifies_for_legacy_exemption boolean,
  classification_reason text
) on commit drop;

do $capture_legacy_matrix$
begin
  if pg_catalog.to_regprocedure(
    'private.classify_legacy_event_moderation(text,text,text,timestamptz)'
  ) is null then
    insert into legacy_matrix_actual (
      fixture_key,
      moderation_status,
      public_history_status,
      first_publicly_eligible_at,
      qualifies_for_legacy_exemption,
      classification_reason
    )
    select
      fixture_key,
      '__classifier_missing__',
      '__classifier_missing__',
      null,
      false,
      '__classifier_missing__'
    from legacy_matrix_fixture;
  else
    execute $capture$
      insert into legacy_matrix_actual (
        fixture_key,
        moderation_status,
        public_history_status,
        first_publicly_eligible_at,
        qualifies_for_legacy_exemption,
        classification_reason
      )
      select
        fixtures.fixture_key,
        classified.moderation_status,
        classified.public_history_status,
        classified.first_publicly_eligible_at,
        classified.qualifies_for_legacy_exemption,
        classified.classification_reason
      from legacy_matrix_fixture as fixtures
      cross join lateral private.classify_legacy_event_moderation(
        fixtures.lifecycle_status,
        fixtures.legacy_moderation_status,
        fixtures.evidence_code,
        fixtures.prior_public_observed_at
      ) as classified
    $capture$;
  end if;
end;
$capture_legacy_matrix$;

select results_eq(
  $$
    select fixture_key, moderation_status, public_history_status
    from legacy_matrix_actual
    order by fixture_key
  $$,
  $$
    select fixture_key, expected_moderation_status, expected_public_history_status
    from legacy_matrix_fixture
    order by fixture_key
  $$,
  'the production classifier maps the complete legacy lifecycle and moderation matrix'
);

select results_eq(
  $$
    select fixture_key, qualifies_for_legacy_exemption, classification_reason
    from legacy_matrix_actual
    order by fixture_key
  $$,
  $$
    select fixture_key, expected_legacy_exemption, expected_classification_reason
    from legacy_matrix_fixture
    order by fixture_key
  $$,
  'the production classifier grants exemptions only from exact old-public observation evidence'
);

select results_eq(
  $$
    select fixture_key, first_publicly_eligible_at
    from legacy_matrix_actual
    order by fixture_key
  $$,
  $$
    select fixture_key, expected_first_publicly_eligible_at
    from legacy_matrix_fixture
    order by fixture_key
  $$,
  'the production classifier retains only defensible prior-public observation times'
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
      and (
        previous_status <> new_status
        or new_status <> 'under_review'
        or previous_status = 'flagged'
        or new_status = 'flagged'
        or internal_note is null
        or char_length(internal_note) > 1000
        or internal_note !~ '^legacy_lifecycle_status=(draft|published|cancelled);legacy_moderation_status=(clear|flagged|blocked|removed);evidence_code=(old_public_rls_observation|no_positive_evidence);classification_reason='
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
      and actions.internal_note ~ 'legacy_moderation_status=(clear|flagged)'
      and (
        actions.new_public_history_status <> 'previously_public'
        or events.public_history_status <> 'previously_public'
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
    where normalization.internal_note !~ '^legacy_lifecycle_status=published;legacy_moderation_status=(clear|flagged);evidence_code=old_public_rls_observation;'
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
      or exemptions.migration_identifier <> '20260826010100_migrate_legacy_moderation'
      or exemptions.grandfathered_content_revision <> events.content_revision
      or exemptions.input_sha256 !~ '^[a-f0-9]{64}$'
  $$,
  $$ values (0::bigint) $$,
  'legacy exemptions are exact-revision migration evidence with the fixed reason'
);

select results_eq(
  $$
    select count(*)
    from private.event_policy_legacy_exemptions as exemptions
    join public.events as events on events.id = exemptions.event_id
    left join private.event_moderation_actions as authorization_actions
      on authorization_actions.id = events.publicly_authorized_action_id
      and authorization_actions.policy_legacy_exemption_id = exemptions.id
      and authorization_actions.event_id = events.id
      and authorization_actions.content_revision = events.content_revision
      and authorization_actions.input_sha256 = exemptions.input_sha256
    where events.publicly_authorized_revision <> events.content_revision
      or authorization_actions.id is null
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
    from private.event_policy_legacy_exemptions as exemptions
    join public.events as events on events.id = exemptions.event_id
    left join private.event_moderation_evaluations as evaluations
      on evaluations.event_id = events.id
      and evaluations.content_revision = events.content_revision
      and evaluations.input_sha256 = exemptions.input_sha256
      and evaluations.queued_moderation_version = events.moderation_version
      and evaluations.source = 'contextual'
      and evaluations.status = 'queued'
    where evaluations.id is null
  $$,
  $$ values (0::bigint) $$,
  'every legacy public row has an exact current bootstrap evaluation queued before clearance'
);

select results_eq(
  $$
    select count(*)
    from private.event_policy_legacy_exemptions as exemptions
    join private.event_moderation_actions as normalization
      on normalization.event_id = exemptions.event_id
      and normalization.source = 'migration'
      and normalization.action = 'hold'
    where normalization.evaluation_id is null
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
    from private.event_policy_legacy_exemptions as exemptions
    join canonical_inputs on canonical_inputs.id = exemptions.event_id
    join private.event_moderation_actions as authorization_actions
      on authorization_actions.policy_legacy_exemption_id = exemptions.id
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
