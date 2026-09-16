-- Spec 09 extends the Spec 07 delivery ledger. No financial/admission writer is changed.
alter table private.ticket_email_grants drop constraint ticket_email_grants_purpose_check;
alter table private.ticket_email_grants add constraint ticket_email_grants_purpose_check check(purpose in ('initial','resend','recovery','refund_notice'));
alter table private.ticket_email_grants drop constraint ticket_email_grants_schedule_basis;
alter table private.ticket_email_grants add constraint ticket_email_grants_schedule_basis check(
 (purpose='recovery' and scheduled_end_at is null)
 or (purpose='refund_notice' and scheduled_end_at is null and expires_at=prepared_at+interval '30 days')
 or (purpose in ('initial','resend') and scheduled_end_at is not null and isfinite(scheduled_end_at) and expires_at=scheduled_end_at+interval '24 hours'));
alter table private.ticket_email_outbox drop constraint ticket_email_outbox_purpose_check;
alter table private.ticket_email_outbox add constraint ticket_email_outbox_purpose_check check(purpose in ('initial','resend','recovery','refund_notice'));
alter table private.ticket_email_outbox add constraint ticket_email_refund_order_only check(purpose<>'refund_notice' or (order_id is not null and registration_id is null));
create unique index ticket_email_refund_order on private.ticket_email_outbox(order_id) where purpose='refund_notice';
-- This receipt outlives outbox retention, just as initial ticket issuance receipts do.
create table private.refund_notice_receipts(order_id uuid primary key references public.orders(id) on delete restrict,created_at timestamptz not null default clock_timestamp());
revoke all on private.refund_notice_receipts from public,anon,authenticated,service_role;

create function private.refund_detail(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare o public.orders; e public.events;
begin
 select * into o from public.orders where id=p_order_id;
 if not found or o.status<>'refunded' or o.refunded_at is null or o.paid_at is null or o.reconciliation_status<>'reconciled' or not private.organizer_order_coherent(o.id) then return null; end if;
 if not coalesce((select sum(r.amount_minor)=o.total_minor and bool_and(r.policy_verified and r.currency=o.currency) from public.refunds r where r.order_id=o.id and r.status='succeeded'),false)
 or exists(select 1 from public.refunds r where r.order_id=o.id and r.status in ('pending','requires_action')) then return null; end if;
 select * into e from public.events where id=o.event_id;
 -- Explicit allowlist: no buyer identity, Stripe IDs, original bearer or QR material.
 return jsonb_build_object('orderNumber',o.order_number,'eventName',e.title,'startsAt',e.starts_at,'endsAt',e.ends_at,'timezone',e.timezone,'venueName',e.venue_name,
 'currency',o.currency,'totalMinor',o.total_minor,'subtotalMinor',o.subtotal_minor,'quantity',o.quantity,
 'items',(select jsonb_agg(jsonb_build_object('tierName',i.tier_name,'quantity',i.quantity,'subtotalMinor',i.subtotal_minor) order by i.id) from public.order_items i where i.order_id=o.id),
 'refundAmountMinor',o.total_minor,'completedAt',o.refunded_at,
 'tickets',(select jsonb_agg(jsonb_build_object('id',t.id,'admissionLabel',t.admission_label,'status',t.status,'usedAt',t.used_at) order by t.order_item_id,t.unit_sequence) from public.tickets t where t.order_id=o.id));
end;
$$;
create function private.refund_notice_source(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare detail jsonb; recipient text; label text;
begin
 detail:=private.refund_detail(p_order_id);
 if detail is null then return null; end if;
 select lower(btrim(buyer_email)),buyer_name into recipient,label from public.orders where id=p_order_id;
 if recipient is null or char_length(recipient)>320 or recipient !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' or octet_length(recipient)<>char_length(recipient)
 or exists(select 1 from private.ticket_email_recipient_blocks where recipient_hash=private.ticket_email_fingerprint(recipient)) then return null; end if;
 return jsonb_build_object('email',recipient,'recipientName',label,'eligible',true,'order',detail);
end;
$$;
create function public.server_enqueue_refund_notices(p_limit integer default 25) returns integer
language plpgsql security definer set search_path='' as $$
declare candidate uuid; inserted integer:=0; active_since timestamptz;
begin
 if p_limit is null or p_limit not between 1 and 100 then return 0; end if;
 select enabled_at into active_since from private.ticket_email_settings where singleton and worker_enabled;
 if active_since is null then return 0; end if;
 -- A bounded page of already committed refunds. Retry only this delivery step after failure.
 for candidate in select o.id from public.orders o where o.status='refunded' and o.refunded_at>=active_since
 and not exists(select 1 from private.refund_notice_receipts r where r.order_id=o.id)
 and private.refund_detail(o.id) is not null
 order by o.refunded_at,o.id limit p_limit for update of o skip locked loop
  if private.refund_detail(candidate) is null then continue; end if;
  insert into private.refund_notice_receipts(order_id) values(candidate) on conflict do nothing;
  if not found then continue; end if;
  insert into private.ticket_email_outbox(purpose,order_id) values('refund_notice',candidate);
  inserted:=inserted+1;
 end loop;
 return inserted;
end;
$$;

-- Preserve the reviewed ordinary preparation implementation behind a private delegate.
alter function public.server_prepare_ticket_email_context(uuid,uuid,text) rename to prepare_admission_email_context;
alter function public.prepare_admission_email_context(uuid,uuid,text) set schema private;
revoke all on function private.prepare_admission_email_context(uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.server_prepare_ticket_email_context(p_attempt_id uuid,p_lease_id uuid,p_recovery_email text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q private.ticket_email_outbox; g private.ticket_email_grants; source jsonb; at_time timestamptz:=clock_timestamp();
begin
 select * into q from private.ticket_email_outbox where id=p_attempt_id and lease_id=p_lease_id and lease_until>at_time for update;
 if not found then return null; end if;
 if q.purpose<>'refund_notice' then return private.prepare_admission_email_context(p_attempt_id,p_lease_id,p_recovery_email); end if;
 source:=private.refund_notice_source(q.order_id);
 if source is null then
  update private.ticket_email_outbox set state=case when first_possible_dispatch_at is null then 'suppressed' else state end,dispatch_stopped_reason='source_no_longer_eligible',lease_until=null,updated_at=at_time where id=q.id;
  return jsonb_build_object('kind','suppressed');
 end if;
 if q.grant_id is null then
  insert into private.ticket_email_grants(purpose,prepared_at,expires_at) values('refund_notice',at_time,at_time+interval '30 days') returning * into g;
  insert into private.ticket_email_members(grant_id,position,order_id) values(g.id,1,q.order_id);
  update private.ticket_email_outbox set grant_id=g.id,recipient_hash=private.ticket_email_fingerprint(source->>'email'),updated_at=at_time where id=q.id returning * into q;
 else select * into g from private.ticket_email_grants where id=q.grant_id;
 end if;
 return jsonb_build_object('kind','ready','attemptId',q.id,'purpose',q.purpose,'grantId',g.id,'preparedAt',g.prepared_at,'expiresAt',g.expires_at,'scheduledEndAt',null,'overflow',false,'sources',jsonb_build_array(source),'payload',q.payload);
end;
$$;

create or replace function public.server_begin_ticket_email_dispatch(p_attempt_id uuid,p_lease_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q private.ticket_email_outbox; g private.ticket_email_grants; blocked text; at_time timestamptz:=clock_timestamp();
begin
 if not (select worker_enabled from private.ticket_email_settings where singleton) then return null; end if;
 select * into q from private.ticket_email_outbox where id=p_attempt_id and lease_id=p_lease_id and lease_until>at_time+interval '20 seconds' for update;
 if not found or q.state not in ('queued','unknown') or q.payload is null or q.dispatch_stopped_reason is not null then return null; end if;
 select * into g from private.ticket_email_grants where id=q.grant_id;
 if q.dispatch_count>=6 or q.first_possible_dispatch_at<=at_time-interval '23 hours' then blocked:='retry_window_exhausted';
 elsif exists(select 1 from private.ticket_email_recipient_blocks where recipient_hash=q.recipient_hash) then blocked:='recipient_blocked';
 elsif g.id is null or g.purpose<>q.purpose then blocked:='access_unavailable';
 elsif g.expires_at<=at_time or g.revoked_at is not null then blocked:='access_expired';
 elsif q.purpose='refund_notice' and (private.refund_notice_source(q.order_id) is null or
  not exists(select 1 from private.ticket_email_members where grant_id=g.id and order_id=q.order_id and position=1) or
  (select count(*) from private.ticket_email_members where grant_id=g.id)<>1) then blocked:='source_no_longer_eligible';
 elsif q.purpose<>'refund_notice' and not g.overflow and exists(select 1 from private.ticket_email_members m where m.grant_id=g.id
  and not coalesce((private.ticket_email_source(case when m.order_id is null then 'free_registration' else 'paid_order' end,coalesce(m.order_id,m.registration_id))->>'eligible')::boolean,false)) then blocked:='source_no_longer_eligible';
 end if;
 if blocked is not null then
  update private.ticket_email_outbox set dispatch_stopped_reason=blocked,state=case when first_possible_dispatch_at is null then 'suppressed' else state end,lease_until=null,updated_at=at_time where id=q.id;
  return null;
 end if;
 -- Commit this record BEFORE the caller starts its bounded provider request.
 update private.ticket_email_outbox set state='sending',first_possible_dispatch_at=coalesce(first_possible_dispatch_at,at_time),
 dispatch_count=dispatch_count+1,updated_at=at_time where id=q.id returning * into q;
 return jsonb_build_object('attemptId',q.id,'grantId',q.grant_id,'payload',q.payload,'idempotencyKey','ticket-email/'||q.id::text,
 'leaseUntil',q.lease_until,'firstPossibleDispatchAt',q.first_possible_dispatch_at,'dispatchCount',q.dispatch_count);
end;
$$;


-- Financial grants never authorize the admission resolver (including its index).
create or replace function public.server_read_ticket_email_access(p_token_hash text,p_ip_hash text,p_page integer default 0,p_member integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g private.ticket_email_grants; m private.ticket_email_members; proof text; projection jsonb; entries jsonb; total integer;
begin
 if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then return null; end if;
 -- Malformed hashes/selectors still spend aggregate and invalid-IP capacity, with no grant lookup.
 if not private.consume_ticket_email_limits(jsonb_build_array(jsonb_build_object('lane','access_ip','hash',p_ip_hash))) then return jsonb_build_object('kind','rate_limited'); end if;
 if p_token_hash is not null and p_token_hash ~ '^[0-9a-f]{64}$' and p_page is not null and p_page between 0 and 9 and (p_member is null or p_member between 1 and 200) then
  select * into g from private.ticket_email_grants where token_hash=p_token_hash and purpose in ('initial','resend','recovery') and revoked_at is null and expires_at>clock_timestamp() and not overflow;
 end if;
 if g.id is null then
  if not private.consume_ticket_email_limits(jsonb_build_array(jsonb_build_object('lane','invalid_access_ip','hash',p_ip_hash))) then return jsonb_build_object('kind','rate_limited'); end if;
  return null;
 end if;
 if not private.consume_ticket_email_limits(jsonb_build_array(
  jsonb_build_object('lane','verified_grant','hash',private.ticket_email_fingerprint(g.id::text)))) then return jsonb_build_object('kind','rate_limited'); end if;
 if p_member is not null then
  select * into m from private.ticket_email_members where grant_id=g.id and position=p_member;
  if not found then return null; end if;
  if m.order_id is not null then
   select confirmation_token_hash into proof from public.orders where id=m.order_id;
   select to_jsonb(p) into projection from public.server_lookup_paid_ticket_collection(proof) p;
  else
   select access_hash into proof from public.free_registrations where id=m.registration_id;
   projection:=public.server_lookup_free_ticket_collection(proof);
  end if;
  if projection is null then return null; end if;
  return jsonb_build_object('kind','member','sourceKind',case when m.order_id is null then 'free_registration' else 'paid_order' end,'projection',projection,'expiresAt',g.expires_at);
 end if;
 select count(*) into total from private.ticket_email_members where grant_id=g.id;
 select coalesce(jsonb_agg(jsonb_build_object('selector',x.position,'sourceKind',case when x.order_id is null then 'free_registration' else 'paid_order' end,
  'eventName',e.title,'startsAt',e.starts_at,'quantity',coalesce(o.quantity,r.quantity),'createdAt',coalesce(o.created_at,r.created_at)) order by x.position),'[]') into entries
 from (select * from private.ticket_email_members where grant_id=g.id order by position limit 20 offset p_page*20) x
 left join public.orders o on o.id=x.order_id left join public.free_registrations r on r.id=x.registration_id
 join public.events e on e.id=coalesce(o.event_id,r.event_id);
 return jsonb_build_object('kind','index','expiresAt',g.expires_at,'total',total,'page',p_page,'nextPage',case when (p_page+1)*20<total then p_page+1 end,'collections',entries);
end;
$$;

create function public.server_read_refund_detail_access(p_token_hash text,p_ip_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g private.ticket_email_grants; detail jsonb;
begin
 if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then return null; end if;
 if not private.consume_ticket_email_limits(jsonb_build_array(jsonb_build_object('lane','access_ip','hash',p_ip_hash))) then return jsonb_build_object('kind','rate_limited'); end if;
 if p_token_hash is not null and p_token_hash ~ '^[0-9a-f]{64}$' then
  select * into g from private.ticket_email_grants where token_hash=p_token_hash and purpose='refund_notice' and revoked_at is null and expires_at>clock_timestamp() and not overflow;
 end if;
 if g.id is null then
  if not private.consume_ticket_email_limits(jsonb_build_array(jsonb_build_object('lane','invalid_access_ip','hash',p_ip_hash))) then return jsonb_build_object('kind','rate_limited'); end if;
  return null;
 end if;
 if not private.consume_ticket_email_limits(jsonb_build_array(jsonb_build_object('lane','verified_grant','hash',private.ticket_email_fingerprint(g.id::text)))) then return jsonb_build_object('kind','rate_limited'); end if;
 if (select count(*) from private.ticket_email_members where grant_id=g.id)<>1 then return null; end if;
 select private.refund_detail(order_id) into detail from private.ticket_email_members where grant_id=g.id and position=1 and order_id is not null and registration_id is null;
 if detail is null then return null; end if;
 return jsonb_build_object('kind','ready','expiresAt',g.expires_at,'order',detail);
end;
$$;
create function public.get_organizer_refund_notice_status(p_event_id uuid,p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q private.ticket_email_outbox;
begin
 perform private.require_owned_paid_event(p_event_id);
 if not exists(select 1 from public.orders where id=p_order_id and event_id=p_event_id and organizer_id=auth.uid()) then raise exception using errcode='42501',message='Order unavailable'; end if;
 select * into q from private.ticket_email_outbox where purpose='refund_notice' and order_id=p_order_id;
 return jsonb_build_object('state',coalesce(q.state,case when exists(select 1 from private.refund_notice_receipts where order_id=p_order_id) then 'unknown' else 'not_requested' end),'observation',q.observation);
end;
$$;
revoke all on function private.refund_detail(uuid),private.refund_notice_source(uuid),public.server_enqueue_refund_notices(integer),public.server_read_refund_detail_access(text,text),public.server_prepare_ticket_email_context(uuid,uuid,text),public.get_organizer_refund_notice_status(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.server_enqueue_refund_notices(integer),public.server_read_refund_detail_access(text,text),public.server_prepare_ticket_email_context(uuid,uuid,text) to service_role;
grant execute on function public.get_organizer_refund_notice_status(uuid,uuid) to authenticated;
