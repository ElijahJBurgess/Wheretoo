-- A context adapter only: all writes, locks, lifecycle decisions and duplicate
-- rejection remain in server_redeem_paid_ticket.
create function public.server_redeem_organizer_ticket(p_organizer_id uuid,p_event_id uuid,p_credential_hash bytea)
returns table(outcome text,admission_label text,buyer_name text,used_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_result record;
begin
 select * into strict v_result from public.server_redeem_paid_ticket(p_organizer_id,p_event_id,p_credential_hash);
 if v_result.outcome in ('admitted','already_used','refunded','cancelled') then
  return query select v_result.outcome,v_result.admission_label,o.buyer_name,t.used_at
   from public.tickets t join public.orders o on o.id=t.order_id
   where t.credential_hash=p_credential_hash and t.event_id=p_event_id and t.organizer_id=p_organizer_id
    and o.event_id=p_event_id and o.organizer_id=p_organizer_id;
 else return query select v_result.outcome,v_result.admission_label,null::text,null::timestamptz;
 end if;
end;
$$;
revoke all on function public.server_redeem_organizer_ticket(uuid,uuid,bytea) from public,anon,authenticated;
grant execute on function public.server_redeem_organizer_ticket(uuid,uuid,bytea) to service_role;
create function public.redeem_owned_ticket(p_event_id uuid,p_ticket_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_event public.events; v_hash bytea; v_result record;
begin
 v_event:=private.require_owned_paid_event(p_event_id);
 select credential_hash into v_hash from public.tickets where id=p_ticket_id and event_id=p_event_id and organizer_id=v_event.organizer_id;
 if not found then return jsonb_build_object('outcome','invalid'); end if;
 select * into strict v_result from public.server_redeem_organizer_ticket(v_event.organizer_id,p_event_id,v_hash);
 return jsonb_strip_nulls(jsonb_build_object('outcome',v_result.outcome,'admissionLabel',v_result.admission_label,
  'buyerName',v_result.buyer_name,'usedAt',v_result.used_at));
end;
$$;
revoke all on function public.redeem_owned_ticket(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.redeem_owned_ticket(uuid,uuid) to authenticated;
