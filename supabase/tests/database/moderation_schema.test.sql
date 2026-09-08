begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, private, extensions;

select plan(152);

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
      'public_history_status:text:NO',
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

select has_column(
  policy_fields.table_schema::name,
  policy_fields.table_name::name,
  policy_fields.column_name::name,
  format('%s.%s is a required Task 1 policy field', policy_fields.table_name, policy_fields.column_name)
)
from (values
  ('private', 'organizer_policy_versions', 'id', 'text'),
  ('private', 'organizer_policy_versions', 'policy_kind', 'text'),
  ('private', 'organizer_policy_versions', 'public_url', 'text'),
  ('private', 'organizer_policy_versions', 'content_sha256', 'text'),
  ('private', 'organizer_policy_versions', 'effective_at', 'timestamp with time zone'),
  ('private', 'organizer_policy_versions', 'created_at', 'timestamp with time zone'),
  ('private', 'organizer_policy_requirements', 'policy_kind', 'text'),
  ('private', 'organizer_policy_requirements', 'policy_version_id', 'text'),
  ('private', 'organizer_policy_requirements', 'updated_at', 'timestamp with time zone'),
  ('private', 'event_policy_acceptances', 'id', 'uuid'),
  ('private', 'event_policy_acceptances', 'event_id', 'uuid'),
  ('private', 'event_policy_acceptances', 'organizer_id', 'uuid'),
  ('private', 'event_policy_acceptances', 'accepted_by_user_id', 'uuid'),
  ('private', 'event_policy_acceptances', 'content_revision', 'bigint'),
  ('private', 'event_policy_acceptances', 'input_sha256', 'text'),
  ('private', 'event_policy_acceptances', 'organizer_terms_version_id', 'text'),
  ('private', 'event_policy_acceptances', 'event_policy_version_id', 'text'),
  ('private', 'event_policy_acceptances', 'accepted_at', 'timestamp with time zone'),
  ('private', 'event_policy_legacy_exemptions', 'id', 'uuid'),
  ('private', 'event_policy_legacy_exemptions', 'event_id', 'uuid'),
  ('private', 'event_policy_legacy_exemptions', 'grandfathered_content_revision', 'bigint'),
  ('private', 'event_policy_legacy_exemptions', 'input_sha256', 'text'),
  ('private', 'event_policy_legacy_exemptions', 'reason', 'text'),
  ('private', 'event_policy_legacy_exemptions', 'migration_identifier', 'text'),
  ('private', 'event_policy_legacy_exemptions', 'created_at', 'timestamp with time zone')
) as policy_fields(table_schema, table_name, column_name, expected_type);

select col_type_is(
  policy_fields.table_schema::name,
  policy_fields.table_name::name,
  policy_fields.column_name::name,
  policy_fields.expected_type,
  format('%s.%s has the required Task 1 type', policy_fields.table_name, policy_fields.column_name)
)
from (values
  ('private', 'organizer_policy_versions', 'id', 'text'),
  ('private', 'organizer_policy_versions', 'policy_kind', 'text'),
  ('private', 'organizer_policy_versions', 'public_url', 'text'),
  ('private', 'organizer_policy_versions', 'content_sha256', 'text'),
  ('private', 'organizer_policy_versions', 'effective_at', 'timestamp with time zone'),
  ('private', 'organizer_policy_versions', 'created_at', 'timestamp with time zone'),
  ('private', 'organizer_policy_requirements', 'policy_kind', 'text'),
  ('private', 'organizer_policy_requirements', 'policy_version_id', 'text'),
  ('private', 'organizer_policy_requirements', 'updated_at', 'timestamp with time zone'),
  ('private', 'event_policy_acceptances', 'id', 'uuid'),
  ('private', 'event_policy_acceptances', 'event_id', 'uuid'),
  ('private', 'event_policy_acceptances', 'organizer_id', 'uuid'),
  ('private', 'event_policy_acceptances', 'accepted_by_user_id', 'uuid'),
  ('private', 'event_policy_acceptances', 'content_revision', 'bigint'),
  ('private', 'event_policy_acceptances', 'input_sha256', 'text'),
  ('private', 'event_policy_acceptances', 'organizer_terms_version_id', 'text'),
  ('private', 'event_policy_acceptances', 'event_policy_version_id', 'text'),
  ('private', 'event_policy_acceptances', 'accepted_at', 'timestamp with time zone'),
  ('private', 'event_policy_legacy_exemptions', 'id', 'uuid'),
  ('private', 'event_policy_legacy_exemptions', 'event_id', 'uuid'),
  ('private', 'event_policy_legacy_exemptions', 'grandfathered_content_revision', 'bigint'),
  ('private', 'event_policy_legacy_exemptions', 'input_sha256', 'text'),
  ('private', 'event_policy_legacy_exemptions', 'reason', 'text'),
  ('private', 'event_policy_legacy_exemptions', 'migration_identifier', 'text'),
  ('private', 'event_policy_legacy_exemptions', 'created_at', 'timestamp with time zone')
) as policy_fields(table_schema, table_name, column_name, expected_type);

select col_not_null(
  policy_fields.table_schema::name,
  policy_fields.table_name::name,
  policy_fields.column_name::name,
  format('%s.%s is required', policy_fields.table_name, policy_fields.column_name)
)
from (values
  ('private', 'organizer_policy_versions', 'id'),
  ('private', 'organizer_policy_versions', 'policy_kind'),
  ('private', 'organizer_policy_versions', 'public_url'),
  ('private', 'organizer_policy_versions', 'content_sha256'),
  ('private', 'organizer_policy_versions', 'effective_at'),
  ('private', 'organizer_policy_versions', 'created_at'),
  ('private', 'organizer_policy_requirements', 'policy_kind'),
  ('private', 'organizer_policy_requirements', 'policy_version_id'),
  ('private', 'organizer_policy_requirements', 'updated_at'),
  ('private', 'event_policy_acceptances', 'id'),
  ('private', 'event_policy_acceptances', 'event_id'),
  ('private', 'event_policy_acceptances', 'organizer_id'),
  ('private', 'event_policy_acceptances', 'accepted_by_user_id'),
  ('private', 'event_policy_acceptances', 'content_revision'),
  ('private', 'event_policy_acceptances', 'input_sha256'),
  ('private', 'event_policy_acceptances', 'organizer_terms_version_id'),
  ('private', 'event_policy_acceptances', 'event_policy_version_id'),
  ('private', 'event_policy_acceptances', 'accepted_at'),
  ('private', 'event_policy_legacy_exemptions', 'id'),
  ('private', 'event_policy_legacy_exemptions', 'event_id'),
  ('private', 'event_policy_legacy_exemptions', 'grandfathered_content_revision'),
  ('private', 'event_policy_legacy_exemptions', 'input_sha256'),
  ('private', 'event_policy_legacy_exemptions', 'reason'),
  ('private', 'event_policy_legacy_exemptions', 'migration_identifier'),
  ('private', 'event_policy_legacy_exemptions', 'created_at')
) as policy_fields(table_schema, table_name, column_name);

select col_is_pk('private', 'organizer_policy_versions', 'id', 'policy version id is the primary key');
select col_is_pk('private', 'organizer_policy_requirements', 'policy_kind', 'policy kind is the requirement primary key');
select col_is_pk('private', 'event_policy_acceptances', 'id', 'policy acceptance id is the primary key');
select col_is_pk('private', 'event_policy_legacy_exemptions', 'id', 'legacy exemption id is the primary key');

select fk_ok(
  policy_fks.table_schema::name,
  policy_fks.table_name::name,
  policy_fks.column_name::name,
  policy_fks.foreign_schema::name,
  policy_fks.foreign_table::name,
  policy_fks.foreign_column::name,
  format('%s.%s references %s.%s(%s)',
    policy_fks.table_name,
    policy_fks.column_name,
    policy_fks.foreign_schema,
    policy_fks.foreign_table,
    policy_fks.foreign_column
  )
)
from (values
  ('private', 'event_policy_acceptances', 'event_id', 'public', 'events', 'id'),
  ('private', 'event_policy_acceptances', 'organizer_id', 'public', 'organizers', 'id'),
  ('private', 'event_policy_acceptances', 'accepted_by_user_id', 'auth', 'users', 'id'),
  ('private', 'event_policy_acceptances', 'organizer_terms_version_id', 'private', 'organizer_policy_versions', 'id'),
  ('private', 'event_policy_acceptances', 'event_policy_version_id', 'private', 'organizer_policy_versions', 'id'),
  ('private', 'event_policy_legacy_exemptions', 'event_id', 'public', 'events', 'id')
) as policy_fks(
  table_schema, table_name, column_name, foreign_schema, foreign_table, foreign_column
);

select fk_ok(
  'private',
  'organizer_policy_requirements',
  array['policy_kind', 'policy_version_id']::name[],
  'private',
  'organizer_policy_versions',
  array['policy_kind', 'id']::name[],
  'policy requirements reference an exact same-kind policy version'
);

select results_eq(
  $$
    select (array_agg(
      namespaces.nspname || '.' || tables.relname || '.' || constraints.conname || ':' ||
      pg_catalog.pg_get_constraintdef(constraints.oid)
      order by namespaces.nspname, tables.relname, constraints.conname
    )) collate "C"
    from pg_catalog.pg_constraint as constraints
    join pg_catalog.pg_class as tables
      on tables.oid = constraints.conrelid
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = tables.relnamespace
    where constraints.contype = 'c'
      and constraints.conname in (
        'organizer_policy_versions_kind_check',
        'organizer_policy_versions_id_check',
        'organizer_policy_versions_url_check',
        'organizer_policy_versions_digest_check',
        'organizer_policy_requirements_kind_check',
        'event_policy_acceptances_content_revision_check',
        'event_policy_acceptances_digest_check',
        'event_policy_legacy_exemptions_revision_check',
        'event_policy_legacy_exemptions_digest_check',
        'event_policy_legacy_exemptions_reason_check',
        'event_policy_legacy_exemptions_migration_check'
      )
  $$,
  $$
    values ((array[
      'private.event_policy_acceptances.event_policy_acceptances_content_revision_check:CHECK ((content_revision >= 1))',
      'private.event_policy_acceptances.event_policy_acceptances_digest_check:CHECK ((input_sha256 ~ ''^[a-f0-9]{64}$''::text))',
      'private.event_policy_legacy_exemptions.event_policy_legacy_exemptions_digest_check:CHECK ((input_sha256 ~ ''^[a-f0-9]{64}$''::text))',
      'private.event_policy_legacy_exemptions.event_policy_legacy_exemptions_migration_check:CHECK (((char_length(btrim(migration_identifier)) >= 1) AND (char_length(btrim(migration_identifier)) <= 120)))',
      'private.event_policy_legacy_exemptions.event_policy_legacy_exemptions_reason_check:CHECK ((reason = ''pre_build_2_5_publication''::text))',
      'private.event_policy_legacy_exemptions.event_policy_legacy_exemptions_revision_check:CHECK ((grandfathered_content_revision >= 1))',
      'private.organizer_policy_requirements.organizer_policy_requirements_kind_check:CHECK ((policy_kind = ANY (ARRAY[''organizer_terms''::text, ''event_policy''::text])))',
      'private.organizer_policy_versions.organizer_policy_versions_digest_check:CHECK ((content_sha256 ~ ''^[a-f0-9]{64}$''::text))',
      'private.organizer_policy_versions.organizer_policy_versions_id_check:CHECK (((char_length(btrim(id)) >= 1) AND (char_length(btrim(id)) <= 120)))',
      'private.organizer_policy_versions.organizer_policy_versions_kind_check:CHECK ((policy_kind = ANY (ARRAY[''organizer_terms''::text, ''event_policy''::text])))',
      'private.organizer_policy_versions.organizer_policy_versions_url_check:CHECK (((char_length(btrim(public_url)) >= 1) AND (char_length(btrim(public_url)) <= 500)))'
    ]::text[]) collate "C")
  $$,
  'policy checks have the exact Task 1 definitions while allowing later additive checks'
);

select results_eq(
  $$
    select (array_agg(
      constraints.conname || ':' || pg_catalog.pg_get_constraintdef(constraints.oid)
      order by constraints.conname
    )) collate "C"
    from pg_catalog.pg_constraint as constraints
    where constraints.conrelid = 'private.event_moderation_actions'::regclass
      and constraints.conname in (
        'event_moderation_actions_previous_status_check',
        'event_moderation_actions_new_status_check'
      )
  $$,
  $$
    values ((array[
      'event_moderation_actions_new_status_check:CHECK ((new_status = ANY (ARRAY[''not_evaluated''::text, ''clear''::text, ''under_review''::text, ''blocked''::text, ''removed''::text])))',
      'event_moderation_actions_previous_status_check:CHECK ((previous_status = ANY (ARRAY[''not_evaluated''::text, ''clear''::text, ''under_review''::text, ''blocked''::text, ''removed''::text])))'
    ]::text[]) collate "C")
  $$,
  'audit actions use the final moderation-state vocabulary without legacy flagged'
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
      source_namespaces.nspname || '.' || source_tables.relname || '.' ||
      constraints.conname || ':(' ||
      array_to_string(array(
        select source_columns.attname::text
        from unnest(constraints.conkey) with ordinality as source_keys(attnum, ordinal_position)
        join pg_catalog.pg_attribute as source_columns
          on source_columns.attrelid = constraints.conrelid
         and source_columns.attnum = source_keys.attnum
        order by source_keys.ordinal_position
      ), ',') || ')->' ||
      target_namespaces.nspname || '.' || target_tables.relname || '(' ||
      array_to_string(array(
        select target_columns.attname::text
        from unnest(constraints.confkey) with ordinality as target_keys(attnum, ordinal_position)
        join pg_catalog.pg_attribute as target_columns
          on target_columns.attrelid = constraints.confrelid
         and target_columns.attnum = target_keys.attnum
        order by target_keys.ordinal_position
      ), ',') || '):' ||
      case constraints.confdeltype
        when 'a' then 'NO ACTION'
        when 'r' then 'RESTRICT'
        when 'c' then 'CASCADE'
        when 'n' then 'SET NULL'
        when 'd' then 'SET DEFAULT'
      end
      order by source_namespaces.nspname, source_tables.relname, constraints.conname
    )) collate "C"
    from pg_catalog.pg_constraint as constraints
    join pg_catalog.pg_class as source_tables
      on source_tables.oid = constraints.conrelid
    join pg_catalog.pg_namespace as source_namespaces
      on source_namespaces.oid = source_tables.relnamespace
    join pg_catalog.pg_class as target_tables
      on target_tables.oid = constraints.confrelid
    join pg_catalog.pg_namespace as target_namespaces
      on target_namespaces.oid = target_tables.relnamespace
    where constraints.contype = 'f'
      and (
        (
          source_namespaces.nspname = 'private'
          and source_tables.relname in (
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
        or constraints.conname = 'events_publicly_authorized_action_id_fkey'
      )
  $$,
  $$
    values ((array[
      'private.event_moderation_actions.event_moderation_actions_actor_user_id_fkey:(actor_user_id)->auth.users(id):RESTRICT',
      'private.event_moderation_actions.event_moderation_actions_evaluation_id_fkey:(evaluation_id)->private.event_moderation_evaluations(id):RESTRICT',
      'private.event_moderation_actions.event_moderation_actions_event_id_fkey:(event_id)->public.events(id):RESTRICT',
      'private.event_moderation_actions.event_moderation_actions_policy_acceptance_id_fkey:(policy_acceptance_id)->private.event_policy_acceptances(id):RESTRICT',
      'private.event_moderation_actions.event_moderation_actions_policy_legacy_exemption_id_fkey:(policy_legacy_exemption_id)->private.event_policy_legacy_exemptions(id):RESTRICT',
      'private.event_moderation_actions.event_moderation_actions_review_request_id_fkey:(review_request_id)->private.moderation_review_requests(id):RESTRICT',
      'private.event_moderation_evaluations.event_moderation_evaluations_event_id_fkey:(event_id)->public.events(id):RESTRICT',
      'private.event_policy_acceptances.event_policy_acceptances_accepted_by_user_id_fkey:(accepted_by_user_id)->auth.users(id):RESTRICT',
      'private.event_policy_acceptances.event_policy_acceptances_event_id_fkey:(event_id)->public.events(id):RESTRICT',
      'private.event_policy_acceptances.event_policy_acceptances_event_policy_version_id_fkey:(event_policy_version_id)->private.organizer_policy_versions(id):RESTRICT',
      'private.event_policy_acceptances.event_policy_acceptances_organizer_id_fkey:(organizer_id)->public.organizers(id):RESTRICT',
      'private.event_policy_acceptances.event_policy_acceptances_organizer_terms_version_id_fkey:(organizer_terms_version_id)->private.organizer_policy_versions(id):RESTRICT',
      'private.event_policy_legacy_exemptions.event_policy_legacy_exemptions_event_id_fkey:(event_id)->public.events(id):RESTRICT',
      'private.event_public_eligibility_intervals.event_public_eligibility_intervals_ended_action_id_fkey:(ended_action_id)->private.event_moderation_actions(id):RESTRICT',
      'private.event_public_eligibility_intervals.event_public_eligibility_intervals_event_id_fkey:(event_id)->public.events(id):RESTRICT',
      'private.event_public_eligibility_intervals.event_public_eligibility_intervals_started_action_id_fkey:(started_action_id)->private.event_moderation_actions(id):RESTRICT',
      'private.event_reports.event_reports_event_id_fkey:(event_id)->public.events(id):RESTRICT',
      'private.event_risk_disclosures.event_risk_disclosures_event_id_fkey:(event_id)->public.events(id):RESTRICT',
      'private.moderation_review_requests.moderation_review_requests_event_id_fkey:(event_id)->public.events(id):RESTRICT',
      'private.moderation_review_requests.moderation_review_requests_organizer_id_fkey:(organizer_id)->public.organizers(id):RESTRICT',
      'private.moderation_review_requests.moderation_review_requests_requested_action_id_fkey:(requested_action_id)->private.event_moderation_actions(id):RESTRICT',
      'private.moderation_review_requests.moderation_review_requests_resolved_action_id_fkey:(resolved_action_id)->private.event_moderation_actions(id):RESTRICT',
      'private.organizer_policy_requirements.organizer_policy_requirements_policy_version_fkey:(policy_kind,policy_version_id)->private.organizer_policy_versions(policy_kind,id):RESTRICT',
      'private.staff_roles.staff_roles_granted_by_fkey:(granted_by)->auth.users(id):RESTRICT',
      'private.staff_roles.staff_roles_user_id_fkey:(user_id)->auth.users(id):RESTRICT',
      'public.events.events_publicly_authorized_action_id_fkey:(publicly_authorized_action_id)->private.event_moderation_actions(id):RESTRICT'
    ]::text[]) collate "C")
  $$,
  'moderation foreign-key columns, targets, order, and deletion behavior are exact'
);

select results_eq(
  $$
    select (array_agg(
      schemaname || '.' || tablename || '.' || indexname || ':' || indexdef
      order by indexname
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
        'event_policy_legacy_exemptions_event_key',
        'organizer_policy_versions_kind_id_key'
      )
  $$,
  $$
    values ((array[
      'private.event_moderation_actions.event_moderation_actions_event_created_idx:CREATE INDEX event_moderation_actions_event_created_idx ON private.event_moderation_actions USING btree (event_id, created_at DESC, id)',
      'private.event_moderation_evaluations.event_moderation_evaluations_input_key:CREATE UNIQUE INDEX event_moderation_evaluations_input_key ON private.event_moderation_evaluations USING btree (event_id, content_revision, input_sha256, source, queued_moderation_version)',
      'private.event_moderation_evaluations.event_moderation_evaluations_queue_idx:CREATE INDEX event_moderation_evaluations_queue_idx ON private.event_moderation_evaluations USING btree (created_at, id) WHERE (status = ''queued''::text)',
      'private.event_policy_acceptances.event_policy_acceptances_exact_key:CREATE UNIQUE INDEX event_policy_acceptances_exact_key ON private.event_policy_acceptances USING btree (event_id, organizer_id, accepted_by_user_id, content_revision, input_sha256, organizer_terms_version_id, event_policy_version_id)',
      'private.event_policy_legacy_exemptions.event_policy_legacy_exemptions_event_key:CREATE UNIQUE INDEX event_policy_legacy_exemptions_event_key ON private.event_policy_legacy_exemptions USING btree (event_id)',
      'private.event_public_eligibility_intervals.event_public_eligibility_intervals_one_open_idx:CREATE UNIQUE INDEX event_public_eligibility_intervals_one_open_idx ON private.event_public_eligibility_intervals USING btree (event_id) WHERE (ended_at IS NULL)',
      'private.event_report_rate_buckets.event_report_rate_buckets_expires_idx:CREATE INDEX event_report_rate_buckets_expires_idx ON private.event_report_rate_buckets USING btree (expires_at)',
      'private.event_reports.event_reports_one_open_per_actor_idx:CREATE UNIQUE INDEX event_reports_one_open_per_actor_idx ON private.event_reports USING btree (event_id, content_revision, reporter_fingerprint) WHERE (status = ''open''::text)',
      'private.event_reports.event_reports_open_event_idx:CREATE INDEX event_reports_open_event_idx ON private.event_reports USING btree (event_id, content_revision, created_at) WHERE (status = ''open''::text)',
      'private.moderation_review_requests.moderation_review_requests_one_open_idx:CREATE UNIQUE INDEX moderation_review_requests_one_open_idx ON private.moderation_review_requests USING btree (event_id) WHERE (status = ''open''::text)',
      'private.organizer_policy_versions.organizer_policy_versions_kind_id_key:CREATE UNIQUE INDEX organizer_policy_versions_kind_id_key ON private.organizer_policy_versions USING btree (policy_kind, id)'
    ]::text[]) collate "C")
  $$,
  'critical moderation indexes have exact uniqueness, key order, sort order, and predicates'
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
  'final moderation vocabulary accepts not_evaluated'
);
select lives_ok(
  $$ update public.events set moderation_status = 'clear' where id = '62000000-0000-0000-0000-000000000010' $$,
  'final moderation vocabulary accepts clear'
);
select lives_ok(
  $$ update public.events set moderation_status = 'under_review' where id = '62000000-0000-0000-0000-000000000010' $$,
  'final moderation vocabulary accepts under_review'
);
select throws_ok(
  $$ update public.events set moderation_status = 'flagged' where id = '62000000-0000-0000-0000-000000000010' $$,
  '23514',
  'new row for relation "events" violates check constraint "events_moderation_status_check"',
  'final moderation vocabulary rejects legacy flagged'
);
select lives_ok(
  $$ update public.events set moderation_status = 'blocked' where id = '62000000-0000-0000-0000-000000000010' $$,
  'final moderation vocabulary accepts blocked'
);
select lives_ok(
  $$ update public.events set moderation_status = 'removed' where id = '62000000-0000-0000-0000-000000000010' $$,
  'final moderation vocabulary accepts removed'
);
select throws_ok(
  $$ update public.events set moderation_status = 'approved' where id = '62000000-0000-0000-0000-000000000010' $$,
  '23514',
  'new row for relation "events" violates check constraint "events_moderation_status_check"',
  'final moderation vocabulary rejects unapproved states'
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
      id, policy_kind, stage, public_url, content_sha256, effective_at
    ) values
      (
        'moderation-test-terms', 'organizer_terms', 'production_approved',
        'https://example.invalid/terms', repeat('1', 64), now()
      ),
      (
        'moderation-test-policy', 'event_policy', 'production_approved',
        'https://example.invalid/policy', repeat('2', 64), now()
      );

    update private.organizer_policy_requirements
    set policy_version_id = case policy_kind
      when 'organizer_terms' then 'moderation-test-terms'
      else 'moderation-test-policy'
    end
    where policy_kind in ('organizer_terms', 'event_policy');

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
    insert into private.event_moderation_actions (
      event_id, content_revision, input_sha256, actor_type, source, action,
      previous_status, new_status, reason_code, moderation_version
    ) values (
      '62000000-0000-0000-0000-000000000010', 1, repeat('9', 64),
      'system', 'manual', 'hold', 'flagged', 'clear', 'no_violation', 0
    )
  $$,
  '23514',
  'new row for relation "event_moderation_actions" violates check constraint "event_moderation_actions_previous_status_check"',
  'audit actions reject legacy flagged as a previous state'
);

select throws_ok(
  $$
    insert into private.event_moderation_actions (
      event_id, content_revision, input_sha256, actor_type, source, action,
      previous_status, new_status, reason_code, moderation_version
    ) values (
      '62000000-0000-0000-0000-000000000010', 1, repeat('a', 64),
      'system', 'manual', 'hold', 'clear', 'flagged', 'no_violation', 0
    )
  $$,
  '23514',
  'new row for relation "event_moderation_actions" violates check constraint "event_moderation_actions_new_status_check"',
  'audit actions reject legacy flagged as a new state'
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
  $$ delete from private.event_policy_acceptances where id = '62000000-0000-0000-0000-000000000020' $$,
  'P0001',
  'POLICY_ACCEPTANCE_IMMUTABLE',
  'policy acceptance deletes are rejected'
);

select throws_ok(
  $$ update private.organizer_policy_versions set public_url = 'https://example.invalid/changed' where id = 'moderation-test-terms' $$,
  'P0001',
  'POLICY_VERSION_IMMUTABLE',
  'policy version updates are rejected'
);

select throws_ok(
  $$ delete from private.organizer_policy_versions where id = 'moderation-test-terms' $$,
  'P0001',
  'POLICY_VERSION_IMMUTABLE',
  'policy version deletes are rejected'
);

select throws_ok(
  $$ update private.event_policy_legacy_exemptions set grandfathered_content_revision = 2 where id = '62000000-0000-0000-0000-000000000021' $$,
  'P0001',
  'POLICY_LEGACY_EXEMPTION_IMMUTABLE',
  'legacy exemption updates are rejected'
);

select throws_ok(
  $$ delete from private.event_policy_legacy_exemptions where id = '62000000-0000-0000-0000-000000000021' $$,
  'P0001',
  'POLICY_LEGACY_EXEMPTION_IMMUTABLE',
  'legacy exemption deletes are rejected'
);

select lives_ok(
  $$
    update private.event_public_eligibility_intervals
    set ended_at = statement_timestamp(), ended_action_id = '62000000-0000-0000-0000-000000000040'
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
