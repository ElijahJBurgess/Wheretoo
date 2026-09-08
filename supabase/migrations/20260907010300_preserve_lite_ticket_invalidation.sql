-- Final refund/review/dispute predicates already preserve used admission history.
-- Whole-order refunds intentionally retain valid/cancelled -> refunded recovery.
create function public.cancel_owned_event(p_event_id uuid)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_event public.events;
begin
  if v_owner_id is null or p_event_id is null then
    raise exception using errcode = '42501', message = 'Event cancellation forbidden';
  end if;

  -- Share the checkout/redemption hierarchy; never acquire order locks after tickets.
  perform public.lock_event_ticketing_operation(p_event_id);
  perform tiers.id from public.ticket_tiers as tiers
    where tiers.event_id = p_event_id order by tiers.id for update;
  select events.* into v_event from public.events as events
    where events.id = p_event_id for update;
  if not found or v_event.organizer_id is distinct from v_owner_id then
    raise exception using errcode = '42501', message = 'Event cancellation forbidden';
  end if;
  if v_event.status = 'cancelled' then
    return v_event;
  end if;
  if v_event.status <> 'published' then
    raise exception using errcode = 'P0001', message = 'Only published events can be cancelled';
  end if;

  update public.events as events set status = 'cancelled'
    where events.id = p_event_id returning events.* into v_event;
  perform tickets.id from public.tickets as tickets
    where tickets.event_id = p_event_id order by tickets.id for update;
  update public.tickets as tickets
    set status = 'cancelled', cancelled_at = statement_timestamp()
    where tickets.event_id = p_event_id and tickets.status = 'valid';
  return v_event;
end;
$$;
revoke all on function public.cancel_owned_event(uuid) from public, anon, authenticated, service_role;
grant execute on function public.cancel_owned_event(uuid) to authenticated;
comment on function public.cancel_owned_event(uuid) is
  'Owner cancellation stops unused admission atomically, preserves used/refunded history, and does not initiate refunds.';
