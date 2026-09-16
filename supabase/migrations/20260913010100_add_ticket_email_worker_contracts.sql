alter table private.ticket_email_grants add column overflow boolean not null default false;
create index ticket_email_paid_recipient on public.orders(lower(btrim(buyer_email))) where status='paid';
create index ticket_email_free_recipient on public.free_registrations(email) where status='confirmed';

create function public.server_claim_ticket_email() returns jsonb
language plpgsql security definer set search_path='' as $$
declare q private.ticket_email_outbox; token uuid:=gen_random_uuid(); at_time timestamptz:=clock_timestamp();
begin
 if not (select worker_enabled from private.ticket_email_settings where singleton) then return null; end if;
 -- Exhaustion stops dispatch, never rewrites an uncertain transport outcome as failure.
 update private.ticket_email_outbox set state=case when state='sending' then 'unknown' else state end,
 dispatch_stopped_reason='retry_window_exhausted',updated_at=at_time
 where state in ('unknown','sending') and dispatch_stopped_reason is null and (lease_until is null or lease_until<=at_time)
 and (dispatch_count>=6 or first_possible_dispatch_at<=at_time-interval '23 hours');
 select * into q from private.ticket_email_outbox
 where state in ('queued','unknown','sending') and dispatch_stopped_reason is null
 and next_attempt_at<=at_time and (lease_until is null or lease_until<=at_time)
 and dispatch_count<6 and (first_possible_dispatch_at is null or first_possible_dispatch_at>at_time-interval '23 hours')
 order by next_attempt_at,id for update skip locked limit 1;
 if not found then return null; end if;
 update private.ticket_email_outbox set lease_id=token,lease_until=at_time+interval '2 minutes',
 state=case when state='sending' then 'unknown' else state end,updated_at=at_time where id=q.id returning * into q;
 return to_jsonb(q);
end;
$$;

create function public.server_prepare_ticket_email_context(p_attempt_id uuid,p_lease_id uuid,p_recovery_email text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q private.ticket_email_outbox; g private.ticket_email_grants; source jsonb; sources jsonb:='[]'; item record; at_time timestamptz:=clock_timestamp(); n integer:=0; over_limit boolean:=false;
begin
 select * into q from private.ticket_email_outbox where id=p_attempt_id and lease_id=p_lease_id and lease_until>at_time for update;
 if not found then return null; end if;
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

create function private.ticket_email_envelope_valid(p_value jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(p_value)='object' and (select array_agg(key order by key) from jsonb_object_keys(p_value) k(key))=array['ciphertext','keyId','nonce','version']::text[]
 and p_value->'version'='1'::jsonb and jsonb_typeof(p_value->'keyId')='string' and (p_value->>'keyId') ~ '^[A-Za-z0-9_-]{1,128}$'
 and jsonb_typeof(p_value->'nonce')='string' and (p_value->>'nonce') ~ '^[A-Za-z0-9_-]{16}$'
 and jsonb_typeof(p_value->'ciphertext')='string' and (p_value->>'ciphertext') ~ '^[A-Za-z0-9_-]+$'
 and octet_length(p_value::text)<360000,false);
$$;
create function public.server_save_ticket_email_payload(p_attempt_id uuid,p_lease_id uuid,p_token_hash text,p_payload jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare q private.ticket_email_outbox;
begin
 if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or not private.ticket_email_envelope_valid(p_payload) then raise exception 'Invalid email preparation'; end if;
 select * into q from private.ticket_email_outbox where id=p_attempt_id and lease_id=p_lease_id and lease_until>clock_timestamp() and state='queued' and dispatch_stopped_reason is null for update;
 if not found or q.grant_id is null or q.payload is not null then return false; end if;
 update private.ticket_email_grants set token_hash=p_token_hash where id=q.grant_id and token_hash is null and expires_at>clock_timestamp() and revoked_at is null;
 if not found then return false; end if;
 update private.ticket_email_outbox set payload=p_payload,updated_at=clock_timestamp() where id=q.id;
 return true;
end;
$$;

create function public.server_begin_ticket_email_dispatch(p_attempt_id uuid,p_lease_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q private.ticket_email_outbox; g private.ticket_email_grants; blocked text; at_time timestamptz:=clock_timestamp();
begin
 if not (select worker_enabled from private.ticket_email_settings where singleton) then return null; end if;
 select * into q from private.ticket_email_outbox where id=p_attempt_id and lease_id=p_lease_id and lease_until>at_time+interval '20 seconds' for update;
 if not found or q.state not in ('queued','unknown') or q.payload is null or q.dispatch_stopped_reason is not null then return null; end if;
 select * into g from private.ticket_email_grants where id=q.grant_id;
 if q.dispatch_count>=6 or q.first_possible_dispatch_at<=at_time-interval '23 hours' then blocked:='retry_window_exhausted';
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

create function public.server_finish_ticket_email_dispatch(p_attempt_id uuid,p_lease_id uuid,p_outcome text,p_provider_id text default null) returns boolean
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
 update private.ticket_email_outbox set state=p_outcome,provider_id=p_provider_id,
 next_attempt_at=at_time+make_interval(secs=>case dispatch_count when 1 then 60 when 2 then 300 when 3 then 1800 when 4 then 7200 else 21600 end),
 dispatch_stopped_reason=case when p_outcome='unknown' and (dispatch_count>=6 or first_possible_dispatch_at<=at_time-interval '23 hours') then 'retry_window_exhausted' else dispatch_stopped_reason end,
 lease_until=null,updated_at=at_time where id=q.id;
 return true;
end;
$$;

create function public.server_stop_ticket_email(p_attempt_id uuid,p_lease_id uuid,p_reason text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if p_reason is null or p_reason not in ('configuration_unavailable','support_unconfigured','payload_unreadable','invalid_projection') then raise exception 'Invalid delivery stop'; end if;
 update private.ticket_email_outbox set state=case when first_possible_dispatch_at is null then 'suppressed' when state='sending' then 'unknown' else state end,
 dispatch_stopped_reason=p_reason,lease_until=null,updated_at=clock_timestamp()
 where id=p_attempt_id and lease_id=p_lease_id and lease_until>clock_timestamp();
 return found;
end;
$$;

create function public.server_observe_ticket_email(p_webhook_id text,p_attempt_id uuid,p_provider_id text,p_kind text,p_observed_at timestamptz) returns boolean
language plpgsql security definer set search_path='' as $$
declare q private.ticket_email_outbox;
begin
 if p_webhook_id is null or char_length(p_webhook_id) not between 1 and 200 or p_provider_id is null or char_length(p_provider_id) not between 1 and 200 or p_kind is null or p_kind not in ('sent','delivered','delivery_delayed','bounced','complained','failed') or p_observed_at is null or not isfinite(p_observed_at) then return false; end if;
 select * into q from private.ticket_email_outbox where id=p_attempt_id for update;
 if not found or q.first_possible_dispatch_at is null or (q.provider_id is not null and q.provider_id<>p_provider_id) then return false; end if;
 if exists(select 1 from private.ticket_email_observations where webhook_id=p_webhook_id) then
  return exists(select 1 from private.ticket_email_observations where webhook_id=p_webhook_id and attempt_id=q.id and provider_id=p_provider_id and kind=p_kind and observed_at=p_observed_at);
 end if;
 insert into private.ticket_email_observations(webhook_id,attempt_id,provider_id,kind,observed_at) values(p_webhook_id,q.id,p_provider_id,p_kind,p_observed_at);
 update private.ticket_email_outbox set state='accepted',provider_id=p_provider_id,updated_at=clock_timestamp(),
 observation=(select kind from private.ticket_email_observations where attempt_id=q.id
  order by case kind when 'complained' then 6 when 'bounced' then 5 when 'failed' then 4 when 'delivered' then 3 when 'delivery_delayed' then 2 else 1 end desc,observed_at desc limit 1)
 where id=q.id;
 return true;
end;
$$;

revoke all on function private.ticket_email_envelope_valid(jsonb),public.server_claim_ticket_email(),public.server_prepare_ticket_email_context(uuid,uuid,text),public.server_save_ticket_email_payload(uuid,uuid,text,jsonb),public.server_begin_ticket_email_dispatch(uuid,uuid),public.server_finish_ticket_email_dispatch(uuid,uuid,text,text),public.server_stop_ticket_email(uuid,uuid,text),public.server_observe_ticket_email(text,uuid,text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.server_claim_ticket_email(),public.server_prepare_ticket_email_context(uuid,uuid,text),public.server_save_ticket_email_payload(uuid,uuid,text,jsonb),public.server_begin_ticket_email_dispatch(uuid,uuid),public.server_finish_ticket_email_dispatch(uuid,uuid,text,text),public.server_stop_ticket_email(uuid,uuid,text),public.server_observe_ticket_email(text,uuid,text,text,timestamptz) to service_role;
