begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, private, extensions;

select plan(63);

select has_table('private', 'event_risk_disclosures', 'risk disclosures are private');
select has_table('private', 'event_moderation_evaluations', 'moderation evaluations are private');
select has_table('private', 'event_moderation_actions', 'moderation actions are private');
select has_table('private', 'event_reports', 'event reports are private');
select has_table('private', 'event_report_rate_buckets', 'event report rate buckets are private');
select has_table('private', 'moderation_review_requests', 'moderation review requests are private');
select has_table('private', 'staff_roles', 'staff roles are private');
select has_table('private', 'event_public_eligibility_intervals', 'public eligibility intervals are private');
select has_table('private', 'organizer_policy_versions', 'organizer policy versions are private');
select has_table('private', 'organizer_policy_requirements', 'organizer policy requirements are private');
select has_table('private', 'event_policy_acceptances', 'event policy acceptances are private');
select has_table('private', 'event_policy_legacy_exemptions', 'legacy policy exemptions are private');

select results_eq(
  $$
    select (array_agg(
      column_name || ':' || data_type || ':' || is_nullable
      order by ordinal_position
    )) collate "C"
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'events'
      and column_name in (
        'content_revision',
        'moderated_revision',
        'moderation_version',
        'moderation_updated_at',
        'public_history_status',
        'first_publicly_eligible_at',
        'public_eligibility_version',
        'publicly_authorized_revision',
        'publicly_authorized_action_id'
      )
  $$,
  $$
    values ((array[
      'content_revision:bigint:NO',
      'moderated_revision:bigint:YES',
      'moderation_version:bigint:NO',
      'moderation_updated_at:timestamp with time zone:YES',
      'public_history_status:text:YES',
      'first_publicly_eligible_at:timestamp with time zone:YES',
      'public_eligibility_version:bigint:NO',
      'publicly_authorized_revision:bigint:YES',
      'publicly_authorized_action_id:uuid:YES'
    ]::text[]) collate "C")
  $$,
  'event moderation foundation columns have exact types and nullability'
);

select col_default_is('public', 'events', 'content_revision', '1', 'content revision defaults to one');
select col_default_is('public', 'events', 'moderation_version', '0', 'moderation version defaults to zero');
select col_default_is(
  'public',
  'events',
  'public_eligibility_version',
  '0',
  'public eligibility version defaults to zero'
);

select results_eq(
  $$
    select (array_agg(conname::text order by conname)) collate "C"
    from pg_catalog.pg_constraint
    where conrelid = 'public.events'::regclass
      and conname in (
        'events_content_revision_check',
        'events_moderated_revision_check',
        'events_moderation_status_check',
        'events_moderation_version_check',
        'events_public_history_status_check',
        'events_public_history_time_check',
        'events_public_eligibility_version_check',
        'events_public_authorization_check',
        'events_publicly_authorized_revision_check'
      )
  $$,
  $$
    values ((array[
      'events_content_revision_check',
      'events_moderated_revision_check',
      'events_moderation_status_check',
      'events_moderation_version_check',
      'events_public_authorization_check',
      'events_public_eligibility_version_check',
      'events_public_history_status_check',
      'events_public_history_time_check',
      'events_publicly_authorized_revision_check'
    ]::text[]) collate "C")
  $$,
  'event moderation checks are named and complete'
);

select is_empty(
  $$
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'events'
      and column_name = 'map_eligible'
  $$,
  'events do not expose an organizer-editable map_eligible column'
);

select is_empty(
  $$
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'events'
      and data_type = 'boolean'
      and column_name ~ '(public.*eligible|eligible.*public|public_eligibility)'
  $$,
  'events do not store public eligibility as a boolean'
);

select columns_are(
  'private',
  'event_risk_disclosures',
  array[
    'event_id', 'minimum_age', 'alcohol_present', 'cannabis_present',
    'explicit_adult_content', 'gambling_present', 'weapons_present',
    'high_risk_activity', 'created_at', 'updated_at'
  ],
  'risk disclosure columns are exact'
);

select columns_are(
  'private',
  'event_moderation_evaluations',
  array[
    'id', 'event_id', 'content_revision', 'input_sha256',
    'queued_moderation_version', 'status', 'source', 'outcome', 'risk_level',
    'reason_codes', 'provider_reference', 'model_version', 'attempt_count',
    'failure_code', 'created_at', 'started_at', 'finished_at'
  ],
  'moderation evaluation columns are exact'
);

select columns_are(
  'private',
  'event_moderation_actions',
  array[
    'id', 'event_id', 'previous_content_revision', 'content_revision',
    'input_sha256', 'actor_type', 'actor_user_id', 'source', 'action',
    'previous_status', 'new_status', 'previous_public_history_status',
    'new_public_history_status', 'reason_code', 'internal_note', 'evaluation_id',
    'review_request_id', 'policy_acceptance_id', 'policy_legacy_exemption_id',
    'moderation_version', 'created_at'
  ],
  'moderation action columns are exact'
);

select columns_are(
  'private',
  'event_reports',
  array[
    'id', 'event_id', 'content_revision', 'input_sha256', 'reporter_fingerprint',
    'reason', 'status', 'created_at', 'resolved_at'
  ],
  'event report columns are exact'
);

select columns_are(
  'private',
  'event_report_rate_buckets',
  array[
    'bucket_type', 'bucket_digest', 'window_started_at', 'request_count', 'expires_at'
  ],
  'event report rate bucket columns are exact'
);

select columns_are(
  'private',
  'moderation_review_requests',
  array[
    'id', 'event_id', 'organizer_id', 'content_revision', 'input_sha256',
    'requested_action_id', 'status', 'organizer_note', 'created_at',
    'resolved_at', 'resolved_action_id'
  ],
  'review request columns are exact'
);

select columns_are(
  'private',
  'staff_roles',
  array['user_id', 'role', 'active', 'granted_by', 'created_at', 'updated_at'],
  'staff role columns are exact'
);

select columns_are(
  'private',
  'event_public_eligibility_intervals',
  array[
    'event_id', 'public_eligibility_version', 'eligibility_state', 'started_at',
    'ended_at', 'started_action_id', 'ended_action_id', 'transition_reason'
  ],
  'eligibility interval columns are exact'
);

select results_eq(
  $$
    select (array_agg(
      column_name || ':' || data_type || ':' || is_nullable
      order by ordinal_position
    )) collate "C"
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'organizer_policy_versions'
      and column_name in (
        'id', 'policy_kind', 'public_url', 'content_sha256', 'effective_at', 'created_at'
      )
  $$,
  $$
    values ((array[
      'id:text:NO',
      'policy_kind:text:NO',
      'public_url:text:NO',
      'content_sha256:text:NO',
      'effective_at:timestamp with time zone:NO',
      'created_at:timestamp with time zone:NO'
    ]::text[]) collate "C")
  $$,
  'policy version structural fields are exact while allowing Task 3 stage metadata'
);

select columns_are(
  'private',
  'organizer_policy_requirements',
  array['policy_kind', 'policy_version_id', 'updated_at'],
  'policy requirement columns are structural only'
);

select columns_are(
  'private',
  'event_policy_acceptances',
  array[
    'id', 'event_id', 'organizer_id', 'accepted_by_user_id', 'content_revision',
    'input_sha256', 'organizer_terms_version_id', 'event_policy_version_id',
    'accepted_at'
  ],
  'policy acceptance columns are exact'
);

select columns_are(
  'private',
  'event_policy_legacy_exemptions',
  array[
    'id', 'event_id', 'grandfathered_content_revision', 'input_sha256',
    'reason', 'migration_identifier', 'created_at'
  ],
  'legacy policy exemption columns are exact'
);

select results_eq(
  $$
    select (array_agg(
      table_name || '.' || constraint_name order by table_name, constraint_name
    )) collate "C"
    from information_schema.table_constraints
    where constraint_schema = 'private'
      and constraint_type = 'PRIMARY KEY'
      and table_name in (
        'event_risk_disclosures',
        'event_moderation_evaluations',
        'event_moderation_actions',
        'event_reports',
        'event_report_rate_buckets',
        'moderation_review_requests',
        'staff_roles',
        'event_public_eligibility_intervals',
        'organizer_policy_versions',
        'organizer_policy_requirements',
        'event_policy_acceptances',
        'event_policy_legacy_exemptions'
      )
  $$,
  $$
    values ((array[
      'event_moderation_actions.event_moderation_actions_pkey',
      'event_moderation_evaluations.event_moderation_evaluations_pkey',
      'event_policy_acceptances.event_policy_acceptances_pkey',
      'event_policy_legacy_exemptions.event_policy_legacy_exemptions_pkey',
      'event_public_eligibility_intervals.event_public_eligibility_intervals_pkey',
      'event_report_rate_buckets.event_report_rate_buckets_pkey',
      'event_reports.event_reports_pkey',
      'event_risk_disclosures.event_risk_disclosures_pkey',
      'moderation_review_requests.moderation_review_requests_pkey',
      'organizer_policy_requirements.organizer_policy_requirements_pkey',
      'organizer_policy_versions.organizer_policy_versions_pkey',
      'staff_roles.staff_roles_pkey'
    ]::text[]) collate "C")
  $$,
  'private moderation tables have exact primary keys'
);

select results_eq(
  $$
    select (array_agg(
      tables.table_schema || '.' || tables.table_name || '.' ||
      constraints.constraint_name || ':' || constraints.delete_rule
      order by tables.table_schema, tables.table_name, constraints.constraint_name
    )) collate "C"
    from information_schema.referential_constraints as constraints
    join information_schema.table_constraints as tables
      on tables.constraint_catalog = constraints.constraint_catalog
     and tables.constraint_schema = constraints.constraint_schema
     and tables.constraint_name = constraints.constraint_name
    where (
      tables.constraint_schema = 'private'
      and tables.table_name in (
        'event_risk_disclosures',
        'event_moderation_evaluations',
        'event_moderation_actions',
        'event_reports',
        'event_report_rate_buckets',
        'moderation_review_requests',
        'staff_roles',
        'event_public_eligibility_intervals',
        'organizer_policy_requirements',
        'event_policy_acceptances',
        'event_policy_legacy_exemptions'
      )
    )
       or constraints.constraint_name = 'events_publicly_authorized_action_id_fkey'
  $$,
  $$
    values ((array[
      'private.event_moderation_actions.event_moderation_actions_actor_user_id_fkey:RESTRICT',
      'private.event_moderation_actions.event_moderation_actions_evaluation_id_fkey:RESTRICT',
      'private.event_moderation_actions.event_moderation_actions_event_id_fkey:RESTRICT',
      'private.event_moderation_actions.event_moderation_actions_policy_acceptance_id_fkey:RESTRICT',
      'private.event_moderation_actions.event_moderation_actions_policy_legacy_exemption_id_fkey:RESTRICT',
      'private.event_moderation_actions.event_moderation_actions_review_request_id_fkey:RESTRICT',
      'private.event_moderation_evaluations.event_moderation_evaluations_event_id_fkey:RESTRICT',
      'private.event_policy_acceptances.event_policy_acceptances_accepted_by_user_id_fkey:RESTRICT',
      'private.event_policy_acceptances.event_policy_acceptances_event_id_fkey:RESTRICT',
      'private.event_policy_acceptances.event_policy_acceptances_event_policy_version_id_fkey:RESTRICT',
      'private.event_policy_acceptances.event_policy_acceptances_organizer_id_fkey:RESTRICT',
      'private.event_policy_acceptances.event_policy_acceptances_organizer_terms_version_id_fkey:RESTRICT',
      'private.event_policy_legacy_exemptions.event_policy_legacy_exemptions_event_id_fkey:RESTRICT',
      'private.event_public_eligibility_intervals.event_public_eligibility_intervals_ended_action_id_fkey:RESTRICT',
      'private.event_public_eligibility_intervals.event_public_eligibility_intervals_event_id_fkey:RESTRICT',
      'private.event_public_eligibility_intervals.event_public_eligibility_intervals_started_action_id_fkey:RESTRICT',
      'private.event_reports.event_reports_event_id_fkey:RESTRICT',
      'private.event_risk_disclosures.event_risk_disclosures_event_id_fkey:RESTRICT',
      'private.moderation_review_requests.moderation_review_requests_event_id_fkey:RESTRICT',
      'private.moderation_review_requests.moderation_review_requests_organizer_id_fkey:RESTRICT',
      'private.moderation_review_requests.moderation_review_requests_requested_action_id_fkey:RESTRICT',
      'private.moderation_review_requests.moderation_review_requests_resolved_action_id_fkey:RESTRICT',
      'private.organizer_policy_requirements.organizer_policy_requirements_policy_version_fkey:RESTRICT',
      'private.staff_roles.staff_roles_granted_by_fkey:RESTRICT',
      'private.staff_roles.staff_roles_user_id_fkey:RESTRICT',
      'public.events.events_publicly_authorized_action_id_fkey:RESTRICT'
    ]::text[]) collate "C")
  $$,
  'moderation foreign keys and deletion behavior are exact'
);

select results_eq(
  $$
    select (array_agg(
      schemaname || '.' || tablename || '.' || indexname order by indexname
    )) collate "C"
    from pg_catalog.pg_indexes
    where schemaname = 'private'
      and indexname in (
        'event_moderation_evaluations_input_key',
        'event_moderation_evaluations_queue_idx',
        'event_moderation_actions_event_created_idx',
        'event_reports_one_open_per_actor_idx',
        'event_reports_open_event_idx',
        'event_report_rate_buckets_expires_idx',
        'moderation_review_requests_one_open_idx',
        'event_public_eligibility_intervals_one_open_idx',
        'event_policy_acceptances_exact_key',
        'event_policy_legacy_exemptions_event_key'
      )
  $$,
  $$
    values ((array[
      'private.event_moderation_actions.event_moderation_actions_event_created_idx',
      'private.event_moderation_evaluations.event_moderation_evaluations_input_key',
      'private.event_moderation_evaluations.event_moderation_evaluations_queue_idx',
      'private.event_policy_acceptances.event_policy_acceptances_exact_key',
      'private.event_policy_legacy_exemptions.event_policy_legacy_exemptions_event_key',
      'private.event_public_eligibility_intervals.event_public_eligibility_intervals_one_open_idx',
      'private.event_report_rate_buckets.event_report_rate_buckets_expires_idx',
      'private.event_reports.event_reports_one_open_per_actor_idx',
      'private.event_reports.event_reports_open_event_idx',
      'private.moderation_review_requests.moderation_review_requests_one_open_idx'
    ]::text[]) collate "C")
  $$,
  'moderation indexes are exact'
);

select results_eq(
  $$
    select count(*)::bigint
    from information_schema.table_privileges
    where table_schema = 'private'
      and table_name in (
        'event_risk_disclosures',
        'event_moderation_evaluations',
        'event_moderation_actions',
        'event_reports',
        'event_report_rate_buckets',
        'moderation_review_requests',
        'staff_roles',
        'event_public_eligibility_intervals',
        'organizer_policy_versions',
        'organizer_policy_requirements',
        'event_policy_acceptances',
        'event_policy_legacy_exemptions'
      )
      and grantee in ('PUBLIC', 'anon', 'authenticated')
  $$,
  $$ values (0::bigint) $$,
  'private moderation tables deny every browser role by default'
);

select has_function(
  'private',
  'reject_immutable_moderation_record_change',
  array[]::text[],
  'immutable moderation record guard exists'
);

select has_function(
  'private',
  'guard_public_eligibility_interval_change',
  array[]::text[],
  'eligibility interval guard exists'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = procedures.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(procedures.proacl, pg_catalog.acldefault('f', procedures.proowner))
    ) as privileges
    where namespaces.nspname = 'private'
      and procedures.proname in (
        'reject_immutable_moderation_record_change',
        'guard_public_eligibility_interval_change'
      )
      and privileges.grantee in (
        0,
        (select oid from pg_catalog.pg_roles where rolname = 'anon'),
        (select oid from pg_catalog.pg_roles where rolname = 'authenticated')
      )
      and privileges.privilege_type = 'EXECUTE'
  $$,
  $$ values (0::bigint) $$,
  'trigger guards have no PUBLIC or browser execute default'
);

select has_trigger(
  'private',
  'event_moderation_actions',
  'event_moderation_actions_immutable',
  'moderation actions are append-only'
);
select has_trigger(
  'private',
  'event_policy_acceptances',
  'event_policy_acceptances_immutable',
  'policy acceptances are append-only'
);
select has_trigger(
  'private',
  'organizer_policy_versions',
  'organizer_policy_versions_immutable',
  'policy versions are append-only'
);
select has_trigger(
  'private',
  'event_policy_legacy_exemptions',
  'event_policy_legacy_exemptions_immutable',
  'legacy exemptions are append-only'
);
select has_trigger(
  'private',
  'event_public_eligibility_intervals',
  'event_public_eligibility_intervals_guard',
  'closed eligibility intervals are immutable'
);

insert into auth.users (id, email)
values ('62000000-0000-0000-0000-000000000001', 'moderation-schema@example.invalid');

insert into public.organizers (id, display_name)
values ('62000000-0000-0000-0000-000000000001', 'Moderation Schema Organizer');

insert into public.events (id, organizer_id, title)
values (
  '62000000-0000-0000-0000-000000000010',
  '62000000-0000-0000-0000-000000000001',
  'Moderation Schema Event'
);

select lives_ok(
  $$ update public.events set moderation_status = 'not_evaluated' where id = '62000000-0000-0000-0000-000000000010' $$,
  'transitional moderation vocabulary accepts not_evaluated'
);
select lives_ok(
  $$ update public.events set moderation_status = 'clear' where id = '62000000-0000-0000-0000-000000000010' $$,
  'transitional moderation vocabulary accepts clear'
);
select lives_ok(
  $$ update public.events set moderation_status = 'under_review' where id = '62000000-0000-0000-0000-000000000010' $$,
  'transitional moderation vocabulary accepts under_review'
);
select lives_ok(
  $$ update public.events set moderation_status = 'flagged' where id = '62000000-0000-0000-0000-000000000010' $$,
  'transitional moderation vocabulary preserves legacy flagged'
);
select lives_ok(
  $$ update public.events set moderation_status = 'blocked' where id = '62000000-0000-0000-0000-000000000010' $$,
  'transitional moderation vocabulary accepts blocked'
);
select lives_ok(
  $$ update public.events set moderation_status = 'removed' where id = '62000000-0000-0000-0000-000000000010' $$,
  'transitional moderation vocabulary accepts removed'
);
select throws_ok(
  $$ update public.events set moderation_status = 'approved' where id = '62000000-0000-0000-0000-000000000010' $$,
  '23514',
  'new row for relation "events" violates check constraint "events_moderation_status_check"',
  'transitional moderation vocabulary rejects unapproved states'
);

update public.events
set moderation_status = 'clear'
where id = '62000000-0000-0000-0000-000000000010';

select lives_ok(
  $fixtures$
    do $fixture_block$
    begin
    insert into private.event_risk_disclosures (
      event_id, minimum_age, alcohol_present, cannabis_present,
      explicit_adult_content, gambling_present, weapons_present, high_risk_activity
    ) values (
      '62000000-0000-0000-0000-000000000010', 'all_ages',
      false, false, false, false, false, false
    );

    insert into private.organizer_policy_versions (
      id, policy_kind, public_url, content_sha256, effective_at
    ) values
      ('moderation-test-terms', 'organizer_terms', 'https://example.invalid/terms', repeat('1', 64), now()),
      ('moderation-test-policy', 'event_policy', 'https://example.invalid/policy', repeat('2', 64), now());

    insert into private.organizer_policy_requirements (policy_kind, policy_version_id)
    values
      ('organizer_terms', 'moderation-test-terms'),
      ('event_policy', 'moderation-test-policy');

    insert into private.event_policy_acceptances (
      id, event_id, organizer_id, accepted_by_user_id, content_revision,
      input_sha256, organizer_terms_version_id, event_policy_version_id
    ) values (
      '62000000-0000-0000-0000-000000000020',
      '62000000-0000-0000-0000-000000000010',
      '62000000-0000-0000-0000-000000000001',
      '62000000-0000-0000-0000-000000000001',
      1,
      repeat('3', 64),
      'moderation-test-terms',
      'moderation-test-policy'
    );

    insert into private.event_policy_legacy_exemptions (
      id, event_id, grandfathered_content_revision, input_sha256, migration_identifier
    ) values (
      '62000000-0000-0000-0000-000000000021',
      '62000000-0000-0000-0000-000000000010',
      1,
      repeat('3', 64),
      'moderation-schema-test'
    );

    insert into private.event_moderation_evaluations (
      id, event_id, content_revision, input_sha256, queued_moderation_version,
      status, source, outcome, risk_level, reason_codes
    ) values (
      '62000000-0000-0000-0000-000000000030',
      '62000000-0000-0000-0000-000000000010',
      1,
      repeat('3', 64),
      0,
      'succeeded',
      'deterministic',
      'clear_candidate',
      'low',
      array['no_violation']
    );

    insert into private.event_moderation_actions (
      id, event_id, content_revision, input_sha256, actor_type, actor_user_id,
      source, action, previous_status, new_status, reason_code,
      policy_acceptance_id, moderation_version
    ) values (
      '62000000-0000-0000-0000-000000000040',
      '62000000-0000-0000-0000-000000000010',
      1,
      repeat('3', 64),
      'organizer',
      '62000000-0000-0000-0000-000000000001',
      'publish',
      'authorize_publication',
      'clear',
      'clear',
      'no_violation',
      '62000000-0000-0000-0000-000000000020',
      0
    );

    insert into private.event_moderation_actions (
      id, event_id, content_revision, input_sha256, actor_type, actor_user_id,
      source, action, previous_status, new_status, reason_code, moderation_version
    ) values (
      '62000000-0000-0000-0000-000000000041',
      '62000000-0000-0000-0000-000000000010',
      1,
      repeat('3', 64),
      'organizer',
      '62000000-0000-0000-0000-000000000001',
      'review_request',
      'request_review',
      'clear',
      'clear',
      'no_violation',
      0
    );

    insert into private.moderation_review_requests (
      id, event_id, organizer_id, content_revision, input_sha256,
      requested_action_id, status
    ) values (
      '62000000-0000-0000-0000-000000000050',
      '62000000-0000-0000-0000-000000000010',
      '62000000-0000-0000-0000-000000000001',
      1,
      repeat('3', 64),
      '62000000-0000-0000-0000-000000000041',
      'open'
    );

    insert into private.event_reports (
      id, event_id, content_revision, input_sha256, reporter_fingerprint, reason
    ) values (
      '62000000-0000-0000-0000-000000000060',
      '62000000-0000-0000-0000-000000000010',
      1,
      repeat('3', 64),
      repeat('4', 64),
      'unsafe'
    );

    insert into private.event_report_rate_buckets (
      bucket_type, bucket_digest, window_started_at, request_count, expires_at
    ) values ('actor', repeat('5', 64), now(), 1, now() + interval '2 minutes');

    insert into private.staff_roles (user_id, role, granted_by)
    values (
      '62000000-0000-0000-0000-000000000001',
      'admin',
      '62000000-0000-0000-0000-000000000001'
    );

    insert into private.event_public_eligibility_intervals (
      event_id, public_eligibility_version, eligibility_state, transition_reason
    ) values (
      '62000000-0000-0000-0000-000000000010',
      0,
      'ineligible',
      'initialization'
    );
    end
    $fixture_block$;
  $fixtures$,
  'moderation foundation accepts a complete structural fixture'
);

select throws_ok(
  $$
    insert into private.event_moderation_evaluations (
      event_id, content_revision, input_sha256, queued_moderation_version, status, source
    ) values (
      '62000000-0000-0000-0000-000000000010', 1, repeat('6', 64), 0, 'approved', 'human'
    )
  $$,
  '23514',
  'new row for relation "event_moderation_evaluations" violates check constraint "event_moderation_evaluations_status_check"',
  'evaluation status vocabulary rejects unknown states'
);

select throws_ok(
  $$
    insert into private.event_moderation_evaluations (
      event_id, content_revision, input_sha256, queued_moderation_version, status, source
    ) values (
      '62000000-0000-0000-0000-000000000010', 1, repeat('7', 64), 0, 'queued', 'organizer'
    )
  $$,
  '23514',
  'new row for relation "event_moderation_evaluations" violates check constraint "event_moderation_evaluations_source_check"',
  'evaluation source vocabulary rejects organizer-supplied work'
);

select throws_ok(
  $$
    insert into private.event_moderation_actions (
      event_id, content_revision, input_sha256, actor_type, source, action,
      previous_status, new_status, reason_code, moderation_version
    ) values (
      '62000000-0000-0000-0000-000000000010', 1, repeat('8', 64),
      'system', 'manual', 'approve', 'clear', 'clear', 'no_violation', 0
    )
  $$,
  '23514',
  'new row for relation "event_moderation_actions" violates check constraint "event_moderation_actions_action_check"',
  'action vocabulary rejects unapproved actions'
);

select throws_ok(
  $$
    insert into private.event_public_eligibility_intervals (
      event_id, public_eligibility_version, eligibility_state,
      started_action_id, transition_reason
    ) values (
      '62000000-0000-0000-0000-000000000010',
      1,
      'eligible',
      '62000000-0000-0000-0000-000000000040',
      'publication'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "event_public_eligibility_intervals_one_open_idx"',
  'only one eligibility interval may remain open per event'
);

select throws_ok(
  $$ update private.event_moderation_actions set reason_code = 'other' where id = '62000000-0000-0000-0000-000000000040' $$,
  'P0001',
  'MODERATION_ACTION_IMMUTABLE',
  'moderation action updates are rejected'
);

select throws_ok(
  $$ delete from private.event_moderation_actions where id = '62000000-0000-0000-0000-000000000040' $$,
  'P0001',
  'MODERATION_ACTION_IMMUTABLE',
  'moderation action deletes are rejected'
);

select throws_ok(
  $$ update private.event_policy_acceptances set accepted_at = accepted_at + interval '1 second' where id = '62000000-0000-0000-0000-000000000020' $$,
  'P0001',
  'POLICY_ACCEPTANCE_IMMUTABLE',
  'policy acceptance updates are rejected'
);

select throws_ok(
  $$ update private.organizer_policy_versions set public_url = 'https://example.invalid/changed' where id = 'moderation-test-terms' $$,
  'P0001',
  'POLICY_VERSION_IMMUTABLE',
  'policy version updates are rejected'
);

select throws_ok(
  $$ update private.event_policy_legacy_exemptions set grandfathered_content_revision = 2 where id = '62000000-0000-0000-0000-000000000021' $$,
  'P0001',
  'POLICY_LEGACY_EXEMPTION_IMMUTABLE',
  'legacy exemption updates are rejected'
);

select lives_ok(
  $$
    update private.event_public_eligibility_intervals
    set ended_at = now(), ended_action_id = '62000000-0000-0000-0000-000000000040'
    where event_id = '62000000-0000-0000-0000-000000000010'
      and public_eligibility_version = 0
  $$,
  'an open eligibility interval may be closed once'
);

select throws_ok(
  $$
    update private.event_public_eligibility_intervals
    set ended_at = ended_at + interval '1 second'
    where event_id = '62000000-0000-0000-0000-000000000010'
      and public_eligibility_version = 0
  $$,
  'P0001',
  'PUBLIC_ELIGIBILITY_INTERVAL_IMMUTABLE',
  'a closed eligibility interval cannot be changed'
);

select throws_ok(
  $$
    delete from private.event_public_eligibility_intervals
    where event_id = '62000000-0000-0000-0000-000000000010'
      and public_eligibility_version = 0
  $$,
  'P0001',
  'PUBLIC_ELIGIBILITY_INTERVAL_IMMUTABLE',
  'eligibility intervals cannot be deleted'
);

select * from finish();
rollback;
