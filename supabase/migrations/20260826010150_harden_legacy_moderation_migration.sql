create function private.reconcile_legacy_moderation_events(p_event_ids uuid[])
returns table (
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
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_ids uuid[];
  v_target_id uuid;
  v_source record;
  v_event public.events%rowtype;
  v_classified record;
  v_current_input_sha256 text;
  v_target_history_status text;
  v_target_first_publicly_eligible_at timestamptz;
  v_target_authorization_action_id uuid;
  v_exemption_id uuid;
  v_exemption_revision bigint;
  v_exemption_input_sha256 text;
  v_evaluation_id uuid;
  v_reconciliation_action_id uuid;
  v_next_moderation_version bigint;
  v_state_changed boolean;
  v_reconciliation_code text;
  v_authorization_state text;
  v_is_old_public_observation boolean;
  v_source_matches_current_input boolean;
begin
  if p_event_ids is null
    or cardinality(p_event_ids) = 0 then
    return;
  end if;

  if array_position(p_event_ids, null) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'LEGACY_RECONCILIATION_EVENT_ID_INVALID';
  end if;

  select array_agg(targets.event_id order by targets.event_id)
  into v_target_ids
  from (
    select distinct requested.event_id
    from unnest(p_event_ids) as requested(event_id)
  ) as targets;

  if cardinality(v_target_ids) <> cardinality(p_event_ids) then
    raise exception using
      errcode = 'P0001',
      message = 'LEGACY_RECONCILIATION_EVENT_ID_DUPLICATE';
  end if;

  if (
    select count(distinct actions.event_id)
    from private.event_moderation_actions as actions
    where actions.event_id = any(v_target_ids)
      and actions.source = 'migration'
      and actions.action = 'hold'
      and actions.actor_type = 'system'
      and actions.actor_user_id is null
      and actions.previous_status = 'under_review'
      and actions.new_status = 'under_review'
      and actions.internal_note ~
        '^legacy_lifecycle_status=(draft|published|cancelled);legacy_moderation_status=(clear|flagged|blocked|removed);evidence_code=(old_public_rls_observation|no_positive_evidence|contradictory_evidence);classification_reason=[a-z_]+$'
  ) <> cardinality(v_target_ids) then
    raise exception using
      errcode = 'P0001',
      message = 'LEGACY_RECONCILIATION_EVIDENCE_MISSING';
  end if;

  for v_target_id in
    select targets.event_id
    from unnest(v_target_ids) as targets(event_id)
    order by targets.event_id
  loop
    perform public.lock_event_ticketing_operation(v_target_id);
  end loop;

  perform tiers.id
  from public.ticket_tiers as tiers
  where tiers.event_id = any(v_target_ids)
  order by tiers.id
  for update;

  perform events.id
  from public.events as events
  where events.id = any(v_target_ids)
  order by events.id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'LEGACY_RECONCILIATION_EVENT_MISSING';
  end if;

  if (
    select count(*)
    from public.events as events
    where events.id = any(v_target_ids)
  ) <> cardinality(v_target_ids) then
    raise exception using
      errcode = 'P0001',
      message = 'LEGACY_RECONCILIATION_EVENT_MISSING';
  end if;

  perform disclosures.event_id
  from private.event_risk_disclosures as disclosures
  where disclosures.event_id = any(v_target_ids)
  order by disclosures.event_id
  for update;

  perform organizers.id
  from public.organizers as organizers
  where organizers.id in (
    select events.organizer_id
    from public.events as events
    where events.id = any(v_target_ids)
  )
  order by organizers.id
  for share;

  perform exemptions.id
  from private.event_policy_legacy_exemptions as exemptions
  where exemptions.event_id = any(v_target_ids)
  order by exemptions.event_id
  for share;

  perform actions.id
  from private.event_moderation_actions as actions
  where actions.event_id = any(v_target_ids)
  order by actions.event_id, actions.created_at, actions.id
  for share;

  if exists (
    select 1
    from (
      select
        requested.event_id,
        count(actions.id) as evidence_count
      from unnest(v_target_ids) as requested(event_id)
      left join private.event_moderation_actions as actions
        on actions.event_id = requested.event_id
        and actions.source = 'migration'
        and actions.action = 'hold'
        and actions.actor_type = 'system'
        and actions.actor_user_id is null
        and actions.previous_status = 'under_review'
        and actions.new_status = 'under_review'
        and actions.internal_note ~
          '^legacy_lifecycle_status=(draft|published|cancelled);legacy_moderation_status=(clear|flagged|blocked|removed);evidence_code=(old_public_rls_observation|no_positive_evidence|contradictory_evidence);classification_reason=[a-z_]+$'
      group by requested.event_id
    ) as evidence
    where evidence.evidence_count <> 1
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LEGACY_RECONCILIATION_EVIDENCE_AMBIGUOUS';
  end if;

  for v_source in
    select
      actions.id,
      actions.event_id,
      actions.content_revision,
      actions.input_sha256,
      actions.created_at,
      parsed.parts[1] as legacy_lifecycle_status,
      parsed.parts[2] as legacy_moderation_status
    from private.event_moderation_actions as actions
    cross join lateral (
      select regexp_match(
        actions.internal_note,
        '^legacy_lifecycle_status=(draft|published|cancelled);legacy_moderation_status=(clear|flagged|blocked|removed);evidence_code=(old_public_rls_observation|no_positive_evidence|contradictory_evidence);classification_reason=([a-z_]+)$'
      ) as parts
    ) as parsed
    where actions.event_id = any(v_target_ids)
      and actions.source = 'migration'
      and actions.action = 'hold'
      and actions.actor_type = 'system'
      and actions.actor_user_id is null
      and actions.previous_status = 'under_review'
      and actions.new_status = 'under_review'
      and parsed.parts is not null
    order by actions.event_id
  loop
    select events.*
    into strict v_event
    from public.events as events
    where events.id = v_source.event_id;

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
    )
    into strict v_current_input_sha256
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
    where events.id = v_source.event_id;

    v_is_old_public_observation :=
      v_source.legacy_lifecycle_status = 'published'
      and v_source.legacy_moderation_status in ('clear', 'flagged');

    select classified.*
    into strict v_classified
    from private.classify_legacy_event_moderation(
      v_source.legacy_lifecycle_status,
      v_source.legacy_moderation_status,
      case
        when v_is_old_public_observation then 'old_public_rls_observation'
        else 'no_positive_evidence'
      end,
      case
        when v_is_old_public_observation then v_source.created_at
        else null
      end
    ) as classified;

    v_source_matches_current_input :=
      v_source.content_revision = v_event.content_revision
      and v_source.input_sha256 = v_current_input_sha256;
    v_target_history_status := v_classified.public_history_status;
    v_target_first_publicly_eligible_at :=
      case
        when v_target_history_status = 'previously_public' then
          least(
            coalesce(v_event.first_publicly_eligible_at, v_source.created_at),
            v_source.created_at
          )
        else null
      end;
    v_target_authorization_action_id := null;
    v_exemption_id := null;
    v_exemption_revision := null;
    v_exemption_input_sha256 := null;
    v_evaluation_id := null;
    v_reconciliation_action_id := null;
    v_reconciliation_code := null;

    select
      exemptions.id,
      exemptions.grandfathered_content_revision,
      exemptions.input_sha256
    into
      v_exemption_id,
      v_exemption_revision,
      v_exemption_input_sha256
    from private.event_policy_legacy_exemptions as exemptions
    where exemptions.event_id = v_event.id;

    if not v_is_old_public_observation then
      v_authorization_state := 'not_qualifying';
      if v_event.publicly_authorized_action_id is not null then
        v_reconciliation_code := 'non_qualifying_unauthorized';
      end if;
    elsif not v_source_matches_current_input
      or (
        v_exemption_id is not null
        and (
          v_exemption_revision <> v_event.content_revision
          or v_exemption_input_sha256 <> v_current_input_sha256
        )
      ) then
      v_authorization_state := 'stale_evidence_unauthorized';
      if v_event.publicly_authorized_action_id is not null then
        v_reconciliation_code := 'stale_evidence_unauthorized';
      end if;
    else
      if v_exemption_id is null then
        v_exemption_id := gen_random_uuid();
        v_exemption_revision := v_event.content_revision;
        v_exemption_input_sha256 := v_current_input_sha256;

        insert into private.event_policy_legacy_exemptions (
          id,
          event_id,
          grandfathered_content_revision,
          input_sha256,
          reason,
          migration_identifier,
          created_at
        )
        values (
          v_exemption_id,
          v_event.id,
          v_event.content_revision,
          v_current_input_sha256,
          'pre_build_2_5_publication',
          '20260826010150_harden_legacy_moderation_migration',
          statement_timestamp()
        );
      end if;

      select authorization_actions.id
      into v_target_authorization_action_id
      from private.event_moderation_actions as authorization_actions
      where authorization_actions.event_id = v_event.id
        and authorization_actions.content_revision = v_event.content_revision
        and authorization_actions.input_sha256 = v_current_input_sha256
        and authorization_actions.actor_type = 'system'
        and authorization_actions.actor_user_id is null
        and authorization_actions.source = 'migration'
        and authorization_actions.action = 'authorize_publication'
        and authorization_actions.policy_acceptance_id is null
        and authorization_actions.policy_legacy_exemption_id = v_exemption_id
      order by
        (authorization_actions.id = v_event.publicly_authorized_action_id) desc,
        authorization_actions.created_at,
        authorization_actions.id
      limit 1;

      v_authorization_state := 'authorized_exact';
    end if;

    v_state_changed :=
      v_event.public_history_status is distinct from v_target_history_status
      or v_event.first_publicly_eligible_at
        is distinct from v_target_first_publicly_eligible_at
      or v_event.publicly_authorized_action_id
        is distinct from v_target_authorization_action_id
      or v_event.publicly_authorized_revision
        is distinct from case
          when v_target_authorization_action_id is null then null
          else v_event.content_revision
        end;

    if v_is_old_public_observation then
      v_next_moderation_version :=
        v_event.moderation_version + case when v_state_changed then 1 else 0 end;

      select evaluations.id
      into v_evaluation_id
      from private.event_moderation_evaluations as evaluations
      where evaluations.event_id = v_event.id
        and evaluations.content_revision = v_event.content_revision
        and evaluations.input_sha256 = v_current_input_sha256
        and evaluations.source = 'contextual'
        and evaluations.queued_moderation_version = v_next_moderation_version;

      if v_evaluation_id is null then
        insert into private.event_moderation_evaluations (
          event_id,
          content_revision,
          input_sha256,
          queued_moderation_version,
          status,
          source,
          created_at
        )
        values (
          v_event.id,
          v_event.content_revision,
          v_current_input_sha256,
          v_next_moderation_version,
          'queued',
          'contextual',
          statement_timestamp()
        )
        returning id into v_evaluation_id;
      end if;
    else
      v_next_moderation_version :=
        v_event.moderation_version + case when v_state_changed then 1 else 0 end;
    end if;

    if v_state_changed then
      v_reconciliation_action_id := gen_random_uuid();
      if v_reconciliation_code is null then
        v_reconciliation_code := case
          when v_event.public_history_status is distinct from v_target_history_status
            then 'old_public_precedence'
          else 'authorization_repaired'
        end;
      end if;

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
      values (
        v_reconciliation_action_id,
        v_event.id,
        v_event.content_revision,
        v_event.content_revision,
        v_current_input_sha256,
        'system',
        null,
        'migration',
        case
          when v_event.public_history_status is distinct from v_target_history_status
            then 'resolve_legacy_history'
          else 'hold'
        end,
        v_event.moderation_status,
        v_event.moderation_status,
        v_event.public_history_status,
        v_target_history_status,
        'other',
        format(
          'source_normalization_action_id=%s;reconciliation=%s',
          v_source.id,
          v_reconciliation_code
        ),
        v_evaluation_id,
        v_next_moderation_version,
        statement_timestamp()
      );
    end if;

    if v_is_old_public_observation
      and v_authorization_state = 'authorized_exact'
      and v_target_authorization_action_id is null then
      v_target_authorization_action_id := gen_random_uuid();

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
      values (
        v_target_authorization_action_id,
        v_event.id,
        v_event.content_revision,
        v_event.content_revision,
        v_current_input_sha256,
        'system',
        null,
        'migration',
        'authorize_publication',
        v_event.moderation_status,
        v_event.moderation_status,
        v_target_history_status,
        v_target_history_status,
        'other',
        'exact unchanged pre-rollout revision authorized by locked forward reconciliation',
        v_exemption_id,
        v_next_moderation_version,
        statement_timestamp()
      );

      v_state_changed := true;
    end if;

    if v_state_changed then
      update public.events as events
      set
        moderation_version = v_next_moderation_version,
        moderation_updated_at = statement_timestamp(),
        public_history_status = v_target_history_status,
        first_publicly_eligible_at = v_target_first_publicly_eligible_at,
        publicly_authorized_revision = case
          when v_target_authorization_action_id is null then null
          else events.content_revision
        end,
        publicly_authorized_action_id = v_target_authorization_action_id
      where events.id = v_event.id;
    end if;

    event_id := v_event.id;
    legacy_lifecycle_status := v_source.legacy_lifecycle_status;
    legacy_moderation_status := v_source.legacy_moderation_status;
    moderation_status := v_event.moderation_status;
    public_history_status := v_target_history_status;
    qualifies_for_legacy_exemption := v_classified.qualifies_for_legacy_exemption;
    authorization_state := v_authorization_state;
    current_input_sha256 := v_current_input_sha256;
    source_action_id := v_source.id;
    reconciliation_action_id := v_reconciliation_action_id;
    return next;
  end loop;
end;
$$;

revoke all on function private.reconcile_legacy_moderation_events(uuid[])
from public, anon, authenticated, service_role;

do $reconcile_applied_legacy_rows$
declare
  v_event_ids uuid[];
begin
  select array_agg(actions.event_id order by actions.event_id)
  into v_event_ids
  from private.event_moderation_actions as actions
  where actions.source = 'migration'
    and actions.action = 'hold'
    and actions.actor_type = 'system'
    and actions.actor_user_id is null
    and actions.previous_status = 'under_review'
    and actions.new_status = 'under_review'
    and actions.internal_note ~
      '^legacy_lifecycle_status=(draft|published|cancelled);legacy_moderation_status=(clear|flagged|blocked|removed);evidence_code=(old_public_rls_observation|no_positive_evidence|contradictory_evidence);classification_reason=[a-z_]+$';

  if cardinality(v_event_ids) > 0 then
    perform *
    from private.reconcile_legacy_moderation_events(v_event_ids);
  end if;
end;
$reconcile_applied_legacy_rows$;
