-- Spec10: narrow owner-read compatibility. Financial and admission writers are unchanged.
create function private.is_payment_after_invalidation_without_tickets(o public.orders)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(o.status='requires_review' and o.reconciliation_status='requires_review'
  and o.failure_code='PAYMENT_AFTER_INVALIDATION' and o.paid_at is not null
  and o.refunded_at is null and o.quantity>0 and o.total_minor>0
  and not exists(select 1 from public.tickets t where t.order_id=o.id),false);
$$;
revoke all on function private.is_payment_after_invalidation_without_tickets(public.orders) from public,anon,authenticated,service_role;

create or replace function private.organizer_order_coherent(p_order_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select coalesce((select
   o.organizer_id=e.organizer_id and e.admission_type='paid' and not o.livemode
   and o.currency='usd'
   and (o.paid_at is null or o.status in ('paid','refunded','requires_review','partially_refunded'))
   and (o.status<>'paid' or (o.paid_at is not null and o.refunded_at is null
     and o.reconciliation_status='reconciled'))
   and (o.status<>'refunded' or o.refunded_at is not null)
   and not exists (select 1 from public.tickets t where t.order_id=o.id and (
     (o.status='paid' and not (t.status='used'
       or (e.status='cancelled' and t.status='cancelled')
       or (e.status<>'cancelled' and t.status='valid')))
     or (o.status='refunded' and t.status not in ('used','refunded'))
   ))
   and (select count(*) between 1 and 10 and sum(i.quantity)=o.quantity
     and sum(i.subtotal_minor)=o.subtotal_minor
     and bool_and(t.event_id=o.event_id and i.currency=o.currency
       and i.subtotal_minor=i.unit_amount_minor*i.quantity)
     from public.order_items i join public.ticket_tiers t on t.id=i.ticket_tier_id where i.order_id=o.id)
   and (select count(*) from public.tickets t where t.order_id=o.id)=
     case when private.is_payment_after_invalidation_without_tickets(o) then 0
       when o.paid_at is not null then o.quantity else 0 end
   and not exists (
     select 1 from public.tickets t left join public.order_items i on i.id=t.order_item_id
     where (t.order_id=o.id or i.order_id=o.id) and (
       i.id is null or t.order_id<>i.order_id or t.event_id<>o.event_id
       or t.organizer_id<>o.organizer_id or t.ticket_tier_id<>i.ticket_tier_id
       or t.admission_label<>i.tier_name or t.unit_sequence not between 1 and i.quantity
     )
   )
 from public.orders o join public.events e on e.id=o.event_id where o.id=p_order_id),false);
$$;
revoke all on function private.organizer_order_coherent(uuid) from public,anon,authenticated,service_role;


-- Add the explicit exception marker only to the recognized no-ticket DTO; legacy DTOs are unchanged.
alter function public.get_organizer_order(uuid,uuid) rename to get_organizer_order_before_spec10;
alter function public.get_organizer_order_before_spec10(uuid,uuid) set schema private;
revoke all on function private.get_organizer_order_before_spec10(uuid,uuid) from public,anon,authenticated,service_role;
create function public.get_organizer_order(p_event_id uuid,p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; o public.orders;
begin
 result:=private.get_organizer_order_before_spec10(p_event_id,p_order_id);
 select * into o from public.orders where id=p_order_id;
 if private.is_payment_after_invalidation_without_tickets(o) then
  result:=result||jsonb_build_object('paymentAfterInvalidation',true);
 end if;
 return result;
end;
$$;
revoke all on function public.get_organizer_order(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_organizer_order(uuid,uuid) to authenticated;
