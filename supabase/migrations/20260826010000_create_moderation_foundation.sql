alter table public.events
  drop constraint events_moderation_status_check,
  add column content_revision bigint not null default 1,
  add column moderated_revision bigint,
  add column moderation_version bigint not null default 0,
  add column moderation_updated_at timestamptz,
  add column public_history_status text,
  add column first_publicly_eligible_at timestamptz,
  add column public_eligibility_version bigint not null default 0,
  add column publicly_authorized_revision bigint,
  add column publicly_authorized_action_id uuid,
  add constraint events_content_revision_check check (content_revision >= 1),
  add constraint events_moderated_revision_check check (
    moderated_revision is null
    or moderated_revision between 1 and content_revision
  ),
  add constraint events_moderation_version_check check (moderation_version >= 0),
  add constraint events_moderation_status_check check (
    moderation_status in (
      'not_evaluated',
      'clear',
      'under_review',
      'flagged',
      'blocked',
      'removed'
    )
  ),
  add constraint events_public_history_status_check check (
    public_history_status is null
    or public_history_status in ('unknown', 'never_public', 'previously_public')
  ),
  add constraint events_public_history_time_check check (
    (public_history_status is null and first_publicly_eligible_at is null)
    or (public_history_status in ('unknown', 'never_public') and first_publicly_eligible_at is null)
    or (public_history_status = 'previously_public' and first_publicly_eligible_at is not null)
  ),
  add constraint events_public_eligibility_version_check check (
    public_eligibility_version >= 0
  ),
  add constraint events_publicly_authorized_revision_check check (
    publicly_authorized_revision is null
    or publicly_authorized_revision between 1 and content_revision
  ),
  add constraint events_public_authorization_check check (
    (publicly_authorized_revision is null) = (publicly_authorized_action_id is null)
  );

create table private.event_risk_disclosures (
  event_id uuid primary key
    references public.events(id) on delete restrict,
  minimum_age text not null,
  alcohol_present boolean not null,
  cannabis_present boolean not null,
  explicit_adult_content boolean not null,
  gambling_present boolean not null,
  weapons_present boolean not null,
  high_risk_activity boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_risk_disclosures_minimum_age_check check (
    minimum_age in ('all_ages', '18_plus', '21_plus')
  )
);

create table private.event_moderation_evaluations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null
    references public.events(id) on delete restrict,
  content_revision bigint not null,
  input_sha256 text not null,
  queued_moderation_version bigint not null,
  status text not null default 'queued',
  source text not null,
  outcome text,
  risk_level text,
  reason_codes text[] not null default array[]::text[],
  provider_reference text,
  model_version text,
  attempt_count integer not null default 0,
  failure_code text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint event_moderation_evaluations_content_revision_check check (
    content_revision >= 1
  ),
  constraint event_moderation_evaluations_digest_check check (
    input_sha256 ~ '^[a-f0-9]{64}$'
  ),
  constraint event_moderation_evaluations_version_check check (
    queued_moderation_version >= 0
  ),
  constraint event_moderation_evaluations_status_check check (
    status in ('queued', 'processing', 'succeeded', 'failed', 'superseded')
  ),
  constraint event_moderation_evaluations_source_check check (
    source in ('deterministic', 'contextual', 'human', 'report')
  ),
  constraint event_moderation_evaluations_outcome_check check (
    outcome is null
    or outcome in ('clear_candidate', 'review_required', 'prohibited_candidate')
  ),
  constraint event_moderation_evaluations_risk_check check (
    risk_level is null or risk_level in ('low', 'high')
  ),
  constraint event_moderation_evaluations_reason_codes_check check (
    reason_codes <@ array[
      'adult_explicit',
      'weapons',
      'gambling',
      'hate_extremism',
      'scam_misleading',
      'unsafe_activity',
      'location_invalid',
      'age_mismatch',
      'disclosure_mismatch',
      'user_report',
      'no_violation',
      'other'
    ]::text[]
    and array_position(reason_codes, null) is null
    and cardinality(reason_codes) <= 12
  ),
  constraint event_moderation_evaluations_provider_reference_check check (
    provider_reference is null
    or char_length(provider_reference) between 1 and 255
  ),
  constraint event_moderation_evaluations_model_version_check check (
    model_version is null or char_length(model_version) between 1 and 120
  ),
  constraint event_moderation_evaluations_attempt_count_check check (
    attempt_count between 0 and 3
  ),
  constraint event_moderation_evaluations_failure_code_check check (
    failure_code is null or char_length(failure_code) between 1 and 80
  ),
  constraint event_moderation_evaluations_timestamps_check check (
    (finished_at is null or started_at is not null)
    and (started_at is null or started_at >= created_at)
    and (finished_at is null or finished_at >= started_at)
  )
);

create unique index event_moderation_evaluations_input_key
on private.event_moderation_evaluations (
  event_id,
  content_revision,
  input_sha256,
  source,
  queued_moderation_version
);

create index event_moderation_evaluations_queue_idx
on private.event_moderation_evaluations (created_at, id)
where status = 'queued';

create table private.organizer_policy_versions (
  id text primary key,
  policy_kind text not null,
  public_url text not null,
  content_sha256 text not null,
  effective_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint organizer_policy_versions_kind_check check (
    policy_kind in ('organizer_terms', 'event_policy')
  ),
  constraint organizer_policy_versions_id_check check (
    char_length(btrim(id)) between 1 and 120
  ),
  constraint organizer_policy_versions_url_check check (
    char_length(btrim(public_url)) between 1 and 500
  ),
  constraint organizer_policy_versions_digest_check check (
    content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  constraint organizer_policy_versions_kind_id_key unique (policy_kind, id)
);

create table private.organizer_policy_requirements (
  policy_kind text primary key,
  policy_version_id text not null,
  updated_at timestamptz not null default now(),
  constraint organizer_policy_requirements_kind_check check (
    policy_kind in ('organizer_terms', 'event_policy')
  ),
  constraint organizer_policy_requirements_policy_version_fkey
    foreign key (policy_kind, policy_version_id)
    references private.organizer_policy_versions(policy_kind, id)
    on delete restrict
);

create table private.event_policy_acceptances (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null
    references public.events(id) on delete restrict,
  organizer_id uuid not null
    references public.organizers(id) on delete restrict,
  accepted_by_user_id uuid not null
    references auth.users(id) on delete restrict,
  content_revision bigint not null,
  input_sha256 text not null,
  organizer_terms_version_id text not null
    references private.organizer_policy_versions(id) on delete restrict,
  event_policy_version_id text not null
    references private.organizer_policy_versions(id) on delete restrict,
  accepted_at timestamptz not null default now(),
  constraint event_policy_acceptances_content_revision_check check (
    content_revision >= 1
  ),
  constraint event_policy_acceptances_digest_check check (
    input_sha256 ~ '^[a-f0-9]{64}$'
  )
);

create unique index event_policy_acceptances_exact_key
on private.event_policy_acceptances (
  event_id,
  organizer_id,
  accepted_by_user_id,
  content_revision,
  input_sha256,
  organizer_terms_version_id,
  event_policy_version_id
);

create table private.event_policy_legacy_exemptions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null
    references public.events(id) on delete restrict,
  grandfathered_content_revision bigint not null,
  input_sha256 text not null,
  reason text not null default 'pre_build_2_5_publication',
  migration_identifier text not null,
  created_at timestamptz not null default now(),
  constraint event_policy_legacy_exemptions_revision_check check (
    grandfathered_content_revision >= 1
  ),
  constraint event_policy_legacy_exemptions_digest_check check (
    input_sha256 ~ '^[a-f0-9]{64}$'
  ),
  constraint event_policy_legacy_exemptions_reason_check check (
    reason = 'pre_build_2_5_publication'
  ),
  constraint event_policy_legacy_exemptions_migration_check check (
    char_length(btrim(migration_identifier)) between 1 and 120
  )
);

create unique index event_policy_legacy_exemptions_event_key
on private.event_policy_legacy_exemptions (event_id);

create table private.event_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null
    references public.events(id) on delete restrict,
  previous_content_revision bigint,
  content_revision bigint not null,
  input_sha256 text not null,
  actor_type text not null,
  actor_user_id uuid
    references auth.users(id) on delete restrict,
  source text not null,
  action text not null,
  previous_status text not null,
  new_status text not null,
  previous_public_history_status text,
  new_public_history_status text,
  reason_code text not null,
  internal_note text,
  evaluation_id uuid
    references private.event_moderation_evaluations(id) on delete restrict,
  review_request_id uuid,
  policy_acceptance_id uuid
    references private.event_policy_acceptances(id) on delete restrict,
  policy_legacy_exemption_id uuid
    references private.event_policy_legacy_exemptions(id) on delete restrict,
  moderation_version bigint not null,
  created_at timestamptz not null default now(),
  constraint event_moderation_actions_previous_revision_check check (
    previous_content_revision is null
    or previous_content_revision >= 1
  ),
  constraint event_moderation_actions_content_revision_check check (
    content_revision >= 1
  ),
  constraint event_moderation_actions_revision_order_check check (
    previous_content_revision is null
    or previous_content_revision <= content_revision
  ),
  constraint event_moderation_actions_digest_check check (
    input_sha256 ~ '^[a-f0-9]{64}$'
  ),
  constraint event_moderation_actions_actor_type_check check (
    actor_type in ('system', 'organizer', 'moderator', 'admin')
  ),
  constraint event_moderation_actions_actor_identity_check check (
    (actor_type = 'system' and actor_user_id is null)
    or (actor_type <> 'system' and actor_user_id is not null)
  ),
  constraint event_moderation_actions_source_check check (
    source in (
      'publish',
      'edit',
      'evaluation',
      'report_escalation',
      'review_request',
      'manual',
      'migration'
    )
  ),
  constraint event_moderation_actions_action_check check (
    action in (
      'record_revision',
      'authorize_publication',
      'clear',
      'hold',
      'block',
      'remove',
      'restore',
      'resolve_legacy_history',
      'request_review',
      'resolve_review'
    )
  ),
  constraint event_moderation_actions_previous_status_check check (
    previous_status in (
      'not_evaluated',
      'clear',
      'under_review',
      'flagged',
      'blocked',
      'removed'
    )
  ),
  constraint event_moderation_actions_new_status_check check (
    new_status in (
      'not_evaluated',
      'clear',
      'under_review',
      'flagged',
      'blocked',
      'removed'
    )
  ),
  constraint event_moderation_actions_previous_history_check check (
    previous_public_history_status is null
    or previous_public_history_status in ('unknown', 'never_public', 'previously_public')
  ),
  constraint event_moderation_actions_new_history_check check (
    new_public_history_status is null
    or new_public_history_status in ('unknown', 'never_public', 'previously_public')
  ),
  constraint event_moderation_actions_reason_check check (
    reason_code in (
      'adult_explicit',
      'weapons',
      'gambling',
      'hate_extremism',
      'scam_misleading',
      'unsafe_activity',
      'location_invalid',
      'age_mismatch',
      'disclosure_mismatch',
      'user_report',
      'no_violation',
      'other'
    )
  ),
  constraint event_moderation_actions_internal_note_check check (
    internal_note is null or char_length(internal_note) <= 1000
  ),
  constraint event_moderation_actions_authorization_basis_check check (
    (
      action = 'authorize_publication'
      and num_nonnulls(policy_acceptance_id, policy_legacy_exemption_id) = 1
    )
    or (
      action <> 'authorize_publication'
      and policy_acceptance_id is null
      and policy_legacy_exemption_id is null
    )
  ),
  constraint event_moderation_actions_acceptance_authority_check check (
    policy_acceptance_id is null
    or (source = 'publish' and actor_type = 'organizer' and actor_user_id is not null)
  ),
  constraint event_moderation_actions_legacy_authority_check check (
    policy_legacy_exemption_id is null
    or (source = 'migration' and actor_type = 'system' and actor_user_id is null)
  ),
  constraint event_moderation_actions_version_check check (
    moderation_version >= 0
  )
);

create index event_moderation_actions_event_created_idx
on private.event_moderation_actions (event_id, created_at desc, id);

create table private.event_reports (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null
    references public.events(id) on delete restrict,
  content_revision bigint not null,
  input_sha256 text not null,
  reporter_fingerprint text not null,
  reason text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint event_reports_content_revision_check check (content_revision >= 1),
  constraint event_reports_input_digest_check check (
    input_sha256 ~ '^[a-f0-9]{64}$'
  ),
  constraint event_reports_reporter_fingerprint_check check (
    reporter_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  constraint event_reports_reason_check check (
    reason in (
      'scam_misleading',
      'unsafe',
      'prohibited_content',
      'wrong_location',
      'event_missing',
      'adult_misrepresented',
      'hate_extremism',
      'other'
    )
  ),
  constraint event_reports_status_check check (
    status in ('open', 'reviewed', 'dismissed', 'superseded')
  ),
  constraint event_reports_resolution_check check (
    (status = 'open' and resolved_at is null)
    or (status <> 'open' and resolved_at is not null)
  )
);

create unique index event_reports_one_open_per_actor_idx
on private.event_reports (event_id, content_revision, reporter_fingerprint)
where status = 'open';

create index event_reports_open_event_idx
on private.event_reports (event_id, content_revision, created_at)
where status = 'open';

create table private.event_report_rate_buckets (
  bucket_type text not null,
  bucket_digest text not null,
  window_started_at timestamptz not null,
  request_count integer not null,
  expires_at timestamptz not null,
  constraint event_report_rate_buckets_pkey primary key (bucket_type, bucket_digest),
  constraint event_report_rate_buckets_type_check check (
    bucket_type in ('actor', 'network')
  ),
  constraint event_report_rate_buckets_digest_check check (
    bucket_digest ~ '^[a-f0-9]{64}$'
  ),
  constraint event_report_rate_buckets_count_check check (
    request_count between 1 and 1000
  ),
  constraint event_report_rate_buckets_window_check check (
    expires_at > window_started_at
  )
);

create index event_report_rate_buckets_expires_idx
on private.event_report_rate_buckets (expires_at);

create table private.moderation_review_requests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null
    references public.events(id) on delete restrict,
  organizer_id uuid not null
    references public.organizers(id) on delete restrict,
  content_revision bigint not null,
  input_sha256 text not null,
  requested_action_id uuid not null
    references private.event_moderation_actions(id) on delete restrict,
  status text not null default 'open',
  organizer_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_action_id uuid
    references private.event_moderation_actions(id) on delete restrict,
  constraint moderation_review_requests_revision_check check (
    content_revision >= 1
  ),
  constraint moderation_review_requests_digest_check check (
    input_sha256 ~ '^[a-f0-9]{64}$'
  ),
  constraint moderation_review_requests_status_check check (
    status in ('open', 'resolved', 'withdrawn', 'superseded')
  ),
  constraint moderation_review_requests_note_check check (
    organizer_note is null or char_length(organizer_note) <= 1000
  ),
  constraint moderation_review_requests_resolution_check check (
    (status = 'open' and resolved_at is null and resolved_action_id is null)
    or (
      status <> 'open'
      and resolved_at is not null
      and (status <> 'resolved' or resolved_action_id is not null)
    )
  )
);

create unique index moderation_review_requests_one_open_idx
on private.moderation_review_requests (event_id)
where status = 'open';

alter table private.event_moderation_actions
  add constraint event_moderation_actions_review_request_id_fkey
  foreign key (review_request_id)
  references private.moderation_review_requests(id)
  on delete restrict;

create table private.staff_roles (
  user_id uuid primary key
    references auth.users(id) on delete restrict,
  role text not null,
  active boolean not null default true,
  granted_by uuid not null
    references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_roles_role_check check (role in ('moderator', 'admin'))
);

create table private.event_public_eligibility_intervals (
  event_id uuid not null
    references public.events(id) on delete restrict,
  public_eligibility_version bigint not null,
  eligibility_state text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  started_action_id uuid
    references private.event_moderation_actions(id) on delete restrict,
  ended_action_id uuid
    references private.event_moderation_actions(id) on delete restrict,
  transition_reason text not null,
  constraint event_public_eligibility_intervals_pkey
    primary key (event_id, public_eligibility_version),
  constraint event_public_eligibility_intervals_version_check check (
    public_eligibility_version >= 0
  ),
  constraint event_public_eligibility_intervals_state_check check (
    eligibility_state in ('eligible', 'ineligible')
  ),
  constraint event_public_eligibility_intervals_transition_reason_check check (
    transition_reason in (
      'initialization',
      'publication',
      'published_edit',
      'moderation_hold',
      'moderation_block',
      'moderation_remove',
      'moderation_restore',
      'cancellation',
      'policy_authorization',
      'legacy_migration',
      'legacy_history_resolution'
    )
  ),
  constraint event_public_eligibility_intervals_start_action_check check (
    (public_eligibility_version = 0 and eligibility_state = 'ineligible' and started_action_id is null)
    or (public_eligibility_version > 0 and started_action_id is not null)
  ),
  constraint event_public_eligibility_intervals_end_check check (
    (ended_at is null and ended_action_id is null)
    or (
      ended_at is not null
      and ended_action_id is not null
      and ended_at >= started_at
    )
  )
);

create unique index event_public_eligibility_intervals_one_open_idx
on private.event_public_eligibility_intervals (event_id)
where ended_at is null;

alter table public.events
  add constraint events_publicly_authorized_action_id_fkey
  foreign key (publicly_authorized_action_id)
  references private.event_moderation_actions(id)
  on delete restrict;

create function private.reject_immutable_moderation_record_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = case tg_table_name
      when 'event_moderation_actions' then 'MODERATION_ACTION_IMMUTABLE'
      when 'event_policy_acceptances' then 'POLICY_ACCEPTANCE_IMMUTABLE'
      when 'organizer_policy_versions' then 'POLICY_VERSION_IMMUTABLE'
      when 'event_policy_legacy_exemptions' then 'POLICY_LEGACY_EXEMPTION_IMMUTABLE'
      else 'MODERATION_RECORD_IMMUTABLE'
    end;
end;
$$;

create trigger event_moderation_actions_immutable
before update or delete on private.event_moderation_actions
for each row execute function private.reject_immutable_moderation_record_change();

create trigger event_policy_acceptances_immutable
before update or delete on private.event_policy_acceptances
for each row execute function private.reject_immutable_moderation_record_change();

create trigger organizer_policy_versions_immutable
before update or delete on private.organizer_policy_versions
for each row execute function private.reject_immutable_moderation_record_change();

create trigger event_policy_legacy_exemptions_immutable
before update or delete on private.event_policy_legacy_exemptions
for each row execute function private.reject_immutable_moderation_record_change();

create function private.guard_public_eligibility_interval_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    or old.ended_at is not null
    or new.event_id is distinct from old.event_id
    or new.public_eligibility_version is distinct from old.public_eligibility_version
    or new.eligibility_state is distinct from old.eligibility_state
    or new.started_at is distinct from old.started_at
    or new.started_action_id is distinct from old.started_action_id
    or new.transition_reason is distinct from old.transition_reason
    or new.ended_at is null
    or new.ended_action_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'PUBLIC_ELIGIBILITY_INTERVAL_IMMUTABLE';
  end if;

  return new;
end;
$$;

create trigger event_public_eligibility_intervals_guard
before update or delete on private.event_public_eligibility_intervals
for each row execute function private.guard_public_eligibility_interval_change();

revoke all on function private.reject_immutable_moderation_record_change()
from public, anon, authenticated;
revoke all on function private.guard_public_eligibility_interval_change()
from public, anon, authenticated;

revoke all on table private.event_risk_disclosures
from public, anon, authenticated;
revoke all on table private.event_moderation_evaluations
from public, anon, authenticated;
revoke all on table private.event_moderation_actions
from public, anon, authenticated;
revoke all on table private.event_reports
from public, anon, authenticated;
revoke all on table private.event_report_rate_buckets
from public, anon, authenticated;
revoke all on table private.moderation_review_requests
from public, anon, authenticated;
revoke all on table private.staff_roles
from public, anon, authenticated;
revoke all on table private.event_public_eligibility_intervals
from public, anon, authenticated;
revoke all on table private.organizer_policy_versions
from public, anon, authenticated;
revoke all on table private.organizer_policy_requirements
from public, anon, authenticated;
revoke all on table private.event_policy_acceptances
from public, anon, authenticated;
revoke all on table private.event_policy_legacy_exemptions
from public, anon, authenticated;
