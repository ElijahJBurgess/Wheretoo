create function private.enqueue_initial_ticket_email(p_kind text,p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare active_since timestamptz; issued_at timestamptz; source jsonb;
begin
 select enabled_at into active_since from private.ticket_email_settings where singleton;
 if active_since is null then return; end if;
 if p_kind='paid_order' then select paid_at into issued_at from public.orders where id=p_id;
 elsif p_kind='free_registration' then select created_at into issued_at from public.free_registrations where id=p_id;
 else return; end if;
 -- Replaying pre-activation issuance never creates a historical automatic send.
 if issued_at is null or issued_at<active_since then return; end if;
 source:=private.ticket_email_source(p_kind,p_id);
 if source is null or not (source->>'eligible')::boolean then return; end if;
 insert into private.ticket_email_outbox(purpose,order_id,registration_id)
 values('initial',case when p_kind='paid_order' then p_id end,case when p_kind='free_registration' then p_id end) on conflict do nothing;
end;
$$;

-- Preserve Spec 06's authoritative implementation intact, behind a narrow wrapper.
alter function public.server_confirm_free_registration(uuid,uuid,text,text,integer,text,jsonb) set schema private;
alter function private.server_confirm_free_registration(uuid,uuid,text,text,integer,text,jsonb) rename to confirm_free_registration_issuance;
revoke all on function private.confirm_free_registration_issuance(uuid,uuid,text,text,integer,text,jsonb) from public,anon,authenticated,service_role;
create function public.server_confirm_free_registration(p_request_id uuid,p_event_id uuid,p_name text,p_email text,p_quantity integer,p_access_hash text,p_ticket_manifest jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=private.confirm_free_registration_issuance(p_request_id,p_event_id,p_name,p_email,p_quantity,p_access_hash,p_ticket_manifest);
 if result->>'kind'='confirmed' then perform private.enqueue_initial_ticket_email('free_registration',(result->>'registrationId')::uuid); end if;
 return result;
end;
$$;

create function public.get_ticket_email_delivery(p_event_id uuid,p_source_kind text,p_source_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s jsonb; latest jsonb;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Collection unavailable'; end if;
 s:=private.ticket_email_source(p_source_kind,p_source_id);
 if p_event_id is null or s is null or (s->>'eventId')::uuid<>p_event_id or (s->>'organizerId')::uuid<>auth.uid() then raise exception using errcode='42501',message='Collection unavailable'; end if;
 select jsonb_build_object('id',q.id,'state',case when q.state='sending' and q.lease_until<=clock_timestamp() then 'unknown' else q.state end,
 'observation',q.observation,'createdAt',q.created_at,'stoppedReason',q.dispatch_stopped_reason) into latest
 from private.ticket_email_outbox q where (p_source_kind='paid_order' and q.order_id=p_source_id) or (p_source_kind='free_registration' and q.registration_id=p_source_id)
 order by created_at desc,id desc limit 1;
 return jsonb_build_object('sourceKind',p_source_kind,'sourceId',p_source_id,'eventId',p_event_id,'recipientEmail',s->>'email',
 'eligible',(s->>'eligible')::boolean,'reason',s->>'reason','configured',(select enabled_at is not null and limits is not null from private.ticket_email_settings where singleton),'latest',latest);
end;
$$;

create function public.request_ticket_email_resend(p_event_id uuid,p_source_kind text,p_source_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s jsonb; q private.ticket_email_outbox; permitted boolean;
begin
 s:=public.get_ticket_email_delivery(p_event_id,p_source_kind,p_source_id); -- Always owner-check before idempotent replay.
 if p_request_id is null then raise exception using errcode='22023',message='Invalid email request'; end if;
 perform pg_advisory_xact_lock(hashtextextended('email-resend-request:'||p_request_id::text,0));
 select * into q from private.ticket_email_outbox where purpose='resend' and request_id=p_request_id;
 if found then
  if q.requested_by<>auth.uid() or coalesce(q.order_id,q.registration_id)<>p_source_id or (q.order_id is not null)<>(p_source_kind='paid_order') then raise exception using errcode='42501',message='Collection unavailable'; end if;
  return jsonb_build_object('kind','queued','attemptId',q.id);
 end if;
 if not (s->>'configured')::boolean then return jsonb_build_object('kind','not_enabled'); end if;
 if not (s->>'eligible')::boolean then return jsonb_build_object('kind','ineligible','reason',s->>'reason'); end if;
 -- Authenticated capacity uses disjoint lanes from anonymous recovery and initial sends.
 permitted:=private.consume_ticket_email_limits(jsonb_build_array(
  jsonb_build_object('lane','resend_recipient','hash',private.ticket_email_fingerprint(s->>'recipientEmail')),
  jsonb_build_object('lane','resend_source','hash',private.ticket_email_fingerprint(p_source_kind||':'||p_source_id::text)),
  jsonb_build_object('lane','resend_actor','hash',private.ticket_email_fingerprint(auth.uid()::text)),
  jsonb_build_object('lane','resend_event','hash',private.ticket_email_fingerprint(p_event_id::text))));
 if not permitted then return jsonb_build_object('kind','rate_limited'); end if;
 insert into private.ticket_email_outbox(purpose,order_id,registration_id,requested_by,request_id)
 values('resend',case when p_source_kind='paid_order' then p_source_id end,case when p_source_kind='free_registration' then p_source_id end,auth.uid(),p_request_id) returning * into q;
 return jsonb_build_object('kind','queued','attemptId',q.id);
end;
$$;

-- Matching never runs on the anonymous HTTP path. Only encrypted recipient data is queued.
create function public.server_request_ticket_recovery(p_request_id uuid,p_recipient_hash text,p_ip_hash text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_request_id is null or p_recipient_hash is null or p_ip_hash is null or p_recipient_hash !~ '^[0-9a-f]{64}$' or p_ip_hash !~ '^[0-9a-f]{64}$' or not private.ticket_email_envelope_valid(p_payload) then return jsonb_build_object('kind','requested'); end if;
 if not (select enabled_at is not null and limits is not null from private.ticket_email_settings where singleton) then return jsonb_build_object('kind','not_enabled'); end if;
 perform pg_advisory_xact_lock(hashtextextended('ticket-recovery-request:'||p_request_id::text,0));
 if exists(select 1 from private.ticket_email_outbox where purpose='recovery' and request_id=p_request_id) then return jsonb_build_object('kind','requested'); end if;
 if not private.consume_ticket_email_limits(jsonb_build_array(jsonb_build_object('lane','recovery_recipient','hash',p_recipient_hash),jsonb_build_object('lane','recovery_ip','hash',p_ip_hash))) then return jsonb_build_object('kind','requested'); end if;
 insert into private.ticket_email_outbox(purpose,request_id,recovery_payload) values('recovery',p_request_id,p_payload);
 return jsonb_build_object('kind','requested');
end;
$$;

create function public.get_organizer_free_registration_detail(p_event_id uuid,p_registration_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e public.events; r public.free_registrations;
begin
 e:=private.require_owned_free_event(p_event_id);
 select * into r from public.free_registrations where id=p_registration_id and event_id=e.id and organizer_id=e.organizer_id;
 if not found then raise exception using errcode='42501',message='Registration unavailable'; end if;
 if not private.free_registration_is_coherent(r.id) then raise exception using errcode='P0001',message='Operations data unavailable'; end if;
 return jsonb_build_object('registrationId',r.id,'eventId',e.id,'eventName',e.title,'registrantName',r.name,'registrantEmail',r.email,
 'status',r.status,'quantity',r.quantity,'createdAt',r.created_at,'tickets',(
 select jsonb_agg(jsonb_build_object('ticketId',t.id,'position',t.unit_sequence,'admissionLabel',t.admission_label,'status',t.status,'usedAt',t.used_at) order by t.unit_sequence) from public.tickets t where registration_id=r.id));
end;
$$;

create function public.server_ticket_email_confirmation_status(p_kind text,p_access_hash text,p_ip_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare source_id uuid; latest jsonb;
begin
 if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then return null; end if;
 -- Every bounded access request spends aggregate IP capacity before protected lookups.
 if not private.consume_ticket_email_limits(jsonb_build_array(jsonb_build_object('lane','access_ip','hash',p_ip_hash))) then return jsonb_build_object('kind','rate_limited'); end if;
 if p_access_hash is not null and p_access_hash ~ '^[0-9a-f]{64}$' then
  if p_kind='paid_order' then select id into source_id from public.orders where confirmation_token_hash=p_access_hash and status='paid' and private.organizer_order_coherent(id);
  elsif p_kind='free_registration' then select id into source_id from public.free_registrations where access_hash=p_access_hash and private.free_registration_is_coherent(id);
  end if;
 end if;
 if source_id is null then
  if not private.consume_ticket_email_limits(jsonb_build_array(jsonb_build_object('lane','invalid_access_ip','hash',p_ip_hash))) then return jsonb_build_object('kind','rate_limited'); end if;
  return null;
 end if;
 if not private.consume_ticket_email_limits(jsonb_build_array(jsonb_build_object('lane','verified_grant','hash',private.ticket_email_fingerprint('status:'||source_id::text)))) then return jsonb_build_object('kind','rate_limited'); end if;
 select jsonb_build_object('state',case when state='sending' and lease_until<=clock_timestamp() then 'unknown' else state end,'observation',observation) into latest
 from private.ticket_email_outbox where purpose='initial' and ((p_kind='paid_order' and order_id=source_id) or (p_kind='free_registration' and registration_id=source_id))
 order by created_at desc,id desc limit 1;
 return coalesce(latest,jsonb_build_object('state','not_requested','observation',null));
end;
$$;

revoke all on function private.enqueue_initial_ticket_email(text,uuid),public.server_confirm_free_registration(uuid,uuid,text,text,integer,text,jsonb),public.get_ticket_email_delivery(uuid,text,uuid),public.request_ticket_email_resend(uuid,text,uuid,uuid),public.server_request_ticket_recovery(uuid,text,text,jsonb),public.get_organizer_free_registration_detail(uuid,uuid),public.server_ticket_email_confirmation_status(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_ticket_email_delivery(uuid,text,uuid),public.request_ticket_email_resend(uuid,text,uuid,uuid),public.get_organizer_free_registration_detail(uuid,uuid) to authenticated;
grant execute on function public.server_confirm_free_registration(uuid,uuid,text,text,integer,text,jsonb),public.server_request_ticket_recovery(uuid,text,text,jsonb),public.server_ticket_email_confirmation_status(text,text,text) to service_role;

-- Paid fulfillment keeps its existing authoritative writer and result shape.
create or replace function public.server_fulfill_paid_order(
  p_stripe_event_id text,
  p_order_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_charge_id text,
  p_transfer_id text,
  p_application_fee_id text,
  p_balance_transaction_id text,
  p_customer_id text,
  p_mode text,
  p_payment_status text,
  p_currency text,
  p_subtotal_minor bigint,
  p_total_minor bigint,
  p_application_fee_amount_minor bigint,
  p_destination_account_id text,
  p_ticket_manifest jsonb
)
returns table (
  order_id uuid,
  order_status text,
  ticket_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare fulfilled record;
begin
  select * into fulfilled
  from private.fulfill_paid_order(
    p_stripe_event_id,
    p_order_id,
    p_checkout_session_id,
    p_payment_intent_id,
    p_charge_id,
    p_transfer_id,
    p_application_fee_id,
    p_balance_transaction_id,
    p_customer_id,
    p_mode,
    p_payment_status,
    p_currency,
    p_subtotal_minor,
    p_total_minor,
    p_application_fee_amount_minor,
    p_destination_account_id,
    p_ticket_manifest
  );
  if fulfilled.order_status='paid' then perform private.enqueue_initial_ticket_email('paid_order',p_order_id); end if;
  return query select fulfilled.order_id,fulfilled.order_status,fulfilled.ticket_count;
end;
$$;
