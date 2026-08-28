create function private.classify_legacy_event_moderation(
  p_lifecycle_status text,
  p_legacy_moderation_status text,
  p_evidence_code text,
  p_prior_public_observed_at timestamptz
)
returns table (
  moderation_status text,
  public_history_status text,
  first_publicly_eligible_at timestamptz,
  qualifies_for_legacy_exemption boolean,
  classification_reason text
)
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
begin
  if p_lifecycle_status is null
    or p_lifecycle_status not in ('draft', 'published', 'cancelled')
    or p_legacy_moderation_status is null
    or p_legacy_moderation_status not in ('clear', 'flagged', 'blocked', 'removed') then
    return query select
      'under_review'::text,
      'unknown'::text,
      null::timestamptz,
      false,
      'quarantined_invalid_or_contradictory_evidence'::text;
    return;
  end if;

  if p_evidence_code = 'old_public_rls_observation'
    and p_lifecycle_status = 'published'
    and p_legacy_moderation_status in ('clear', 'flagged')
    and p_prior_public_observed_at is not null then
    return query select
      'under_review'::text,
      'previously_public'::text,
      p_prior_public_observed_at,
      true,
      'observed_old_public_rls'::text;
    return;
  end if;

  if p_evidence_code = 'server_prior_public'
    and p_prior_public_observed_at is not null then
    return query select
      case
        when p_legacy_moderation_status in ('blocked', 'removed') then 'removed'
        else 'under_review'
      end::text,
      'previously_public'::text,
      p_prior_public_observed_at,
      false,
      'normalized_with_prior_public_evidence'::text;
    return;
  end if;

  if p_evidence_code = 'verified_never_public'
    and p_prior_public_observed_at is null then
    return query select
      case
        when p_legacy_moderation_status in ('blocked', 'removed') then 'blocked'
        else 'under_review'
      end::text,
      'never_public'::text,
      null::timestamptz,
      false,
      'normalized_with_never_public_evidence'::text;
    return;
  end if;

  if p_evidence_code = 'no_positive_evidence'
    and p_prior_public_observed_at is null then
    return query select
      'under_review'::text,
      'unknown'::text,
      null::timestamptz,
      false,
      'quarantined_without_positive_history_evidence'::text;
    return;
  end if;

  return query select
    'under_review'::text,
    'unknown'::text,
    null::timestamptz,
    false,
    'quarantined_invalid_or_contradictory_evidence'::text;
end;
$$;

revoke all on function private.classify_legacy_event_moderation(text,text,text,timestamptz)
from public, anon, authenticated, service_role;

create temporary table legacy_event_moderation_stage
on commit drop
as
with migration_clock as (
  select statement_timestamp() as observed_at
),
tier_inputs as (
  select
    ticket_tiers.event_id,
    jsonb_agg(
      jsonb_build_object(
        'name', ticket_tiers.name,
        'description', ticket_tiers.description
      )
      order by ticket_tiers.id
    ) as public_tiers
  from public.ticket_tiers
  group by ticket_tiers.event_id
),
event_inputs as (
  select
    events.id as event_id,
    events.status as legacy_lifecycle_status,
    events.moderation_status as legacy_moderation_status,
    events.public_history_status as legacy_public_history_status,
    events.content_revision,
    events.moderation_version + 1 as migrated_moderation_version,
    migration_clock.observed_at,
    case
      when events.public_history_status is not null
        or events.first_publicly_eligible_at is not null
        or events.moderated_revision is not null
        or events.publicly_authorized_revision is not null
        or events.publicly_authorized_action_id is not null
        then 'contradictory_evidence'
      when events.status = 'published'
        and events.moderation_status in ('clear', 'flagged')
        then 'old_public_rls_observation'
      else 'no_positive_evidence'
    end as evidence_code,
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
          'ticket_tiers', coalesce(tier_inputs.public_tiers, '[]'::jsonb),
          'organizer_display_name', organizers.display_name
        )::text,
        'sha256'
      ),
      'hex'
    ) as input_sha256,
    gen_random_uuid() as bootstrap_evaluation_id,
    gen_random_uuid() as normalization_action_id,
    gen_random_uuid() as legacy_exemption_id,
    gen_random_uuid() as authorization_action_id
  from public.events as events
  join public.organizers as organizers on organizers.id = events.organizer_id
  cross join migration_clock
  left join private.event_risk_disclosures as disclosures
    on disclosures.event_id = events.id
  left join tier_inputs on tier_inputs.event_id = events.id
)
select
  event_inputs.*,
  classified.moderation_status as classified_moderation_status,
  classified.public_history_status as classified_public_history_status,
  classified.first_publicly_eligible_at,
  classified.qualifies_for_legacy_exemption,
  classified.classification_reason
from event_inputs
cross join lateral private.classify_legacy_event_moderation(
  event_inputs.legacy_lifecycle_status,
  event_inputs.legacy_moderation_status,
  event_inputs.evidence_code,
  case
    when event_inputs.evidence_code = 'old_public_rls_observation'
      then event_inputs.observed_at
    else null
  end
) as classified;

alter table legacy_event_moderation_stage
  add primary key (event_id);

do $$
begin
  if (select count(*) from legacy_event_moderation_stage)
    <> (select count(*) from public.events) then
    raise exception using
      errcode = 'P0001',
      message = 'LEGACY_MODERATION_STAGE_INCOMPLETE';
  end if;

  if exists (
    select 1
    from legacy_event_moderation_stage
    where input_sha256 !~ '^[a-f0-9]{64}$'
      or classified_moderation_status <> 'under_review'
      or classified_public_history_status not in ('unknown', 'previously_public')
      or (
        classified_public_history_status = 'previously_public'
        and first_publicly_eligible_at is null
      )
      or (
        classified_public_history_status = 'unknown'
        and first_publicly_eligible_at is not null
      )
      or qualifies_for_legacy_exemption is distinct from (
        evidence_code = 'old_public_rls_observation'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LEGACY_MODERATION_STAGE_INVALID';
  end if;

  if exists (
    select 1 from public.events where public_eligibility_version <> 0
  ) or exists (
    select 1 from private.event_public_eligibility_intervals
  ) or exists (
    select 1 from private.event_moderation_actions
  ) or exists (
    select 1 from private.event_moderation_evaluations
  ) or exists (
    select 1 from private.event_policy_legacy_exemptions
  ) or exists (
    select 1 from private.event_policy_acceptances
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LEGACY_MODERATION_FOUNDATION_NOT_PRISTINE';
  end if;
end;
$$;

insert into private.event_moderation_evaluations (
  id,
  event_id,
  content_revision,
  input_sha256,
  queued_moderation_version,
  status,
  source,
  created_at
)
select
  bootstrap_evaluation_id,
  event_id,
  content_revision,
  input_sha256,
  migrated_moderation_version,
  'queued',
  'contextual',
  observed_at
from legacy_event_moderation_stage
where qualifies_for_legacy_exemption;

insert into private.event_moderation_actions (
  id,
  event_id,
  previous_content_revision,
  content_revision,
  input_sha256,
  actor_type,
  actor_user_id,
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
  normalization_action_id,
  event_id,
  null,
  content_revision,
  input_sha256,
  'system',
  null,
  'migration',
  'hold',
  classified_moderation_status,
  classified_moderation_status,
  legacy_public_history_status,
  classified_public_history_status,
  'other',
  format(
    'legacy_lifecycle_status=%s;legacy_moderation_status=%s;evidence_code=%s;classification_reason=%s',
    legacy_lifecycle_status,
    legacy_moderation_status,
    evidence_code,
    classification_reason
  ),
  case
    when qualifies_for_legacy_exemption then bootstrap_evaluation_id
    else null
  end,
  migrated_moderation_version,
  observed_at
from legacy_event_moderation_stage;

insert into private.event_policy_legacy_exemptions (
  id,
  event_id,
  grandfathered_content_revision,
  input_sha256,
  reason,
  migration_identifier,
  created_at
)
select
  legacy_exemption_id,
  event_id,
  content_revision,
  input_sha256,
  'pre_build_2_5_publication',
  '20260826010100_migrate_legacy_moderation',
  observed_at
from legacy_event_moderation_stage
where qualifies_for_legacy_exemption;

insert into private.event_moderation_actions (
  id,
  event_id,
  previous_content_revision,
  content_revision,
  input_sha256,
  actor_type,
  actor_user_id,
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
  authorization_action_id,
  event_id,
  null,
  content_revision,
  input_sha256,
  'system',
  null,
  'migration',
  'authorize_publication',
  classified_moderation_status,
  classified_moderation_status,
  classified_public_history_status,
  classified_public_history_status,
  'other',
  'exact unchanged pre-rollout revision authorized by migration-only legacy exemption',
  legacy_exemption_id,
  migrated_moderation_version,
  observed_at
from legacy_event_moderation_stage
where qualifies_for_legacy_exemption;

update public.events as events
set
  moderation_status = staged.classified_moderation_status,
  moderated_revision = null,
  moderation_version = staged.migrated_moderation_version,
  moderation_updated_at = staged.observed_at,
  public_history_status = staged.classified_public_history_status,
  first_publicly_eligible_at = staged.first_publicly_eligible_at,
  public_eligibility_version = 0,
  publicly_authorized_revision = case
    when staged.qualifies_for_legacy_exemption then staged.content_revision
    else null
  end,
  publicly_authorized_action_id = case
    when staged.qualifies_for_legacy_exemption then staged.authorization_action_id
    else null
  end
from legacy_event_moderation_stage as staged
where events.id = staged.event_id;

insert into private.event_public_eligibility_intervals (
  event_id,
  public_eligibility_version,
  eligibility_state,
  started_at,
  ended_at,
  started_action_id,
  ended_action_id,
  transition_reason
)
select
  event_id,
  0,
  'ineligible',
  observed_at,
  null,
  null,
  null,
  'legacy_migration'
from legacy_event_moderation_stage;

alter table public.events
  drop constraint events_moderation_status_check,
  add constraint events_moderation_status_check check (
    moderation_status in (
      'not_evaluated',
      'clear',
      'under_review',
      'blocked',
      'removed'
    )
  ),
  alter column moderation_status set default 'not_evaluated',
  alter column public_history_status set default 'never_public',
  alter column public_history_status set not null;

create function private.initialize_event_public_eligibility_interval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.event_public_eligibility_intervals (
    event_id,
    public_eligibility_version,
    eligibility_state,
    started_at,
    started_action_id,
    transition_reason
  )
  values (
    new.id,
    0,
    'ineligible',
    statement_timestamp(),
    null,
    'initialization'
  );

  return new;
end;
$$;

create trigger events_initialize_public_eligibility_interval
after insert on public.events
for each row execute function private.initialize_event_public_eligibility_interval();

revoke all on function private.initialize_event_public_eligibility_interval()
from public, anon, authenticated, service_role;
