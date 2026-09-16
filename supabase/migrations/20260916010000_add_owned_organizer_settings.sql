-- Settings edits share the organizer and publication revision authority. The
-- browser cannot supply ownership, hidden profile fields, or onboarding state.
create function public.save_owned_organizer_settings(
  p_display_name text,
  p_bio text,
  p_expected_updated_at timestamptz
)
returns table(display_name text, bio text, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_event_id uuid;
  v_current public.organizers%rowtype;
  v_saved public.organizers%rowtype;
begin
  if v_owner is null or not exists (
    select 1 from public.organizers as o where o.id = v_owner
  ) then
    raise exception using errcode = 'P0001', message = 'ORGANIZER_NOT_FOUND';
  end if;
  if p_display_name is null or char_length(btrim(p_display_name)) not between 2 and 100
    or (p_bio is not null and char_length(p_bio) > 500)
    or p_expected_updated_at is null or not isfinite(p_expected_updated_at) then
    raise exception using errcode = 'P0001', message = 'ORGANIZER_SETTINGS_INVALID';
  end if;

  -- Match save_owned_organizer_profile's event operation -> tier -> event ->
  -- organizer lock order. Taking the organizer first would invert its locks.
  for v_event_id in
    select e.id from public.events as e
    where e.organizer_id = v_owner and e.status <> 'cancelled' order by e.id
  loop
    perform public.lock_event_ticketing_operation(v_event_id);
  end loop;
  perform t.id from public.ticket_tiers as t
    join public.events as e on e.id = t.event_id
    where e.organizer_id = v_owner and e.status <> 'cancelled'
    order by t.event_id, t.id for update of t;
  perform e.id from public.events as e
    where e.organizer_id = v_owner and e.status <> 'cancelled'
    order by e.id for update;
  select o.* into v_current from public.organizers as o
    where o.id = v_owner for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ORGANIZER_NOT_FOUND';
  end if;
  if v_current.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'ORGANIZER_SETTINGS_CONFLICT';
  end if;

  select saved.* into v_saved from public.save_owned_organizer_profile(
    jsonb_build_object(
      'display_name', btrim(p_display_name),
      'bio', nullif(p_bio, ''),
      'organizer_type', v_current.organizer_type,
      'website_url', v_current.website_url,
      'base_city', v_current.base_city,
      'country_code', v_current.country_code,
      'onboarding_completed_at', v_current.onboarding_completed_at
    )
  ) as saved;
  return query select v_saved.display_name, v_saved.bio, v_saved.updated_at;
end;
$$;
revoke all on function public.save_owned_organizer_settings(text,text,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.save_owned_organizer_settings(text,text,timestamptz)
  to authenticated;
