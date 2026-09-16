-- Cancellation is already committed separately. This read never dispatches a refund or email.
create function public.get_owned_event_cancellation_summary(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e public.events; paid jsonb; registrations jsonb; tickets jsonb; coherent boolean;
begin
 select * into e from public.events where id=p_event_id and organizer_id=auth.uid();
 if auth.uid() is null or not found then raise exception using errcode='42501',message='Event unavailable';end if;
 coherent:=not exists(select 1 from public.orders o where (o.event_id=e.id
   or exists(select 1 from public.order_items i join public.ticket_tiers t on t.id=i.ticket_tier_id where i.order_id=o.id and t.event_id=e.id)
   or exists(select 1 from public.tickets t where t.order_id=o.id and t.event_id=e.id))
   and not private.organizer_order_coherent(o.id))
  and not exists(select 1 from public.free_registrations r where r.event_id=e.id and not private.free_registration_is_coherent(r.id));
 if coherent then
  select jsonb_build_object('issued',count(*),'cancelledUnused',count(*) filter(where status='cancelled'),
   'used',count(*) filter(where status='used' and used_at is not null),'refunded',count(*) filter(where status='refunded'),
   'other',count(*) filter(where status not in ('cancelled','used','refunded')))
  into tickets from public.tickets where event_id=e.id;
  if e.admission_type='paid' then
   with states as (
    select o.*,case
     when o.paid_at is null then 'unpaid'
     when private.order_refund_state(o)='completed' then case when private.refund_detail(o.id) is not null then 'completed' else 'review' end
     when exists(select 1 from public.refunds r where r.order_id=o.id and r.status='requires_action') then 'action_required'
     else private.order_refund_state(o) end financial_state
    from public.orders o where o.event_id=e.id
   ) select jsonb_build_object('currency','usd','receivedOrders',count(*) filter(where paid_at is not null),
    'unpaidAttempts',count(*) filter(where paid_at is null),
    'completedOrders',count(*) filter(where financial_state='completed'),
    'notConfirmedRefundedOrders',count(*) filter(where paid_at is not null and financial_state<>'completed'),
    'eligibleOrders',count(*) filter(where financial_state='eligible'),
    'eligibleAmountMinor',coalesce(sum(total_minor) filter(where financial_state='eligible'),0),
    'processingOrders',count(*) filter(where financial_state in ('submitting','processing')),
    'actionRequiredOrders',count(*) filter(where financial_state='action_required'),
    'unknownOrders',count(*) filter(where financial_state='unknown'),
    'failedOrders',count(*) filter(where financial_state='failed'),
    'reviewOrders',count(*) filter(where paid_at is not null and financial_state in ('review','ineligible')))
   into paid from states;
  else
   select jsonb_build_object('registrations',count(*),'admissions',coalesce(sum(quantity),0),
    'cancelledRegistrations',count(*) filter(where status='cancelled')) into registrations
   from public.free_registrations where event_id=e.id;
  end if;
 end if;
 return jsonb_build_object('eventId',e.id,'eventStatus',e.status,'admissionType',e.admission_type,
  'complete',coherent,'tickets',tickets,'paid',paid,'free',registrations,'asOf',statement_timestamp());
end;
$$;
revoke all on function public.get_owned_event_cancellation_summary(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_owned_event_cancellation_summary(uuid) to authenticated;
