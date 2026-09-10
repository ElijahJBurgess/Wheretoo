create or replace function private.organizer_refund_state(p_order public.orders)
returns text language sql stable security definer set search_path='' as $$
select case when p_order.status='refunded' and p_order.refunded_at is not null then 'refunded'
 when exists(select 1 from public.refunds r where r.order_id=p_order.id and r.status in ('pending','requires_action')) then 'pending'
 when p_order.status='paid' and p_order.paid_at is not null and p_order.refunded_at is null
  and p_order.reconciliation_status='reconciled' and not exists(select 1 from public.refunds r where r.order_id=p_order.id and r.status='succeeded') then 'available'
 else 'unavailable' end;
$$;
revoke all on function private.organizer_refund_state(public.orders) from public,anon,authenticated,service_role;
create or replace function public.get_organizer_order(p_event_id uuid,p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_event public.events; v_order public.orders;
begin
 v_event:=private.require_owned_paid_event(p_event_id);
 select * into v_order from public.orders where id=p_order_id and event_id=p_event_id and organizer_id=v_event.organizer_id;
 if not found then raise exception using errcode='42501',message='Order unavailable'; end if;
 if not private.organizer_order_coherent(v_order.id) then raise exception using errcode='P0001',message='Operations data unavailable'; end if;
 return private.organizer_order_summary(v_order)||jsonb_build_object(
  'tickets',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'admissionLabel',t.admission_label,
   'status',t.status,'usedAt',t.used_at,'issuedAt',t.issued_at) order by t.order_item_id,t.unit_sequence),'[]'::jsonb) from public.tickets t where t.order_id=v_order.id),
  'refundState',private.organizer_refund_state(v_order),
  'admissionEligible',coalesce(v_order.status='paid' and v_order.reconciliation_status='reconciled'
   and v_event.status='published' and isfinite(v_event.starts_at) and isfinite(v_event.ends_at)
   and v_event.ends_at>v_event.starts_at and v_event.ends_at>statement_timestamp(),false));
end;
$$;
revoke all on function public.get_organizer_order(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_organizer_order(uuid,uuid) to authenticated;
