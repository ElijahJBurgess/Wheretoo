create function private.invalidate_event_public_revision(
  p_event_id uuid,
  p_change_kind text,
  p_actor_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_previous_revision bigint;
  v_previous_status text;
  v_next_revision bigint;
  v_next_moderation_version bigint;
  v_next_status text;
  v_next_moderated_revision bigint;
  v_action_name text;
  v_reason_code text;
  v_input_sha256 text;
  v_evaluation_id uuid;
  v_action_id uuid;
  v_now timestamptz := pg_catalog.statement_timestamp();
begin
  if p_change_kind not in ('full_review', 'deterministic_only')
    or p_actor_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'EVENT_REVISION_INVALID';
  end if;

  perform public.lock_event_ticketing_operation(p_event_id);

  select events.*
  into v_event
  from public.events as events
  where events.id = p_event_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  if v_event.organizer_id <> p_actor_user_id then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  v_previous_revision := v_event.content_revision;
  v_previous_status := v_event.moderation_status;
  v_next_revision := v_previous_revision + 1;
  v_next_moderation_version := v_event.moderation_version + 1;

  if p_change_kind = 'deterministic_only'
    and v_previous_status = 'clear' then
    v_next_status := 'clear';
    v_next_moderated_revision := v_next_revision;
    v_action_name := 'clear';
    v_reason_code := 'no_violation';
  elsif v_previous_status in ('not_evaluated', 'clear') then
    v_next_status := 'under_review';
    v_next_moderated_revision := null;
    v_action_name := 'hold';
    v_reason_code := 'other';
  else
    v_next_status := v_previous_status;
    v_next_moderated_revision := v_event.moderated_revision;
    v_action_name := 'record_revision';
    v_reason_code := 'other';
  end if;

  update private.event_moderation_evaluations as evaluations
  set status = 'superseded',
      started_at = coalesce(evaluations.started_at, v_now),
      finished_at = v_now,
      failure_code = coalesce(evaluations.failure_code, 'CONTENT_REVISION_CHANGED')
  where evaluations.event_id = p_event_id
    and evaluations.status in ('queued', 'processing');

  update private.event_reports as reports
  set status = 'superseded',
      resolved_at = v_now
  where reports.event_id = p_event_id
    and reports.status = 'open';

  update private.moderation_review_requests as requests
  set status = 'superseded',
      resolved_at = v_now
  where requests.event_id = p_event_id
    and requests.status = 'open';

  update public.events as events
  set content_revision = v_next_revision,
      moderation_version = v_next_moderation_version,
      moderation_status = v_next_status,
      moderated_revision = v_next_moderated_revision,
      moderation_updated_at = v_now,
      publicly_authorized_revision = null,
      publicly_authorized_action_id = null
  where events.id = p_event_id
    and events.content_revision = v_previous_revision
    and events.moderation_version = v_event.moderation_version;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'EVENT_REVISION_CONFLICT';
  end if;

  v_input_sha256 := private.compute_event_input_sha256(p_event_id);

  if v_action_name = 'clear' then
    insert into private.event_moderation_evaluations (
      event_id,
      content_revision,
      input_sha256,
      queued_moderation_version,
      status,
      source,
      outcome,
      risk_level,
      reason_codes,
      attempt_count,
      created_at,
      started_at,
      finished_at
    )
    values (
      p_event_id,
      v_next_revision,
      v_input_sha256,
      v_next_moderation_version,
      'succeeded',
      'deterministic',
      'clear_candidate',
      'low',
      array['no_violation']::text[],
      1,
      v_now,
      v_now,
      v_now
    )
    returning id into v_evaluation_id;
  elsif p_change_kind = 'full_review' then
    insert into private.event_moderation_evaluations (
      event_id,
      content_revision,
      input_sha256,
      queued_moderation_version,
      status,
      source,
      reason_codes,
      attempt_count,
      created_at
    )
    values (
      p_event_id,
      v_next_revision,
      v_input_sha256,
      v_next_moderation_version,
      'queued',
      'contextual',
      array[]::text[],
      0,
      v_now
    )
    returning id into v_evaluation_id;
  end if;

  insert into private.event_moderation_actions (
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
    evaluation_id,
    moderation_version,
    created_at
  )
  values (
    p_event_id,
    v_previous_revision,
    v_next_revision,
    v_input_sha256,
    'organizer',
    p_actor_user_id,
    'edit',
    v_action_name,
    v_previous_status,
    v_next_status,
    v_event.public_history_status,
    v_event.public_history_status,
    v_reason_code,
    v_evaluation_id,
    v_next_moderation_version,
    v_now
  )
  returning id into v_action_id;

  perform private.transition_event_public_eligibility(
    p_event_id,
    false,
    v_action_id
  );

  return true;
end;
$$;

create function public.save_owned_event_revision(
  p_event_id uuid,
  p_event jsonb
)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_saved_event public.events%rowtype;
  v_title text;
  v_description text;
  v_category text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_timezone text;
  v_venue_name text;
  v_address_line1 text;
  v_address_line2 text;
  v_city text;
  v_region text;
  v_postal_code text;
  v_country_code text;
  v_mapbox_feature_id text;
  v_latitude double precision;
  v_longitude double precision;
  v_admission_type text;
  v_capacity integer;
  v_full_review_changed boolean;
  v_deterministic_changed boolean;
begin
  if auth.uid() is null
    or not exists (
      select 1
      from public.events as events
      where events.id = p_event_id
        and events.organizer_id = auth.uid()
    ) then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  if pg_catalog.jsonb_typeof(p_event) is distinct from 'object'
    or not (p_event ?& array[
      'title', 'description', 'category', 'starts_at', 'ends_at', 'timezone',
      'venue_name', 'address_line1', 'address_line2', 'city', 'region',
      'postal_code', 'country_code', 'mapbox_feature_id', 'latitude',
      'longitude', 'admission_type', 'capacity'
    ]::text[])
    or exists (
      select 1
      from pg_catalog.jsonb_object_keys(p_event) as supplied(key)
      where supplied.key <> all (array[
        'title', 'description', 'category', 'starts_at', 'ends_at', 'timezone',
        'venue_name', 'address_line1', 'address_line2', 'city', 'region',
        'postal_code', 'country_code', 'mapbox_feature_id', 'latitude',
        'longitude', 'admission_type', 'capacity'
      ]::text[])
    ) then
    raise exception using errcode = 'P0001', message = 'EVENT_REVISION_INVALID';
  end if;

  begin
    select parsed.*
    into
      v_title,
      v_description,
      v_category,
      v_starts_at,
      v_ends_at,
      v_timezone,
      v_venue_name,
      v_address_line1,
      v_address_line2,
      v_city,
      v_region,
      v_postal_code,
      v_country_code,
      v_mapbox_feature_id,
      v_latitude,
      v_longitude,
      v_admission_type,
      v_capacity
    from pg_catalog.jsonb_to_record(p_event) as parsed(
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
      admission_type text,
      capacity integer
    );
  exception when others then
    raise exception using errcode = 'P0001', message = 'EVENT_REVISION_INVALID';
  end;

  perform public.lock_event_ticketing_operation(p_event_id);

  perform tiers.id
  from public.ticket_tiers as tiers
  where tiers.event_id = p_event_id
  order by tiers.id
  for update;

  select events.*
  into v_event
  from public.events as events
  where events.id = p_event_id
    and events.organizer_id = auth.uid()
  for update;

  if not found or v_event.organizer_id <> auth.uid() then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  if v_event.status not in ('draft', 'published') then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_EDITABLE';
  end if;

  v_full_review_changed :=
    v_event.title is distinct from v_title
    or v_event.description is distinct from v_description
    or v_event.category is distinct from v_category
    or v_event.venue_name is distinct from v_venue_name;

  v_deterministic_changed :=
    v_event.starts_at is distinct from v_starts_at
    or v_event.ends_at is distinct from v_ends_at
    or v_event.timezone is distinct from v_timezone
    or v_event.address_line1 is distinct from v_address_line1
    or v_event.address_line2 is distinct from v_address_line2
    or v_event.city is distinct from v_city
    or v_event.region is distinct from v_region
    or v_event.postal_code is distinct from v_postal_code
    or v_event.country_code is distinct from v_country_code
    or v_event.mapbox_feature_id is distinct from v_mapbox_feature_id
    or v_event.latitude is distinct from v_latitude
    or v_event.longitude is distinct from v_longitude
    or v_event.admission_type is distinct from v_admission_type;

  begin
    update public.events as events
    set title = v_title,
        description = v_description,
        category = v_category,
        starts_at = v_starts_at,
        ends_at = v_ends_at,
        timezone = v_timezone,
        venue_name = v_venue_name,
        address_line1 = v_address_line1,
        address_line2 = v_address_line2,
        city = v_city,
        region = v_region,
        postal_code = v_postal_code,
        country_code = v_country_code,
        mapbox_feature_id = v_mapbox_feature_id,
        latitude = v_latitude,
        longitude = v_longitude,
        admission_type = v_admission_type,
        capacity = v_capacity
    where events.id = p_event_id;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'P0001', message = 'EVENT_REVISION_INVALID';
  end;

  if v_full_review_changed then
    perform private.invalidate_event_public_revision(
      p_event_id,
      'full_review',
      auth.uid()
    );
  elsif v_deterministic_changed then
    perform private.invalidate_event_public_revision(
      p_event_id,
      'deterministic_only',
      auth.uid()
    );
  end if;

  select events.*
  into strict v_saved_event
  from public.events as events
  where events.id = p_event_id;

  return v_saved_event;
end;
$$;

create function public.save_owned_event_requirements(
  p_event_id uuid,
  p_requirements jsonb
)
returns table (
  minimum_age text,
  alcohol_present boolean,
  cannabis_present boolean,
  explicit_adult_content boolean,
  gambling_present boolean,
  weapons_present boolean,
  high_risk_activity boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_existing private.event_risk_disclosures%rowtype;
  v_minimum_age text;
  v_alcohol_present boolean;
  v_cannabis_present boolean;
  v_explicit_adult_content boolean;
  v_gambling_present boolean;
  v_weapons_present boolean;
  v_high_risk_activity boolean;
  v_changed boolean;
begin
  if auth.uid() is null
    or not exists (
      select 1 from public.events as events
      where events.id = p_event_id and events.organizer_id = auth.uid()
    ) then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  if pg_catalog.jsonb_typeof(p_requirements) is distinct from 'object'
    or not (p_requirements ?& array[
      'minimum_age', 'alcohol_present', 'cannabis_present',
      'explicit_adult_content', 'gambling_present', 'weapons_present',
      'high_risk_activity'
    ]::text[])
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_requirements) as supplied(key)
      where supplied.key <> all (array[
        'minimum_age', 'alcohol_present', 'cannabis_present',
        'explicit_adult_content', 'gambling_present', 'weapons_present',
        'high_risk_activity'
      ]::text[])
    )
    or pg_catalog.jsonb_typeof(p_requirements -> 'minimum_age') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_requirements -> 'alcohol_present') is distinct from 'boolean'
    or pg_catalog.jsonb_typeof(p_requirements -> 'cannabis_present') is distinct from 'boolean'
    or pg_catalog.jsonb_typeof(p_requirements -> 'explicit_adult_content') is distinct from 'boolean'
    or pg_catalog.jsonb_typeof(p_requirements -> 'gambling_present') is distinct from 'boolean'
    or pg_catalog.jsonb_typeof(p_requirements -> 'weapons_present') is distinct from 'boolean'
    or pg_catalog.jsonb_typeof(p_requirements -> 'high_risk_activity') is distinct from 'boolean' then
    raise exception using errcode = 'P0001', message = 'EVENT_REQUIREMENTS_INVALID';
  end if;

  v_minimum_age := p_requirements ->> 'minimum_age';
  v_alcohol_present := (p_requirements ->> 'alcohol_present')::boolean;
  v_cannabis_present := (p_requirements ->> 'cannabis_present')::boolean;
  v_explicit_adult_content := (p_requirements ->> 'explicit_adult_content')::boolean;
  v_gambling_present := (p_requirements ->> 'gambling_present')::boolean;
  v_weapons_present := (p_requirements ->> 'weapons_present')::boolean;
  v_high_risk_activity := (p_requirements ->> 'high_risk_activity')::boolean;

  if v_minimum_age not in ('all_ages', '18_plus', '21_plus') then
    raise exception using errcode = 'P0001', message = 'EVENT_REQUIREMENTS_INVALID';
  end if;

  perform public.lock_event_ticketing_operation(p_event_id);
  perform tiers.id from public.ticket_tiers as tiers
  where tiers.event_id = p_event_id order by tiers.id for update;

  select events.* into v_event
  from public.events as events
  where events.id = p_event_id and events.organizer_id = auth.uid()
  for update;

  if not found or v_event.organizer_id <> auth.uid() then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  if v_event.status not in ('draft', 'published') then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_EDITABLE';
  end if;

  select disclosures.* into v_existing
  from private.event_risk_disclosures as disclosures
  where disclosures.event_id = p_event_id
  for update;

  v_changed := not found
    or v_existing.minimum_age is distinct from v_minimum_age
    or v_existing.alcohol_present is distinct from v_alcohol_present
    or v_existing.cannabis_present is distinct from v_cannabis_present
    or v_existing.explicit_adult_content is distinct from v_explicit_adult_content
    or v_existing.gambling_present is distinct from v_gambling_present
    or v_existing.weapons_present is distinct from v_weapons_present
    or v_existing.high_risk_activity is distinct from v_high_risk_activity;

  insert into private.event_risk_disclosures (
    event_id, minimum_age, alcohol_present, cannabis_present,
    explicit_adult_content, gambling_present, weapons_present,
    high_risk_activity
  )
  values (
    p_event_id, v_minimum_age, v_alcohol_present, v_cannabis_present,
    v_explicit_adult_content, v_gambling_present, v_weapons_present,
    v_high_risk_activity
  )
  on conflict (event_id) do update
  set minimum_age = excluded.minimum_age,
      alcohol_present = excluded.alcohol_present,
      cannabis_present = excluded.cannabis_present,
      explicit_adult_content = excluded.explicit_adult_content,
      gambling_present = excluded.gambling_present,
      weapons_present = excluded.weapons_present,
      high_risk_activity = excluded.high_risk_activity,
      updated_at = pg_catalog.statement_timestamp();

  if v_changed then
    perform private.invalidate_event_public_revision(
      p_event_id,
      'full_review',
      auth.uid()
    );
  end if;

  return query values (
    v_minimum_age,
    v_alcohol_present,
    v_cannabis_present,
    v_explicit_adult_content,
    v_gambling_present,
    v_weapons_present,
    v_high_risk_activity
  );
end;
$$;

alter function public.save_ticket_tiers(uuid, jsonb)
  rename to save_ticket_tiers_without_revision;

create function public.save_ticket_tiers(p_event_id uuid, p_tiers jsonb)
returns setof public.ticket_tiers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before_public_text jsonb;
  v_after_public_text jsonb;
begin
  if auth.uid() is null
    or not exists (
      select 1 from public.events as events
      where events.id = p_event_id and events.organizer_id = auth.uid()
    ) then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  perform public.lock_event_ticketing_operation(p_event_id);
  perform tiers.id from public.ticket_tiers as tiers
  where tiers.event_id = p_event_id order by tiers.id for update;
  perform events.id from public.events as events
  where events.id = p_event_id and events.organizer_id = auth.uid()
  for update;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('name', tiers.name, 'description', tiers.description)
      order by tiers.id
    ),
    '[]'::jsonb
  )
  into v_before_public_text
  from public.ticket_tiers as tiers
  where tiers.event_id = p_event_id and tiers.status <> 'archived';

  return query
  select *
  from public.save_ticket_tiers_without_revision(p_event_id, p_tiers);

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('name', tiers.name, 'description', tiers.description)
      order by tiers.id
    ),
    '[]'::jsonb
  )
  into v_after_public_text
  from public.ticket_tiers as tiers
  where tiers.event_id = p_event_id and tiers.status <> 'archived';

  if v_before_public_text is distinct from v_after_public_text then
    perform private.invalidate_event_public_revision(
      p_event_id,
      'full_review',
      auth.uid()
    );
  end if;
end;
$$;

create function public.save_owned_organizer_profile(p_profile jsonb)
returns public.organizers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_organizer public.organizers%rowtype;
  v_saved_organizer public.organizers%rowtype;
  v_event_id uuid;
  v_display_name text;
  v_organizer_type text;
  v_bio text;
  v_website_url text;
  v_base_city text;
  v_country_code text;
  v_onboarding_completed_at timestamptz;
  v_display_name_changed boolean;
begin
  if v_actor_user_id is null
    or not exists (
      select 1 from public.organizers as organizers
      where organizers.id = v_actor_user_id
    ) then
    raise exception using errcode = 'P0001', message = 'ORGANIZER_NOT_FOUND';
  end if;

  if pg_catalog.jsonb_typeof(p_profile) is distinct from 'object'
    or not (p_profile ?& array[
      'display_name', 'organizer_type', 'bio', 'website_url', 'base_city',
      'country_code', 'onboarding_completed_at'
    ]::text[])
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_profile) as supplied(key)
      where supplied.key <> all (array[
        'display_name', 'organizer_type', 'bio', 'website_url', 'base_city',
        'country_code', 'onboarding_completed_at'
      ]::text[])
    ) then
    raise exception using errcode = 'P0001', message = 'ORGANIZER_PROFILE_INVALID';
  end if;

  begin
    select parsed.*
    into v_display_name, v_organizer_type, v_bio, v_website_url,
         v_base_city, v_country_code, v_onboarding_completed_at
    from pg_catalog.jsonb_to_record(p_profile) as parsed(
      display_name text,
      organizer_type text,
      bio text,
      website_url text,
      base_city text,
      country_code text,
      onboarding_completed_at timestamptz
    );
  exception when others then
    raise exception using errcode = 'P0001', message = 'ORGANIZER_PROFILE_INVALID';
  end;

  for v_event_id in
    select events.id
    from public.events as events
    where events.organizer_id = v_actor_user_id
      and events.status <> 'cancelled'
    order by events.id
  loop
    perform public.lock_event_ticketing_operation(v_event_id);
  end loop;

  perform tiers.id
  from public.ticket_tiers as tiers
  join public.events as events on events.id = tiers.event_id
  where events.organizer_id = v_actor_user_id
    and events.status <> 'cancelled'
  order by tiers.event_id, tiers.id
  for update of tiers;

  perform events.id
  from public.events as events
  where events.organizer_id = v_actor_user_id
    and events.status <> 'cancelled'
  order by events.id
  for update;

  select organizers.* into v_organizer
  from public.organizers as organizers
  where organizers.id = v_actor_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ORGANIZER_NOT_FOUND';
  end if;

  v_display_name_changed := v_organizer.display_name is distinct from v_display_name;

  begin
    update public.organizers as organizers
    set display_name = v_display_name,
        organizer_type = v_organizer_type,
        bio = v_bio,
        website_url = v_website_url,
        base_city = v_base_city,
        country_code = v_country_code,
        onboarding_completed_at = v_onboarding_completed_at
    where organizers.id = v_actor_user_id
    returning organizers.* into v_saved_organizer;
  exception when check_violation or invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'ORGANIZER_PROFILE_INVALID';
  end;

  if v_display_name_changed then
    for v_event_id in
      select events.id
      from public.events as events
      where events.organizer_id = v_actor_user_id
        and events.status <> 'cancelled'
      order by events.id
    loop
      perform private.invalidate_event_public_revision(
        v_event_id,
        'full_review',
        v_actor_user_id
      );
    end loop;
  end if;

  return v_saved_organizer;
end;
$$;

create function private.require_organizer_profile_revision_boundary()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.display_name is distinct from new.display_name
    and current_user in ('anon', 'authenticated')
    and exists (
      select 1
      from public.events as events
      where events.organizer_id = old.id
        and events.status <> 'cancelled'
    ) then
    raise exception using
      errcode = 'P0001',
      message = 'ORGANIZER_PROFILE_RPC_REQUIRED';
  end if;

  return new;
end;
$$;

create trigger organizers_require_revision_boundary
before update of display_name on public.organizers
for each row execute function private.require_organizer_profile_revision_boundary();

revoke all on function private.invalidate_event_public_revision(uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.require_organizer_profile_revision_boundary()
  from public, anon, authenticated, service_role;
revoke all on function public.save_ticket_tiers_without_revision(uuid, jsonb)
  from public, anon, authenticated, service_role;

revoke all on function public.save_owned_event_revision(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.save_owned_event_requirements(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.save_owned_organizer_profile(jsonb)
  from public, anon, authenticated;
revoke all on function public.save_ticket_tiers(uuid, jsonb)
  from public, anon, authenticated;

grant execute on function public.save_owned_event_revision(uuid, jsonb)
  to authenticated;
grant execute on function public.save_owned_event_requirements(uuid, jsonb)
  to authenticated;
grant execute on function public.save_owned_organizer_profile(jsonb)
  to authenticated;
grant execute on function public.save_ticket_tiers(uuid, jsonb)
  to authenticated;
