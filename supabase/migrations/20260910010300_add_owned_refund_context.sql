-- Service-only ownership context for the existing whole-order refund engine.
create function public.server_get_organizer_refund_context(p_organizer_id uuid,p_event_id uuid,p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_order public.orders;
begin
 select o.* into v_order from public.orders o join public.events e on e.id=o.event_id
 where o.id=p_order_id and o.event_id=p_event_id and o.organizer_id=p_organizer_id
 and e.organizer_id=p_organizer_id and e.admission_type='paid' and not o.livemode;
 if p_organizer_id is null or not found then raise exception using errcode='42501',message='Order unavailable'; end if;
 if not private.organizer_order_coherent(v_order.id) then raise exception using errcode='P0001',message='Operations data unavailable'; end if;
 return jsonb_build_object('refundState',private.organizer_refund_state(v_order));
end;
$$;
revoke all on function public.server_get_organizer_refund_context(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.server_get_organizer_refund_context(uuid,uuid,uuid) to service_role;
