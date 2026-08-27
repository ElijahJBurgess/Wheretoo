-- Restore the staff case privacy boundary by omitting internal action notes.

create or replace function public.get_moderation_case(p_event_id uuid)
returns table (
  event_id uuid,
  organizer_id uuid,
  moderation_status text,
  content_revision bigint,
  input_sha256 text,
  moderation_version bigint,
  public_history_status text,
  first_publicly_eligible_at timestamptz,
  current_open_review_request boolean,
  current_report_count bigint,
  title text,
  description text,
  category text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  venue_name text,
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country_code text,
  mapbox_feature_id text,
  latitude double precision,
  longitude double precision,
  disclosures jsonb,
  legacy_resolution jsonb,
  actions jsonb,
  evaluations jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_active_staff_role(false);
  if p_event_id is null then
    raise exception using errcode = '22023', message = 'EVENT_ID_INVALID';
  end if;

  return query
  select
    events.id,
    events.organizer_id,
    events.moderation_status,
    events.content_revision,
    digest.input_sha256,
    events.moderation_version,
    events.public_history_status,
    events.first_publicly_eligible_at,
    coalesce(review_signal.is_open, false),
    coalesce(report_signal.report_count, 0::bigint),
    events.title,
    events.description,
    events.category,
    events.starts_at,
    events.ends_at,
    events.timezone,
    events.venue_name,
    events.address_line1,
    events.address_line2,
    events.city,
    events.region,
    events.postal_code,
    events.country_code,
    events.mapbox_feature_id,
    events.latitude,
    events.longitude,
    jsonb_build_object(
      'minimum_age', disclosures.minimum_age,
      'alcohol_present', disclosures.alcohol_present,
      'cannabis_present', disclosures.cannabis_present,
      'explicit_adult_content', disclosures.explicit_adult_content,
      'gambling_present', disclosures.gambling_present,
      'weapons_present', disclosures.weapons_present,
      'high_risk_activity', disclosures.high_risk_activity
    ),
    coalesce(resolution.resolution, '{}'::jsonb),
    coalesce(action_history.actions, '[]'::jsonb),
    coalesce(evaluation_history.evaluations, '[]'::jsonb)
  from public.events as events
  cross join lateral (
    select private.compute_event_input_sha256(events.id) as input_sha256
  ) as digest
  left join private.event_risk_disclosures as disclosures
    on disclosures.event_id = events.id
  left join lateral (
    select true as is_open
    from private.moderation_review_requests as requests
    where requests.event_id = events.id
      and requests.content_revision = events.content_revision
      and requests.input_sha256 = digest.input_sha256
      and requests.status = 'open'
    limit 1
  ) as review_signal on true
  left join lateral (
    select count(reports.id)::bigint as report_count
    from private.event_reports as reports
    where reports.event_id = events.id
      and reports.content_revision = events.content_revision
      and reports.input_sha256 = digest.input_sha256
      and reports.status = 'open'
  ) as report_signal on true
  left join lateral (
    select jsonb_build_object(
      'resolved_public_history_status', resolutions.resolved_public_history_status,
      'evidence_code', resolutions.evidence_code,
      'observed_public_at', resolutions.observed_public_at,
      'created_at', resolutions.created_at
    ) as resolution
    from private.event_legacy_history_resolutions as resolutions
    where resolutions.event_id = events.id
  ) as resolution on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', action_rows.id,
      'action', action_rows.action,
      'previous_status', action_rows.previous_status,
      'new_status', action_rows.new_status,
      'reason_code', action_rows.reason_code,
      'created_at', action_rows.created_at,
      'moderation_version', action_rows.moderation_version
    ) order by action_rows.created_at desc, action_rows.id desc) as actions
    from (
      select *
      from private.event_moderation_actions
      where event_moderation_actions.event_id = events.id
      order by event_moderation_actions.created_at desc,
        event_moderation_actions.id desc
      limit 50
    ) as action_rows
  ) as action_history on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', evaluation_rows.id,
      'content_revision', evaluation_rows.content_revision,
      'status', evaluation_rows.status,
      'source', evaluation_rows.source,
      'outcome', evaluation_rows.outcome,
      'risk_level', evaluation_rows.risk_level,
      'reason_codes', evaluation_rows.reason_codes,
      'failure_code', evaluation_rows.failure_code,
      'created_at', evaluation_rows.created_at,
      'finished_at', evaluation_rows.finished_at
    ) order by evaluation_rows.created_at desc, evaluation_rows.id desc) as evaluations
    from (
      select *
      from private.event_moderation_evaluations
      where event_moderation_evaluations.event_id = events.id
      order by event_moderation_evaluations.created_at desc,
        event_moderation_evaluations.id desc
      limit 50
    ) as evaluation_rows
  ) as evaluation_history on true
  where events.id = p_event_id;
end;
$$;

revoke all on function public.get_moderation_case(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_moderation_case(uuid)
to authenticated;
