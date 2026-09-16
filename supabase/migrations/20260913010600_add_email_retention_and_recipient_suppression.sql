-- Private delivery metadata cleanup never removes live access or ticket history.
alter table private.ticket_email_outbox add column recipient_hash text check(recipient_hash ~ '^[0-9a-f]{64}$');
alter table private.ticket_email_outbox add column accepted_at timestamptz;
alter table private.ticket_email_outbox add column payload_purged_at timestamptz;
update private.ticket_email_outbox set accepted_at=updated_at where state='accepted';
alter table private.ticket_email_outbox drop constraint ticket_email_outbox_check;
alter table private.ticket_email_outbox add constraint ticket_email_outbox_source_check check(
 (purpose='recovery' and num_nonnulls(order_id,registration_id)=0 and (recovery_payload is not null or payload_purged_at is not null) and request_id is not null)
 or (purpose<>'recovery' and num_nonnulls(order_id,registration_id)=1 and recovery_payload is null));
create table private.ticket_email_recipient_blocks (
 recipient_hash text primary key check(recipient_hash ~ '^[0-9a-f]{64}$'),
 reason text not null check(reason in ('bounced','complained')),
 attempt_id uuid not null references private.ticket_email_outbox(id) on delete restrict,
 recorded_at timestamptz not null default clock_timestamp()
);
revoke all on private.ticket_email_recipient_blocks from public,anon,authenticated,service_role;


create or replace function private.protect_ticket_email_ledger() returns trigger language plpgsql set search_path='' as $$
declare purging boolean;
begin
 if TG_TABLE_NAME='ticket_email_outbox' then
  purging:=old.payload_purged_at is null and new.payload_purged_at is not null and new.payload is null and new.recovery_payload is null
   and ((old.state='accepted' and old.first_possible_dispatch_at<=clock_timestamp()-interval '23 hours')
    or old.state in ('failed','suppressed')
    or (old.state='unknown' and old.dispatch_stopped_reason is not null and old.first_possible_dispatch_at<=clock_timestamp()-interval '90 days'));
  if (old.payload_purged_at is not null and row(new.payload,new.recovery_payload,new.payload_purged_at) is distinct from row(old.payload,old.recovery_payload,old.payload_purged_at))
   or (old.recipient_hash is not null and new.recipient_hash is distinct from old.recipient_hash)
   or (old.accepted_at is not null and new.accepted_at is distinct from old.accepted_at)
   or (new.payload_purged_at is distinct from old.payload_purged_at and not purging) then raise exception 'Immutable ticket email record'; end if;
  if (old.payload is not null and new.payload is distinct from old.payload and not purging)
   or (old.grant_id is not null and new.grant_id is distinct from old.grant_id)
   or (new.recovery_payload is distinct from old.recovery_payload and not purging)
   or row(new.id,new.purpose,new.order_id,new.registration_id,new.request_id,new.requested_by) is distinct from row(old.id,old.purpose,old.order_id,old.registration_id,old.request_id,old.requested_by)
   or (old.first_possible_dispatch_at is not null and new.first_possible_dispatch_at is distinct from old.first_possible_dispatch_at)
   or new.dispatch_count<old.dispatch_count
   or (old.provider_id is not null and new.provider_id is distinct from old.provider_id) then
   raise exception 'Immutable ticket email record';
  end if;
 elsif TG_TABLE_NAME='ticket_email_grants' then
  if TG_OP='DELETE' then
   if old.expires_at>clock_timestamp() then raise exception 'Unexpired access must be retained'; end if;
   return old;
  end if;
  if row(new.id,new.purpose,new.prepared_at,new.expires_at,new.scheduled_end_at,new.overflow) is distinct from row(old.id,old.purpose,old.prepared_at,old.expires_at,old.scheduled_end_at,old.overflow)
   or (old.token_hash is not null and new.token_hash is distinct from old.token_hash)
   or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then raise exception 'Immutable email grant'; end if;
 elsif TG_TABLE_NAME='ticket_email_members' then
  if TG_OP='INSERT' then
   if exists(select 1 from private.ticket_email_grants where id=new.grant_id and token_hash is not null) then raise exception 'Immutable email membership'; end if;
   return new;
  end if;
  if TG_OP='UPDATE' then raise exception 'Immutable email membership'; end if;
  if exists(select 1 from private.ticket_email_grants where id=old.grant_id and expires_at>clock_timestamp()) then raise exception 'Unexpired access must be retained'; end if;
  return old;
 end if;
 return new;
end;
$$;

drop trigger ticket_email_members_immutable on private.ticket_email_members;
create trigger ticket_email_members_immutable before insert or update or delete on private.ticket_email_members for each row execute function private.protect_ticket_email_ledger();

create or replace function private.ticket_email_source(p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare o public.orders; r public.free_registrations; e public.events; reason text; recipient text; label text; qty integer;
begin
 if p_kind='paid_order' then
  select * into o from public.orders where id=p_id;
  if not found then return null; end if;
  select * into e from public.events where id=o.event_id;
  recipient:=lower(btrim(o.buyer_email)); label:=o.buyer_name; qty:=o.quantity;
  reason:=case when not private.organizer_order_coherent(o.id) then 'unavailable'
    when private.organizer_refund_state(o)<>'available' then 'financially_unresolved'
    when o.status<>'paid' then 'inactive' else null end;
 elsif p_kind='free_registration' then
  select * into r from public.free_registrations where id=p_id;
  if not found then return null; end if;
  select * into e from public.events where id=r.event_id;
  recipient:=r.email; label:=r.name; qty:=r.quantity;
  reason:=case when not private.free_registration_is_coherent(r.id) then 'unavailable' when r.status<>'confirmed' then 'inactive' else null end;
 else return null;
 end if;
 if e.status<>'published' then reason:='inactive';
 elsif not isfinite(e.ends_at) or e.ends_at<=clock_timestamp() or e.ends_at<=e.starts_at then reason:='ended';
 elsif not exists(select 1 from public.tickets t where t.status='valid' and ((p_kind='paid_order' and t.order_id=p_id) or (p_kind='free_registration' and t.registration_id=p_id))) then reason:='no_valid_tickets';
 elsif recipient is null or char_length(recipient)>320 or recipient !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' or octet_length(recipient)<>char_length(recipient) then reason:='invalid_recipient'; end if;
 if recipient is not null and exists(select 1 from private.ticket_email_recipient_blocks where recipient_hash=private.ticket_email_fingerprint(recipient)) then reason:='recipient_blocked'; end if;
 return jsonb_build_object('sourceKind',p_kind,'sourceId',p_id,'eventId',e.id,'organizerId',e.organizer_id,
 'email',recipient,'recipientName',label,'quantity',qty,'eventName',e.title,'startsAt',e.starts_at,'endsAt',e.ends_at,
 'timezone',e.timezone,'venueName',e.venue_name,'eligible',reason is null,'reason',reason,
 'admissions',(select jsonb_agg(jsonb_build_object('admissionLabel',t.admission_label,'position',t.position,'status',t.status,'usedAt',t.used_at) order by t.position)
  from (select admission_label,status,used_at,row_number() over(order by order_item_id,unit_sequence) as position
   from public.tickets where (p_kind='paid_order' and order_id=p_id) or (p_kind='free_registration' and registration_id=p_id)) t));
end;
$$;

create or replace function public.server_prepare_ticket_email_context(p_attempt_id uuid,p_lease_id uuid,p_recovery_email text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q private.ticket_email_outbox; g private.ticket_email_grants; source jsonb; sources jsonb:='[]'; item record; at_time timestamptz:=clock_timestamp(); n integer:=0; over_limit boolean:=false;
begin
 select * into q from private.ticket_email_outbox where id=p_attempt_id and lease_id=p_lease_id and lease_until>at_time for update;
 if not found then return null; end if;
 if q.recipient_hash is null then
  update private.ticket_email_outbox set recipient_hash=private.ticket_email_fingerprint(case when q.purpose='recovery' then p_recovery_email else private.ticket_email_source(case when q.order_id is null then 'free_registration' else 'paid_order' end,coalesce(q.order_id,q.registration_id))->>'email' end) where id=q.id;
 end if;
 if q.grant_id is null then
  if q.purpose='recovery' then
   if p_recovery_email is null or p_recovery_email<>lower(btrim(p_recovery_email)) or length(p_recovery_email)>320 then raise exception 'Invalid recovery context'; end if;
   -- This transaction is the sole membership snapshot. Later purchases are never added.
   for item in select x.kind,x.id from (
    select 'paid_order'::text kind,o.id from public.orders o where lower(btrim(o.buyer_email))=p_recovery_email and o.status='paid'
    union all select 'free_registration',r.id from public.free_registrations r where r.email=p_recovery_email and r.status='confirmed'
   ) x where (private.ticket_email_source(x.kind,x.id)->>'eligible')::boolean order by x.kind,x.id limit 201 loop
    n:=n+1;
    if n>200 then over_limit:=true; exit; end if;
    sources:=sources||jsonb_build_array(jsonb_build_object('kind',item.kind,'id',item.id));
   end loop;
   if n=0 then
    update private.ticket_email_outbox set state='suppressed',dispatch_stopped_reason='no_matching_sources',lease_until=null,updated_at=at_time where id=q.id;
    return jsonb_build_object('kind','suppressed');
   end if;
   insert into private.ticket_email_grants(purpose,prepared_at,expires_at,scheduled_end_at,overflow) values(q.purpose,at_time,at_time+interval '24 hours',null,over_limit) returning * into g;
   if not over_limit then
    insert into private.ticket_email_members(grant_id,position,order_id,registration_id)
    select g.id,ordinality::integer,case when value->>'kind'='paid_order' then (value->>'id')::uuid end,
    case when value->>'kind'='free_registration' then (value->>'id')::uuid end from jsonb_array_elements(sources) with ordinality;
   end if;
  else
   source:=private.ticket_email_source(case when q.order_id is null then 'free_registration' else 'paid_order' end,coalesce(q.order_id,q.registration_id));
   if source is null or not (source->>'eligible')::boolean then
    update private.ticket_email_outbox set state='suppressed',dispatch_stopped_reason=coalesce(source->>'reason','unavailable'),lease_until=null,updated_at=at_time where id=q.id;
    return jsonb_build_object('kind','suppressed');
   end if;
   insert into private.ticket_email_grants(purpose,prepared_at,expires_at,scheduled_end_at) values(q.purpose,at_time,(source->>'endsAt')::timestamptz+interval '24 hours',(source->>'endsAt')::timestamptz) returning * into g;
   insert into private.ticket_email_members(grant_id,position,order_id,registration_id) values(g.id,1,q.order_id,q.registration_id);
  end if;
  update private.ticket_email_outbox set grant_id=g.id,updated_at=at_time where id=q.id returning * into q;
 else select * into g from private.ticket_email_grants where id=q.grant_id;
 end if;
 select coalesce(jsonb_agg(private.ticket_email_source(case when m.order_id is null then 'free_registration' else 'paid_order' end,coalesce(m.order_id,m.registration_id)) order by m.position),'[]') into sources from private.ticket_email_members m where grant_id=g.id;
 return jsonb_build_object('kind','ready','attemptId',q.id,'purpose',q.purpose,'grantId',g.id,'preparedAt',g.prepared_at,
 'expiresAt',g.expires_at,'scheduledEndAt',g.scheduled_end_at,'overflow',g.overflow,'sources',sources,'payload',q.payload);
end;
$$;

-- Recipient suppression applies to every prepared attempt, including memberless overflow.
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
 elsif g.expires_at<=at_time or g.revoked_at is not null then blocked:='access_expired';
 elsif not g.overflow and exists(select 1 from private.ticket_email_members m where m.grant_id=g.id
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

create or replace function public.server_finish_ticket_email_dispatch(p_attempt_id uuid,p_lease_id uuid,p_outcome text,p_provider_id text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare q private.ticket_email_outbox; at_time timestamptz:=clock_timestamp();
begin
 if p_outcome is null or p_outcome not in ('accepted','failed','unknown') or (p_outcome='accepted' and (p_provider_id is null or char_length(p_provider_id) not between 1 and 200)) or (p_outcome<>'accepted' and p_provider_id is not null) then raise exception 'Invalid delivery result'; end if;
 select * into q from private.ticket_email_outbox where id=p_attempt_id and lease_id=p_lease_id and lease_until>at_time for update;
 if not found or q.first_possible_dispatch_at is null then return false; end if;
 if q.provider_id is not null and p_provider_id is not null and q.provider_id<>p_provider_id then return false; end if;
 if q.state='accepted' then
  update private.ticket_email_outbox set lease_until=null,updated_at=at_time where id=q.id;
  return true; -- Earlier verified webhook evidence wins over a lost/rejected response.
 end if;
 if q.state<>'sending' then return false; end if;
 -- A retry rejection cannot prove an earlier uncertain dispatch was rejected.
 if p_outcome='failed' and q.dispatch_count>1 then p_outcome:='unknown'; end if;
 update private.ticket_email_outbox set state=p_outcome,provider_id=p_provider_id,accepted_at=case when p_outcome='accepted' then coalesce(accepted_at,at_time) else accepted_at end,
 next_attempt_at=at_time+make_interval(secs=>case dispatch_count when 1 then 60 when 2 then 300 when 3 then 1800 when 4 then 7200 else 21600 end),
 dispatch_stopped_reason=case when p_outcome='unknown' and (dispatch_count>=6 or first_possible_dispatch_at<=at_time-interval '23 hours') then 'retry_window_exhausted' else dispatch_stopped_reason end,
 lease_until=null,updated_at=at_time where id=q.id;
 return true;
end;
$$;

create or replace function public.server_observe_ticket_email(p_webhook_id text,p_attempt_id uuid,p_provider_id text,p_kind text,p_observed_at timestamptz) returns boolean
language plpgsql security definer set search_path='' as $$
declare q private.ticket_email_outbox; recipient text;
begin
 if p_webhook_id is null or char_length(p_webhook_id) not between 1 and 200 or p_provider_id is null or char_length(p_provider_id) not between 1 and 200 or p_kind is null or p_kind not in ('sent','delivered','delivery_delayed','bounced','complained','failed') or p_observed_at is null or not isfinite(p_observed_at) then return false; end if;
 select * into q from private.ticket_email_outbox where id=p_attempt_id for update;
 if not found or q.first_possible_dispatch_at is null or (q.provider_id is not null and q.provider_id<>p_provider_id) then return false; end if;
 if exists(select 1 from private.ticket_email_observations where webhook_id=p_webhook_id) then
  return exists(select 1 from private.ticket_email_observations where webhook_id=p_webhook_id and attempt_id=q.id and provider_id=p_provider_id and kind=p_kind and observed_at=p_observed_at);
 end if;
 insert into private.ticket_email_observations(webhook_id,attempt_id,provider_id,kind,observed_at) values(p_webhook_id,q.id,p_provider_id,p_kind,p_observed_at);
 update private.ticket_email_outbox set state='accepted',provider_id=p_provider_id,accepted_at=coalesce(accepted_at,clock_timestamp()),updated_at=clock_timestamp(),
 observation=(select kind from private.ticket_email_observations where attempt_id=q.id
  order by case kind when 'complained' then 6 when 'bounced' then 5 when 'failed' then 4 when 'delivered' then 3 when 'delivery_delayed' then 2 else 1 end desc,observed_at desc limit 1)
 where id=q.id;
 if p_kind in ('bounced','complained') then
  recipient:=q.recipient_hash;
  if recipient is null and num_nonnulls(q.order_id,q.registration_id)=1 then
   recipient:=private.ticket_email_fingerprint(private.ticket_email_source(case when q.order_id is null then 'free_registration' else 'paid_order' end,coalesce(q.order_id,q.registration_id))->>'email');
  end if;
  if recipient is not null then
   insert into private.ticket_email_recipient_blocks(recipient_hash,reason,attempt_id) values(recipient,p_kind,q.id)
   on conflict(recipient_hash) do update set reason=case when private.ticket_email_recipient_blocks.reason='complained' then 'complained' else excluded.reason end,attempt_id=excluded.attempt_id,recorded_at=clock_timestamp();
  end if;
 end if;
 return true;
end;
$$;

create or replace function public.server_prune_ticket_email_history() returns bigint
language plpgsql security definer set search_path='' as $$
declare removed bigint;
begin
 update private.ticket_email_outbox set payload=null,recovery_payload=null,payload_purged_at=clock_timestamp()
 where payload_purged_at is null and (payload is not null or recovery_payload is not null)
 and ((state='accepted' and first_possible_dispatch_at<=clock_timestamp()-interval '23 hours')
  or state in ('failed','suppressed')
  or (state='unknown' and dispatch_stopped_reason is not null and first_possible_dispatch_at<=clock_timestamp()-interval '90 days'));
 delete from private.ticket_email_observations where attempt_id in (
  select q.id from private.ticket_email_outbox q left join private.ticket_email_grants g on g.id=q.grant_id
  where q.updated_at<clock_timestamp()-interval '90 days' and (g.id is null or g.expires_at<=clock_timestamp())
  and not exists(select 1 from private.ticket_email_recipient_blocks b where b.attempt_id=q.id)
  and (q.state in ('accepted','failed','suppressed') or q.dispatch_stopped_reason is not null));
 delete from private.ticket_email_outbox q where q.updated_at<clock_timestamp()-interval '90 days'
  and (q.grant_id is null or exists(select 1 from private.ticket_email_grants g where g.id=q.grant_id and g.expires_at<=clock_timestamp()))
  and not exists(select 1 from private.ticket_email_recipient_blocks b where b.attempt_id=q.id)
  and (q.state in ('accepted','failed','suppressed') or q.dispatch_stopped_reason is not null);
 get diagnostics removed=row_count;
 delete from private.ticket_email_grants g where expires_at<=clock_timestamp() and not exists(select 1 from private.ticket_email_outbox q where q.grant_id=g.id);
 delete from private.ticket_email_rate_events where at<clock_timestamp()-interval '2 days';
 return removed;
end;
$$;

-- Support operations can remove a verified recipient block without changing its destination.
-- This RPC is service-only and is not invoked automatically or by buyer/organizer UI.
create function public.server_clear_ticket_email_recipient_block(p_source_kind text,p_source_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare recipient text;
begin
 recipient:=private.ticket_email_source(p_source_kind,p_source_id)->>'email';
 if recipient is null then return false; end if;
 delete from private.ticket_email_recipient_blocks where recipient_hash=private.ticket_email_fingerprint(recipient);
 return found;
end;
$$;
revoke all on function public.server_clear_ticket_email_recipient_block(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.server_clear_ticket_email_recipient_block(text,uuid) to service_role;

