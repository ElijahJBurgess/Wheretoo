create or replace function public.save_ticket_tiers(
  p_event_id uuid,
  p_tiers jsonb
)
returns setof public.ticket_tiers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  perform events.id
  from public.events as events
  where events.id = p_event_id
    and events.organizer_id = auth.uid();

  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

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

  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  if v_event.status = 'published'
    and v_event.admission_type = 'free'
    and (
      v_event.starts_at is null
      or v_event.starts_at <= pg_catalog.clock_timestamp()
    ) then
    raise exception using errcode = 'P0001', message = 'EVENT_TIME_INVALID';
  end if;

  return query
  select tiers.*
  from public.save_ticket_tiers_without_active_free_guard(
    p_event_id,
    p_tiers
  ) as tiers;
end;
$$;

revoke all on function public.save_ticket_tiers(uuid, jsonb)
from public, anon, authenticated, service_role;

grant execute on function public.save_ticket_tiers(uuid, jsonb)
to authenticated;
