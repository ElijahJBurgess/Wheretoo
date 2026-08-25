create or replace function public.activate_paid_sales(p_event_id uuid)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
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

  perform events.id
  from public.events as events
  where events.id = p_event_id
    and events.organizer_id = auth.uid()
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  return public.activate_paid_sales_locked(p_event_id, false);
end;
$$;

revoke all on function public.activate_paid_sales(uuid) from public, anon, authenticated;
grant execute on function public.activate_paid_sales(uuid) to authenticated;
