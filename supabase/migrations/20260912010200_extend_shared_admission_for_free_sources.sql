-- The public organizer admission seam remains the sole source-aware writer.
-- Paid core and credential protocol are unchanged; free rows have no paid core.
create or replace function public.server_redeem_organizer_ticket(p_organizer_id uuid,p_event_id uuid,p_credential_hash bytea)
returns table(outcome text,admission_label text,buyer_name text,used_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_result record; e public.events; t public.tickets; r public.free_registrations;
begin
 perform public.lock_event_ticketing_operation(p_event_id);
 select * into e from public.events where id=p_event_id for update;
 if not found or p_organizer_id is null or e.organizer_id<>p_organizer_id then
  raise exception using errcode='42501',message='Admission forbidden'; end if;
 select * into t from public.tickets where credential_hash=p_credential_hash;
 if t.registration_id is null then
  select * into strict v_result from public.server_redeem_paid_ticket(p_organizer_id,p_event_id,p_credential_hash);
  if v_result.outcome in ('admitted','already_used','refunded','cancelled') then
   return query select v_result.outcome,v_result.admission_label,o.buyer_name,tickets.used_at
    from public.tickets tickets join public.orders o on o.id=tickets.order_id
    where tickets.credential_hash=p_credential_hash and tickets.event_id=p_event_id and tickets.organizer_id=p_organizer_id
     and o.event_id=p_event_id and o.organizer_id=p_organizer_id;
  else return query select v_result.outcome,v_result.admission_label,null::text,null::timestamptz;
  end if;
  return;
 end if;
 if t.event_id=p_event_id then
  select * into t from public.tickets where id=t.id for update;
 end if;
 select * into r from public.free_registrations where id=t.registration_id;
 if not private.free_registration_is_coherent(t.registration_id) then
  return query select 'invalid'::text,null::text,null::text,null::timestamptz; return; end if;
 if t.status in ('used','cancelled') then
  if t.event_id<>p_event_id then return query select 'wrong_event'::text,null::text,null::text,null::timestamptz;
  else return query select case when t.status='used' then 'already_used' else 'cancelled' end,t.admission_label,r.name,t.used_at; end if;
  return;
 end if;
 if t.event_id<>p_event_id then select * into e from public.events where id=t.event_id; end if;
 if r.status<>'confirmed' or e.status<>'published' or t.status<>'valid'
  or e.starts_at is null or e.ends_at is null or not isfinite(e.starts_at) or not isfinite(e.ends_at)
  or e.ends_at<=e.starts_at or e.ends_at<=clock_timestamp() then
  return query select 'invalid'::text,null::text,null::text,null::timestamptz; return; end if;
 if t.event_id<>p_event_id then
  return query select 'wrong_event'::text,null::text,null::text,null::timestamptz; return; end if;
 return query update public.tickets tickets set status='used',used_at=clock_timestamp()
  where tickets.id=t.id and tickets.status='valid' and tickets.used_at is null and tickets.cancelled_at is null and tickets.refunded_at is null
  returning 'admitted'::text,tickets.admission_label,r.name,tickets.used_at;
 if not found then return query select 'invalid'::text,null::text,null::text,null::timestamptz; end if;
end;
$$;
create or replace function public.redeem_owned_ticket(p_event_id uuid,p_ticket_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_event public.events; v_hash bytea; v_result record;
begin
 select * into v_event from public.events where id=p_event_id and organizer_id=auth.uid();
 if not found then raise exception using errcode='42501',message='Event unavailable'; end if;
 select credential_hash into v_hash from public.tickets where id=p_ticket_id and event_id=p_event_id and organizer_id=v_event.organizer_id;
 if not found then return jsonb_build_object('outcome','invalid'); end if;
 select * into strict v_result from public.server_redeem_organizer_ticket(v_event.organizer_id,p_event_id,v_hash);
 return jsonb_strip_nulls(jsonb_build_object('outcome',v_result.outcome,'admissionLabel',v_result.admission_label,
  'buyerName',v_result.buyer_name,'usedAt',v_result.used_at));
end;
$$;
revoke all on function public.server_redeem_organizer_ticket(uuid,uuid,bytea),public.redeem_owned_ticket(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.server_redeem_organizer_ticket(uuid,uuid,bytea) to service_role;
grant execute on function public.redeem_owned_ticket(uuid,uuid) to authenticated;
