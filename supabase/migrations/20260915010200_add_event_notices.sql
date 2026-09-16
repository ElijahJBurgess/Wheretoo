-- Extend Spec07: same delivery ledger, transport leases, provider observations and grants.
alter table private.ticket_email_grants drop constraint ticket_email_grants_purpose_check;
alter table private.ticket_email_grants add constraint ticket_email_grants_purpose_check check(purpose in ('initial','resend','recovery','refund_notice','event_change','event_cancellation'));
alter table private.ticket_email_grants drop constraint ticket_email_grants_schedule_basis;
alter table private.ticket_email_grants add constraint ticket_email_grants_schedule_basis check(
 (purpose='recovery' and scheduled_end_at is null)
 or (purpose in ('refund_notice','event_cancellation') and scheduled_end_at is null and expires_at=prepared_at+interval '30 days')
 or (purpose in ('initial','resend','event_change') and scheduled_end_at is not null and isfinite(scheduled_end_at) and expires_at=scheduled_end_at+interval '24 hours'));
alter table private.ticket_email_outbox drop constraint ticket_email_outbox_purpose_check;
alter table private.ticket_email_outbox add constraint ticket_email_outbox_purpose_check check(purpose in ('initial','resend','recovery','refund_notice','event_change','event_cancellation'));
create table private.event_notices (
 id uuid primary key default gen_random_uuid(),event_id uuid not null references public.events(id) on delete restrict,
 purpose text not null check(purpose in ('event_change','event_cancellation')),
 snapshot_id uuid references private.event_change_snapshots(snapshot_id) on delete restrict,
 previous_snapshot_id uuid references private.event_change_snapshots(snapshot_id) on delete restrict,
 required_fields text[] not null default '{}',
 preview_token text not null,request_id uuid not null unique,requested_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp()
);
-- Durable source receipts survive outbox retention; a removed attempt has unknown delivery status.
create table private.event_notice_sources (
 notice_id uuid not null references private.event_notices(id) on delete restrict,
 event_id uuid not null references public.events(id),purpose text not null,
 revision_key text not null,source_kind text not null check(source_kind in ('paid_order','free_registration')),
 source_id uuid not null,recipient_hash text not null check(recipient_hash ~ '^[0-9a-f]{64}$'),
 attempt_id uuid not null unique,
 primary key(event_id,purpose,revision_key,source_kind,source_id)
);
create index event_notice_sources_notice on private.event_notice_sources(notice_id);
create index event_notices_event on private.event_notices(event_id,created_at desc);
alter table private.event_notices enable row level security;
alter table private.event_notice_sources enable row level security;
revoke all on private.event_notices,private.event_notice_sources from public,anon,authenticated,service_role;
create function private.protect_event_notice_receipt() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Immutable event notice receipt';end;$$;
create trigger event_notices_immutable before update or delete on private.event_notices for each row execute function private.protect_event_notice_receipt();
create trigger event_notice_sources_immutable before update or delete on private.event_notice_sources for each row execute function private.protect_event_notice_receipt();

-- Allowlisted status read: event facts use the latest proven public snapshot. It issues no credentials.
create function private.event_notice_detail(p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare o public.orders;r public.free_registrations;e public.events;facts jsonb;qty integer;financial text;reference text;amount bigint;
begin
 if p_kind='paid_order' then
  select * into o from public.orders where id=p_id;
  if not found or o.paid_at is null or not private.organizer_order_coherent(o.id) then return null;end if;
  select * into e from public.events where id=o.event_id;
  qty:=o.quantity;reference:=o.order_number;amount:=o.total_minor;
  financial:=private.order_refund_state(o);
  if financial='completed' and private.refund_detail(o.id) is null then financial:='review';end if;
 elsif p_kind='free_registration' then
  select * into r from public.free_registrations where id=p_id;
  if not found or not private.free_registration_is_coherent(r.id) then return null;end if;
  select * into e from public.events where id=r.event_id;
  qty:=r.quantity;financial:='not_applicable';
 else return null;end if;
 select s.facts into facts from private.event_change_state h join private.event_change_snapshots s on s.snapshot_id=h.current_public_snapshot_id where h.event_id=e.id;
 return jsonb_build_object('sourceKind',p_kind,'eventStatus',e.status,'facts',facts,'quantity',qty,
  'orderNumber',reference,'financialState',financial,'totalMinor',amount,
  'tickets',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'admissionLabel',t.admission_label,'status',t.status,'usedAt',t.used_at) order by t.order_item_id,t.unit_sequence),'[]') from public.tickets t where (p_kind='paid_order' and t.order_id=p_id) or (p_kind='free_registration' and t.registration_id=p_id)),
  'canViewTickets',coalesce(private.event_is_publicly_eligible(e.id,clock_timestamp()) and (private.ticket_email_source(p_kind,p_id)->>'eligible')::boolean,false));
end;$$;
create function private.event_notice_source(p_kind text,p_id uuid,p_purpose text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare detail jsonb;recipient text;label text;event_id uuid;reason text;
begin
 detail:=private.event_notice_detail(p_kind,p_id);
 if detail is null then return null;end if;
 if p_kind='paid_order' then select lower(btrim(buyer_email)),buyer_name,orders.event_id into recipient,label,event_id from public.orders where id=p_id;
 else select email,name,free_registrations.event_id into recipient,label,event_id from public.free_registrations where id=p_id;end if;
 if p_purpose='event_change' then
  -- Factual notices include fully Used collections. Admission access remains
  -- independently gated by Spec07 through detail.canViewTickets.
  if not private.event_is_publicly_eligible(event_id,clock_timestamp())
   or jsonb_array_length(detail->'tickets')=0
   or (p_kind='paid_order' and not exists(select 1 from public.orders o where o.id=p_id
     and o.status='paid' and o.paid_at is not null and o.refunded_at is null
     and o.reconciliation_status='reconciled' and private.order_refund_state(o)='eligible'))
   or (p_kind='free_registration' and not exists(select 1 from public.free_registrations r where r.id=p_id and r.status='confirmed'))
  then reason:='source_ineligible';end if;
 elsif p_purpose='event_cancellation' then
  if detail->>'eventStatus'<>'cancelled' then reason:='event_not_cancelled';end if;
 else return null;end if;
 if recipient is null or char_length(recipient)>320 or recipient !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' or octet_length(recipient)<>char_length(recipient) then reason:='invalid_recipient';
 elsif exists(select 1 from private.ticket_email_recipient_blocks where recipient_hash=private.ticket_email_fingerprint(recipient)) then reason:='recipient_blocked';end if;
 return jsonb_build_object('sourceKind',p_kind,'sourceId',p_id,'eventId',event_id,'email',recipient,'recipientName',label,
  'recipientHash',private.ticket_email_fingerprint(recipient),'eligible',reason is null,'reason',reason,'detail',detail);
end;$$;
create function private.event_notice_audience(p_event_id uuid,p_purpose text,p_revision_key text) returns table(source_kind text,source_id uuid,source jsonb,already_submitted boolean)
language sql stable security definer set search_path='' as $$
 select x.kind,x.id,private.event_notice_source(x.kind,x.id,p_purpose),exists(select 1 from private.event_notice_sources s
  where s.event_id=p_event_id and s.purpose=p_purpose and s.revision_key=p_revision_key and s.source_kind=x.kind and s.source_id=x.id)
 from (
  select 'paid_order'::text kind,o.id from public.orders o where o.event_id=p_event_id and o.paid_at is not null
  union all select 'free_registration',r.id from public.free_registrations r where r.event_id=p_event_id
 ) x;
$$;
create function public.preview_owned_event_notice(p_event_id uuid,p_purpose text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e public.events;h private.event_change_state;revision_key text;audience jsonb;complete boolean;allowed boolean;token text;
begin
 select * into e from public.events where id=p_event_id and organizer_id=auth.uid();
 if auth.uid() is null or not found then raise exception using errcode='42501',message='Event unavailable';end if;
 if p_purpose is null or p_purpose not in ('event_change','event_cancellation') then raise exception using errcode='22023',message='Invalid notice purpose';end if;
 select * into h from private.event_change_state where event_id=e.id;
 revision_key:=case when p_purpose='event_change' then h.current_saved_snapshot_id::text else 'cancelled' end;
 allowed:=case when p_purpose='event_cancellation' then e.status='cancelled' else coalesce(private.event_is_publicly_eligible(e.id,clock_timestamp()) and h.current_saved_snapshot_id=h.current_public_snapshot_id,false)=true and h.current_saved_snapshot_id is not null end;
 select coalesce(jsonb_agg(jsonb_build_object('kind',a.source_kind,'id',a.source_id,'hash',a.source->>'recipientHash',
   'eligible',coalesce((a.source->>'eligible')::boolean,false),'reason',a.source->>'reason','submitted',a.already_submitted) order by a.source_kind,a.source_id),'[]'),coalesce(bool_and(a.source is not null),true)
 into audience,complete from private.event_notice_audience(e.id,p_purpose,revision_key) a;
 token:=encode(extensions.digest(jsonb_build_object('event',e.id,'purpose',p_purpose,'context',private.event_change_context_token(e.id),'audience',audience)::text,'sha256'),'hex');
 return jsonb_build_object('eventId',e.id,'purpose',p_purpose,'snapshotId',h.current_saved_snapshot_id,'previewToken',token,
  'complete',complete,'canSend',allowed and complete,'sourceCount',jsonb_array_length(audience),
  'eligibleMessages',case when complete then (select count(*) from jsonb_array_elements(audience) a where (a->>'eligible')::boolean and not (a->>'submitted')::boolean) end,
  'alreadySubmitted',case when complete then (select count(*) from jsonb_array_elements(audience) a where (a->>'submitted')::boolean) end,
  'excludedMessages',case when complete then (select count(*) from jsonb_array_elements(audience) a where not (a->>'eligible')::boolean and not (a->>'submitted')::boolean) end,
  'distinctRecipients',case when complete then (select count(distinct a->>'hash') from jsonb_array_elements(audience) a where (a->>'eligible')::boolean and not (a->>'submitted')::boolean) end,
  'invalidRecipients',case when complete then (select count(*) from jsonb_array_elements(audience) a where a->>'reason'='invalid_recipient' and not (a->>'submitted')::boolean) end,
  'blockedRecipients',case when complete then (select count(*) from jsonb_array_elements(audience) a where a->>'reason'='recipient_blocked' and not (a->>'submitted')::boolean) end);
end;$$;
create function public.submit_owned_event_notice(p_event_id uuid,p_purpose text,p_preview_token text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare preview jsonb;n private.event_notices;h private.event_change_state;a record;attempt uuid;revision_key text;
begin
 perform private.lock_owned_event_change_context(p_event_id);
 if p_request_id is null or p_preview_token is null then raise exception using errcode='22023',message='Notice review required';end if;
 select * into n from private.event_notices where request_id=p_request_id;
 if found then
  if n.event_id<>p_event_id or n.purpose<>p_purpose or n.requested_by<>auth.uid() or n.preview_token<>p_preview_token then raise exception using errcode='P0001',message='NOTICE_CONTEXT_CONFLICT';end if;
  return jsonb_build_object('noticeId',n.id,'queuedMessages',(select count(*) from private.event_notice_sources where notice_id=n.id));
 end if;
 preview:=public.preview_owned_event_notice(p_event_id,p_purpose);
 if preview->>'previewToken'<>p_preview_token or not (preview->>'canSend')::boolean then raise exception using errcode='P0001',message='NOTICE_CONTEXT_CONFLICT';end if;
 if (preview->>'eligibleMessages')::bigint=0 then raise exception using errcode='P0001',message='NOTICE_NO_AUDIENCE';end if;
 select * into h from private.event_change_state where event_id=p_event_id;
 revision_key:=case when p_purpose='event_change' then h.current_saved_snapshot_id::text else 'cancelled' end;
 insert into private.event_notices(event_id,purpose,snapshot_id,previous_snapshot_id,required_fields,preview_token,request_id,requested_by)
 values(p_event_id,p_purpose,h.current_saved_snapshot_id,h.previous_public_snapshot_id,h.required_fields,p_preview_token,p_request_id,auth.uid()) returning * into n;
 for a in select * from private.event_notice_audience(p_event_id,p_purpose,revision_key) where not already_submitted and (source->>'eligible')::boolean order by source_kind,source_id loop
  insert into private.ticket_email_outbox(purpose,order_id,registration_id)
  values(p_purpose,case when a.source_kind='paid_order' then a.source_id end,case when a.source_kind='free_registration' then a.source_id end) returning id into attempt;
  insert into private.event_notice_sources(notice_id,event_id,purpose,revision_key,source_kind,source_id,recipient_hash,attempt_id)
  values(n.id,p_event_id,p_purpose,revision_key,a.source_kind,a.source_id,a.source->>'recipientHash',attempt);
 end loop;
 if p_purpose='event_change' then perform private.mark_event_change_notice_submitted(p_event_id,h.current_saved_snapshot_id);end if;
 return jsonb_build_object('noticeId',n.id,'queuedMessages',(select count(*) from private.event_notice_sources where notice_id=n.id));
end;$$;

-- Exact submitted revision and recipient are rechecked before preparation AND dispatch.
create function private.event_notice_attempt_source(p_attempt_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare receipt private.event_notice_sources;n private.event_notices;h private.event_change_state;source jsonb;previous jsonb;
begin
 select * into receipt from private.event_notice_sources where attempt_id=p_attempt_id;
 if not found then return null;end if;
 select * into n from private.event_notices where id=receipt.notice_id;
 select * into h from private.event_change_state where event_id=n.event_id;
 if n.purpose='event_change' and (n.snapshot_id is distinct from h.current_saved_snapshot_id or n.snapshot_id is distinct from h.current_public_snapshot_id) then return null;end if;
 source:=private.event_notice_source(receipt.source_kind,receipt.source_id,n.purpose);
 if source is null or not (source->>'eligible')::boolean or source->>'recipientHash'<>receipt.recipient_hash then return null;end if;
 select facts into previous from private.event_change_snapshots where snapshot_id=n.previous_snapshot_id;
 return jsonb_build_object('email',source->>'email','recipientName',source->>'recipientName','eligible',true,
  'purpose',n.purpose,'detail',source->'detail','previousFacts',previous);
end;$$;

alter function public.server_prepare_ticket_email_context(uuid,uuid,text) rename to prepare_email_context_before_spec10;
alter function public.prepare_email_context_before_spec10(uuid,uuid,text) set schema private;
revoke all on function private.prepare_email_context_before_spec10(uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.server_prepare_ticket_email_context(p_attempt_id uuid,p_lease_id uuid,p_recovery_email text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q private.ticket_email_outbox;g private.ticket_email_grants;source jsonb;event_id uuid;at_time timestamptz:=clock_timestamp();scheduled_end timestamptz;
begin
 select s.event_id into event_id from private.event_notice_sources s where s.attempt_id=p_attempt_id;
 if event_id is null then return private.prepare_email_context_before_spec10(p_attempt_id,p_lease_id,p_recovery_email);end if;
 perform public.lock_event_ticketing_operation(event_id);
 select * into q from private.ticket_email_outbox where id=p_attempt_id and lease_id=p_lease_id and lease_until>at_time for update;
 if not found or q.state not in ('queued','unknown') or q.dispatch_stopped_reason is not null then return null;end if;
 source:=private.event_notice_attempt_source(q.id);
 if source is null then
  update private.ticket_email_outbox set state=case when first_possible_dispatch_at is null then 'suppressed' else state end,dispatch_stopped_reason='source_no_longer_eligible',lease_until=null,updated_at=at_time where id=q.id;
  return jsonb_build_object('kind','suppressed');
 end if;
 if q.grant_id is null then
  scheduled_end:=case when q.purpose='event_change' then (source->'detail'->'facts'->>'ends_at')::timestamptz end;
  insert into private.ticket_email_grants(purpose,prepared_at,expires_at,scheduled_end_at)
  values(q.purpose,at_time,case when q.purpose='event_cancellation' then at_time+interval '30 days' else scheduled_end+interval '24 hours' end,scheduled_end) returning * into g;
  insert into private.ticket_email_members(grant_id,position,order_id,registration_id) values(g.id,1,q.order_id,q.registration_id);
  update private.ticket_email_outbox set grant_id=g.id,recipient_hash=private.ticket_email_fingerprint(source->>'email'),updated_at=at_time where id=q.id returning * into q;
 else select * into g from private.ticket_email_grants where id=q.grant_id;end if;
 return jsonb_build_object('kind','ready','attemptId',q.id,'purpose',q.purpose,'grantId',g.id,'preparedAt',g.prepared_at,'expiresAt',g.expires_at,'scheduledEndAt',g.scheduled_end_at,'overflow',false,'sources',jsonb_build_array(source),'payload',q.payload);
end;$$;
alter function public.server_begin_ticket_email_dispatch(uuid,uuid) rename to begin_email_dispatch_before_spec10;
alter function public.begin_email_dispatch_before_spec10(uuid,uuid) set schema private;
revoke all on function private.begin_email_dispatch_before_spec10(uuid,uuid) from public,anon,authenticated,service_role;
create function public.server_begin_ticket_email_dispatch(p_attempt_id uuid,p_lease_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q private.ticket_email_outbox;g private.ticket_email_grants;event_id uuid;blocked text;at_time timestamptz:=clock_timestamp();
begin
 select s.event_id into event_id from private.event_notice_sources s where s.attempt_id=p_attempt_id;
 if event_id is null then return private.begin_email_dispatch_before_spec10(p_attempt_id,p_lease_id);end if;
 if not (select worker_enabled from private.ticket_email_settings where singleton) then return null;end if;
 perform public.lock_event_ticketing_operation(event_id);
 select * into q from private.ticket_email_outbox where id=p_attempt_id and lease_id=p_lease_id and lease_until>at_time+interval '20 seconds' for update;
 if not found or q.state not in ('queued','unknown') or q.payload is null or q.dispatch_stopped_reason is not null then return null;end if;
 select * into g from private.ticket_email_grants where id=q.grant_id;
 if q.dispatch_count>=6 or q.first_possible_dispatch_at<=at_time-interval '23 hours' then blocked:='retry_window_exhausted';
 elsif exists(select 1 from private.ticket_email_recipient_blocks where recipient_hash=q.recipient_hash) then blocked:='recipient_blocked';
 elsif g.id is null or g.purpose<>q.purpose then blocked:='access_unavailable';
 elsif g.expires_at<=at_time or g.revoked_at is not null then blocked:='access_expired';
 elsif private.event_notice_attempt_source(q.id) is null
  or not exists(select 1 from private.ticket_email_members where grant_id=g.id and position=1 and order_id is not distinct from q.order_id and registration_id is not distinct from q.registration_id)
  or (select count(*) from private.ticket_email_members where grant_id=g.id)<>1 then blocked:='source_no_longer_eligible';end if;
 if blocked is not null then
  update private.ticket_email_outbox set dispatch_stopped_reason=blocked,state=case when first_possible_dispatch_at is null then 'suppressed' else state end,lease_until=null,updated_at=at_time where id=q.id;
  return null;
 end if;
 -- Same Spec07 retry/idempotency boundary; provider request starts only after this commit.
 update private.ticket_email_outbox set state='sending',first_possible_dispatch_at=coalesce(first_possible_dispatch_at,at_time),dispatch_count=dispatch_count+1,updated_at=at_time where id=q.id returning * into q;
 return jsonb_build_object('attemptId',q.id,'grantId',q.grant_id,'payload',q.payload,'idempotencyKey','ticket-email/'||q.id::text,'leaseUntil',q.lease_until,'firstPossibleDispatchAt',q.first_possible_dispatch_at,'dispatchCount',q.dispatch_count);
end;$$;

create function public.get_owned_event_notice_status(p_event_id uuid,p_purpose text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.events where id=p_event_id and organizer_id=auth.uid()) then raise exception using errcode='42501',message='Event unavailable';end if;
 if p_purpose is null or p_purpose not in ('event_change','event_cancellation') then raise exception using errcode='22023',message='Invalid notice purpose';end if;
 with attempts as (
 select case when q.id is null then 'unknown'
  when q.first_possible_dispatch_at is null and q.state='queued' and private.event_notice_attempt_source(q.id) is null then 'suppressed'
  else q.state end state,q.observation
 from private.event_notice_sources r left join private.ticket_email_outbox q on q.id=r.attempt_id
 where r.event_id=p_event_id and r.purpose=p_purpose
 ) select jsonb_build_object('eventId',p_event_id,'purpose',p_purpose,'total',count(*),
  'queued',count(*) filter(where state='queued'),'sending',count(*) filter(where state='sending'),
  'accepted',count(*) filter(where state='accepted'),'failed',count(*) filter(where state='failed'),
  'unknown',count(*) filter(where state='unknown'),'suppressed',count(*) filter(where state='suppressed'),
  'observations',jsonb_build_object('sent',count(*) filter(where observation='sent'),'delivered',count(*) filter(where observation='delivered'),
   'delayed',count(*) filter(where observation='delivery_delayed'),'bounced',count(*) filter(where observation='bounced'),
   'complained',count(*) filter(where observation='complained'),'failed',count(*) filter(where observation='failed')))
 into result from attempts;
 return result;
end;$$;

create function public.server_read_event_status_access(p_token_hash text,p_ip_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g private.ticket_email_grants;m private.ticket_email_members;detail jsonb;
begin
 if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then return null;end if;
 if not private.consume_ticket_email_limits(jsonb_build_array(jsonb_build_object('lane','access_ip','hash',p_ip_hash))) then return jsonb_build_object('kind','rate_limited');end if;
 if p_token_hash is not null and p_token_hash ~ '^[0-9a-f]{64}$' then
  select * into g from private.ticket_email_grants where token_hash=p_token_hash and purpose in ('event_change','event_cancellation') and revoked_at is null and expires_at>clock_timestamp() and not overflow;
 end if;
 if g.id is null then
  if not private.consume_ticket_email_limits(jsonb_build_array(jsonb_build_object('lane','invalid_access_ip','hash',p_ip_hash))) then return jsonb_build_object('kind','rate_limited');end if;
  return null;
 end if;
 if not private.consume_ticket_email_limits(jsonb_build_array(jsonb_build_object('lane','verified_grant','hash',private.ticket_email_fingerprint(g.id::text)))) then return jsonb_build_object('kind','rate_limited');end if;
 if (select count(*) from private.ticket_email_members where grant_id=g.id)<>1 then return null;end if;
 select * into m from private.ticket_email_members where grant_id=g.id and position=1;
 detail:=private.event_notice_detail(case when m.order_id is null then 'free_registration' else 'paid_order' end,coalesce(m.order_id,m.registration_id));
 if detail is null then return null;end if;
 if g.purpose='event_cancellation' then detail:=detail||jsonb_build_object('canViewTickets',false);end if;
 return jsonb_build_object('kind','ready','purpose',g.purpose,'expiresAt',g.expires_at,'detail',detail);
end;$$;

revoke all on function private.protect_event_notice_receipt(),private.event_notice_detail(text,uuid),private.event_notice_source(text,uuid,text),private.event_notice_audience(uuid,text,text),private.event_notice_attempt_source(uuid),public.preview_owned_event_notice(uuid,text),public.submit_owned_event_notice(uuid,text,text,uuid),public.get_owned_event_notice_status(uuid,text),public.server_read_event_status_access(text,text),public.server_prepare_ticket_email_context(uuid,uuid,text),public.server_begin_ticket_email_dispatch(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.preview_owned_event_notice(uuid,text),public.submit_owned_event_notice(uuid,text,text,uuid),public.get_owned_event_notice_status(uuid,text) to authenticated;
grant execute on function public.server_read_event_status_access(text,text),public.server_prepare_ticket_email_context(uuid,uuid,text),public.server_begin_ticket_email_dispatch(uuid,uuid) to service_role;

-- Saving newer facts invalidates previously reviewed, never-dispatched work.
-- This hook is on facts identity only: canonical cancellation cannot depend on delivery.
create function private.supersede_event_change_notices() returns trigger
language plpgsql security definer set search_path='' as $$
declare fields text[];
begin
 if new.current_saved_snapshot_id is not distinct from old.current_saved_snapshot_id then return new;end if;
 select coalesce(array_agg(distinct f),'{}') into fields
 from private.event_notices n join private.event_notice_sources r on r.notice_id=n.id
 join private.ticket_email_outbox q on q.id=r.attempt_id
 cross join lateral unnest(n.required_fields) f
 where n.event_id=new.event_id and n.purpose='event_change' and q.first_possible_dispatch_at is null and q.state='queued';
 if cardinality(fields)>0 then
  new.notice_required:=true;new.required_snapshot_id:=new.current_saved_snapshot_id;
  select array_agg(distinct f order by f) into new.required_fields from unnest(new.required_fields||fields) f;
 end if;
 update private.ticket_email_outbox q set state='suppressed',dispatch_stopped_reason='superseded_event_revision',lease_until=null,updated_at=clock_timestamp()
 from private.event_notice_sources r where r.attempt_id=q.id and r.event_id=new.event_id and r.purpose='event_change'
 and r.revision_key<>new.current_saved_snapshot_id::text and q.first_possible_dispatch_at is null and q.state='queued';
 return new;
end;$$;
create trigger event_change_notice_superseded before update of current_saved_snapshot_id on private.event_change_state
 for each row execute function private.supersede_event_change_notices();
revoke all on function private.supersede_event_change_notices() from public,anon,authenticated,service_role;

-- Change grants reuse admission access only while their one source independently qualifies.
create or replace function public.server_read_ticket_email_access(p_token_hash text,p_ip_hash text,p_page integer default 0,p_member integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g private.ticket_email_grants; m private.ticket_email_members; proof text; projection jsonb; entries jsonb; total integer;
begin
 if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then return null; end if;
 -- Malformed hashes/selectors still spend aggregate and invalid-IP capacity, with no grant lookup.
 if not private.consume_ticket_email_limits(jsonb_build_array(jsonb_build_object('lane','access_ip','hash',p_ip_hash))) then return jsonb_build_object('kind','rate_limited'); end if;
 if p_token_hash is not null and p_token_hash ~ '^[0-9a-f]{64}$' and p_page is not null and p_page between 0 and 9 and (p_member is null or p_member between 1 and 200) then
  select * into g from private.ticket_email_grants where token_hash=p_token_hash and purpose in ('initial','resend','recovery','event_change') and revoked_at is null and expires_at>clock_timestamp() and not overflow;
 end if;
 if g.id is null then
  if not private.consume_ticket_email_limits(jsonb_build_array(jsonb_build_object('lane','invalid_access_ip','hash',p_ip_hash))) then return jsonb_build_object('kind','rate_limited'); end if;
  return null;
 end if;
 if not private.consume_ticket_email_limits(jsonb_build_array(
  jsonb_build_object('lane','verified_grant','hash',private.ticket_email_fingerprint(g.id::text)))) then return jsonb_build_object('kind','rate_limited'); end if;
 if g.purpose='event_change' and ((select count(*) from private.ticket_email_members where grant_id=g.id)<>1 or exists(select 1 from private.ticket_email_members candidate where candidate.grant_id=g.id and not coalesce((private.event_notice_detail(case when candidate.order_id is null then 'free_registration' else 'paid_order' end,coalesce(candidate.order_id,candidate.registration_id))->>'canViewTickets')::boolean,false))) then return null;end if;
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

