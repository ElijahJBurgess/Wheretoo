-- Dedicated operational demand. Nothing here reserves tickets or activates a scheduler.
create table private.waitlist_settings (
 singleton boolean primary key default true check(singleton),
 accepting_joins boolean not null default false,observer_enabled boolean not null default false,delivery_enabled boolean not null default false,
 sender_email text,reply_to text,app_origin text,worker_healthy_at timestamptz,health_seconds integer not null default 300 check(health_seconds between 30 and 3600),
 capacity_minute integer check(capacity_minute>0),capacity_day integer check(capacity_day>0),capacity_month integer check(capacity_month>0),
 email_hour integer not null default 3 check(email_hour>0),email_day integer not null default 10 check(email_day>0),
 ip_hour integer not null default 60 check(ip_hour>0),ip_day integer not null default 300 check(ip_day>0),
 restock_day integer not null default 3 check(restock_day>0),page_size integer not null default 100 check(page_size between 1 and 100),
 tier_batch integer not null default 25 check(tier_batch between 1 and 25)
);
insert into private.waitlist_settings(singleton) values(true);
create table private.waitlist_enrollments (
 id uuid primary key default gen_random_uuid(),event_id uuid not null references public.events(id),tier_id uuid not null references public.ticket_tiers(id),
 name text,normalized_email text,recipient_hash text not null check(recipient_hash ~ '^[0-9a-f]{64}$'),
 lifecycle text not null default 'active' check(lifecycle in ('active','purchased','removed')),
 joined_at timestamptz not null default clock_timestamp(),purchased_at timestamptz,qualifying_order_id uuid references public.orders(id),
 removed_at timestamptz,removed_reason text,operational_closed_at timestamptz,closed_reason text,
 last_notified_at timestamptz,last_notified_cycle bigint,pii_purged_at timestamptz,
 check((pii_purged_at is null and name is not null and normalized_email is not null and char_length(name) between 1 and 120
 and name=btrim(name) and name !~ '[[:cntrl:]]' and private.organizer_message_email_valid(normalized_email))
 or (pii_purged_at is not null and name is null and normalized_email is null)),
 check((lifecycle='purchased')=(purchased_at is not null)),check((lifecycle='removed')=(removed_at is not null))
);
create unique index waitlist_active_email on private.waitlist_enrollments(tier_id,normalized_email) where lifecycle='active' and operational_closed_at is null;
create index waitlist_tier_scan on private.waitlist_enrollments(tier_id,id) where lifecycle='active' and operational_closed_at is null;
create index waitlist_owner_page on private.waitlist_enrollments(event_id,tier_id,joined_at desc,id desc);
create table private.waitlist_tier_state (
 tier_id uuid primary key references public.ticket_tiers(id),event_id uuid not null references public.events(id),
 observed_state text not null check(observed_state in ('sold_out','available','closed','paused')),
 cycle bigint not null default 0 check(cycle>=0),observed_at timestamptz not null default clock_timestamp(),transitioned_at timestamptz not null default clock_timestamp(),
 next_check_at timestamptz not null default clock_timestamp(),scan_cursor uuid,closed_through timestamptz
);
create index waitlist_due on private.waitlist_tier_state(next_check_at,tier_id);
create table private.waitlist_availability_cycles (
 id uuid primary key default gen_random_uuid(),tier_id uuid not null references private.waitlist_tier_state(tier_id),
 sequence bigint not null check(sequence>0),opened_at timestamptz not null default clock_timestamp(),cursor_id uuid,completed_at timestamptz,
 unique(tier_id,sequence)
);
create table private.waitlist_deliveries (
 id uuid primary key default gen_random_uuid(),enrollment_id uuid not null references private.waitlist_enrollments(id),
 purpose text not null check(purpose in ('confirmation','restock')),cycle_id uuid references private.waitlist_availability_cycles(id),
 state text not null default 'queued' check(state in ('queued','sending','accepted','failed','unknown','suppressed')),
 payload jsonb, facts_digest text,provider_id text unique,lease_id uuid,lease_until timestamptz,
 first_possible_dispatch_at timestamptz,dispatch_count integer not null default 0 check(dispatch_count between 0 and 6),
 next_attempt_at timestamptz not null default clock_timestamp(),dispatch_stopped_reason text,observation text,
 accepted_at timestamptz,created_at timestamptz not null default clock_timestamp(),payload_purged_at timestamptz,
 check((purpose='confirmation')=(cycle_id is null)),check(payload is null or private.ticket_email_envelope_valid(payload)),
 check((first_possible_dispatch_at is null and dispatch_count=0) or (first_possible_dispatch_at is not null and dispatch_count>0))
);
create unique index waitlist_confirmation_once on private.waitlist_deliveries(enrollment_id) where purpose='confirmation';
create unique index waitlist_restock_once on private.waitlist_deliveries(enrollment_id,cycle_id) where purpose='restock';
create index waitlist_ready on private.waitlist_deliveries(next_attempt_at,id) where state in ('queued','unknown','sending') and dispatch_stopped_reason is null;
create index waitlist_notification_budget on private.waitlist_deliveries(enrollment_id,first_possible_dispatch_at) where purpose='restock';
create table private.waitlist_leave_tokens (
 token_hash text primary key check(token_hash ~ '^[0-9a-f]{64}$'),enrollment_id uuid not null references private.waitlist_enrollments(id),
 delivery_id uuid not null unique references private.waitlist_deliveries(id),expires_at timestamptz not null,created_at timestamptz not null default clock_timestamp()
);
create table private.waitlist_delivery_observations (
 webhook_id text primary key,delivery_id uuid not null references private.waitlist_deliveries(id),provider_id text not null,
 kind text not null check(kind in ('sent','delivered','delivery_delayed','bounced','complained','failed')),
 observed_at timestamptz not null,received_at timestamptz not null default clock_timestamp()
);
create index waitlist_observation_delivery on private.waitlist_delivery_observations(delivery_id);
create table private.waitlist_join_requests (
 request_id uuid primary key,digest text not null,enrollment_id uuid not null references private.waitlist_enrollments(id),created_at timestamptz not null default clock_timestamp()
);
create table private.waitlist_rate_events (
 id bigint generated always as identity primary key,lane text not null check(lane in ('join_ip','join_email','leave_ip','dispatch')),
 identity_hash text not null,at timestamptz not null default clock_timestamp()
);
create index waitlist_rate_lookup on private.waitlist_rate_events(lane,identity_hash,at);
do $$declare n text;begin
 foreach n in array array['settings','enrollments','tier_state','availability_cycles','deliveries','leave_tokens','delivery_observations','join_requests','rate_events'] loop
 execute format('alter table private.waitlist_%I enable row level security',n);
 execute format('revoke all on private.waitlist_%I from public,anon,authenticated,service_role',n);
 end loop;
end;$$;

create function private.waitlist_ready() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(accepting_joins and private.organizer_message_email_valid(sender_email) and private.organizer_message_email_valid(reply_to)
 and app_origin ~ '^https://[^/?#]+$' and worker_healthy_at>clock_timestamp()-make_interval(secs=>health_seconds)
 and capacity_minute>0 and capacity_day>0 and capacity_month>0,false) from private.waitlist_settings where singleton;
$$;
create function private.waitlist_policy(p_event uuid,p_tier uuid,p_at timestamptz) returns text language plpgsql stable security definer set search_path='' as $$
declare e public.events;t public.ticket_tiers;
begin
 select * into e from public.events where id=p_event;
 select * into t from public.ticket_tiers where id=p_tier and event_id=p_event;
 if e.id is null or t.id is null or e.admission_type<>'paid' or t.status<>'active' then return 'closed';end if;
 if e.starts_at is null or e.ends_at is null or not isfinite(e.starts_at) or not isfinite(e.ends_at) or e.ends_at<=e.starts_at
 then return 'paused';end if;
 -- Validate directly; enumerating pg_timezone_names adds ~49ms to the ticketing lock.
 begin
  if e.timezone is null then return 'paused';end if;
  perform pg_catalog.timezone(e.timezone,p_at);
 exception when invalid_parameter_value then return 'paused';end;
 if e.starts_at<=p_at or e.status='cancelled' or e.moderation_status in ('blocked','removed')
 or exists(select 1 from private.event_moderation_actions where event_id=e.id and moderation_version=e.moderation_version and action in ('block','remove')) then return 'closed';end if;
 if not private.event_is_publicly_eligible(e.id,p_at) then return 'paused';end if;
 return 'eligible';
end;$$;
-- No blocking wait on the ticketing boundary. This is the SAME key as lock_event_ticketing_operation.
create function private.waitlist_lock(p_event uuid,p_tier uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not pg_try_advisory_xact_lock(hashtextextended(p_event::text,0)) then return false;end if;
 perform id from public.ticket_tiers where id=p_tier and event_id=p_event for update nowait;
 if not found then return false;end if;
 perform id from public.events where id=p_event for update nowait;
 return found;
exception when lock_not_available then return false;
end;$$;
create function private.waitlist_consume_rate(p_lane text,p_key text,p_hour integer,p_day integer) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;m integer;t timestamptz:=clock_timestamp();
begin
 perform pg_advisory_xact_lock(hashtextextended('waitlist-rate/'||p_lane||'/'||p_key,0));
 select count(*) filter(where at>t-interval '1 hour'),count(*) into n,m from private.waitlist_rate_events where lane=p_lane and identity_hash=p_key and at>t-interval '24 hours';
 -- Saturated buckets do not grow without bound; existing debits keep them closed.
 if n>=p_hour or m>=p_day then return false;end if;
 insert into private.waitlist_rate_events(lane,identity_hash,at) values(p_lane,p_key,t);return true;
end;$$;
create function private.waitlist_reconcile(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare w private.waitlist_enrollments;o public.orders;
begin
 select * into w from private.waitlist_enrollments where id=p_id for update nowait;
 if w.lifecycle<>'active' or w.operational_closed_at is not null then return true;end if;
 if exists(select 1 from private.waitlist_tier_state t where t.tier_id=w.tier_id and w.joined_at<=t.closed_through) then
  update private.waitlist_enrollments set operational_closed_at=(select closed_through from private.waitlist_tier_state where tier_id=w.tier_id),closed_reason='event_or_tier_closed' where id=w.id;return true;
 end if;
 select x.* into o from public.orders x where x.event_id=w.event_id and lower(btrim(x.buyer_email))=w.normalized_email
 and x.status='paid' and x.paid_at>w.joined_at and x.refunded_at is null and x.reconciliation_status='reconciled'
 and exists(select 1 from public.order_items i where i.order_id=x.id and i.ticket_tier_id=w.tier_id and i.quantity>0)
 and private.organizer_order_coherent(x.id) and private.order_refund_state(x)='eligible' order by x.paid_at,x.id limit 1;
 if found then update private.waitlist_enrollments set lifecycle='purchased',purchased_at=o.paid_at,qualifying_order_id=o.id where id=w.id;end if;
return true;
exception when lock_not_available then return false;
end;$$;
create function public.server_join_waitlist(p_event_id uuid,p_tier_id uuid,p_name text,p_email text,p_request_id uuid,p_ip_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.waitlist_settings;w private.waitlist_enrollments;r private.waitlist_join_requests;addr text:=lower(btrim(p_email));n text:=btrim(p_name);d text;t timestamptz;email_ok boolean;ip_ok boolean;
begin
 if p_event_id is null or p_tier_id is null or p_request_id is null or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$'
 or n is null or char_length(n) not between 1 and 120 or n ~ '[[:cntrl:]]' or not private.organizer_message_email_valid(addr) then return jsonb_build_object('kind','INVALID_INPUT');end if;
 select * into s from private.waitlist_settings where singleton;
 ip_ok:=private.waitlist_consume_rate('join_ip',p_ip_hash,s.ip_hour,s.ip_day);
 email_ok:=private.waitlist_consume_rate('join_email',private.ticket_email_fingerprint('waitlist/'||p_tier_id||'/'||addr),s.email_hour,s.email_day);
 if not ip_ok or not email_ok then return jsonb_build_object('kind','RATE_LIMITED');end if;
 d:=private.ticket_email_fingerprint(jsonb_build_array(p_event_id,p_tier_id,n,addr)::text);
 perform pg_advisory_xact_lock(hashtextextended('waitlist-request/'||p_request_id,0));
 select * into r from private.waitlist_join_requests where request_id=p_request_id;
 if found then return jsonb_build_object('kind',case when r.digest=d then 'joined' else 'INVALID_INPUT' end);end if;
 if not private.waitlist_ready() or not private.waitlist_lock(p_event_id,p_tier_id) then return jsonb_build_object('kind','WAITLIST_UNAVAILABLE');end if;
 t:=clock_timestamp();
 if private.waitlist_policy(p_event_id,p_tier_id,t)<>'eligible' then return jsonb_build_object('kind','WAITLIST_UNAVAILABLE');end if;
 if (select availability_status from private.ticket_tier_inventory(p_tier_id,t)) is distinct from 'sold_out' then return jsonb_build_object('kind','TICKETS_AVAILABLE');end if;
 select * into w from private.waitlist_enrollments where tier_id=p_tier_id and normalized_email=addr and lifecycle='active' and operational_closed_at is null for update;
 if found then
 perform private.waitlist_reconcile(w.id);
 select * into w from private.waitlist_enrollments where id=w.id and lifecycle='active' and operational_closed_at is null;
 end if;
 if w.id is null then
 insert into private.waitlist_enrollments(event_id,tier_id,name,normalized_email,recipient_hash,joined_at)
 values(p_event_id,p_tier_id,n,addr,private.ticket_email_fingerprint(addr),t) returning * into w;
 insert into private.waitlist_deliveries(enrollment_id,purpose,state,dispatch_stopped_reason)
 values(w.id,'confirmation',case when exists(select 1 from private.ticket_email_recipient_blocks where recipient_hash=w.recipient_hash) then 'suppressed' else 'queued' end,
 case when exists(select 1 from private.ticket_email_recipient_blocks where recipient_hash=w.recipient_hash) then 'recipient_suppressed' else null end);
 end if;
 insert into private.waitlist_join_requests(request_id,digest,enrollment_id) values(p_request_id,d,w.id);
 insert into private.waitlist_tier_state(tier_id,event_id,observed_state) values(p_tier_id,p_event_id,'sold_out') on conflict(tier_id) do update set
 observed_state='sold_out',observed_at=t,transitioned_at=case when private.waitlist_tier_state.observed_state<>'sold_out' then t else private.waitlist_tier_state.transitioned_at end,next_check_at=t;
 return jsonb_build_object('kind','joined');
end;$$;

create function public.get_public_waitlist_capability(p_event_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',private.waitlist_ready(),'eligible',exists(select 1 from public.ticket_tiers t where t.event_id=p_event_id and private.waitlist_policy(p_event_id,t.id,clock_timestamp())='eligible'));
$$;
create function private.waitlist_owner(p_event uuid) returns void language plpgsql security definer set search_path='' as $$
begin if auth.uid() is null or not exists(select 1 from public.events where id=p_event and organizer_id=auth.uid()) then raise exception using message='WAITLIST_UNAVAILABLE';end if;end;$$;
create function public.remove_owned_waitlist(p_event_id uuid,p_tier_id uuid,p_enrollment_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform private.waitlist_owner(p_event_id);
 if not exists(select 1 from private.waitlist_enrollments where id=p_enrollment_id and event_id=p_event_id and tier_id=p_tier_id) then raise exception using message='WAITLIST_UNAVAILABLE';end if;
 update private.waitlist_enrollments set lifecycle='removed',removed_at=clock_timestamp(),removed_reason='organizer' where id=p_enrollment_id and lifecycle='active';return true;
end;$$;
create function public.get_owned_waitlist(p_event_id uuid,p_tier_id uuid default null,p_cursor jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare summary jsonb;rows jsonb;next_cursor jsonb;last_time timestamptz;last_id uuid;closed boolean;
begin
 perform private.waitlist_owner(p_event_id);
 if p_tier_id is not null and not exists(select 1 from public.ticket_tiers where id=p_tier_id and event_id=p_event_id) then raise exception using message='WAITLIST_UNAVAILABLE';end if;
 if p_cursor is not null then
  begin
   if jsonb_typeof(p_cursor)<>'object' or (select array_agg(k order by k) from jsonb_object_keys(p_cursor)k) is distinct from array['id','joinedAt','tierId']::text[] or p_cursor->>'tierId' is distinct from p_tier_id::text then raise exception 'invalid';end if;
   last_time:=(p_cursor->>'joinedAt')::timestamptz;last_id:=(p_cursor->>'id')::uuid;
   if last_time is null or not isfinite(last_time) or last_id is null then raise exception 'invalid';end if;
  exception when others then raise exception using message='INVALID_CURSOR';end;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'closed',private.waitlist_policy(p_event_id,t.id,clock_timestamp())='closed',
 'waiting',(select count(*) from private.waitlist_enrollments w where w.tier_id=t.id and lifecycle='active' and operational_closed_at is null and not exists(select 1 from private.waitlist_tier_state ts where ts.tier_id=w.tier_id and w.joined_at<=ts.closed_through) and private.waitlist_policy(p_event_id,t.id,clock_timestamp())<>'closed')) order by t.sort_order),'[]') into summary from public.ticket_tiers t where event_id=p_event_id;
 select coalesce(jsonb_agg(doc order by joined_at desc,id desc),'[]') into rows from (
 select w.id,w.joined_at,jsonb_build_object('id',w.id,'name',coalesce(w.name,'Details removed'),'email',coalesce(w.normalized_email,''),'joinedAt',w.joined_at,
 'closed',w.operational_closed_at is not null or exists(select 1 from private.waitlist_tier_state ts where ts.tier_id=w.tier_id and w.joined_at<=ts.closed_through),'status',case w.lifecycle when 'purchased' then 'Purchased' when 'removed' then 'Removed' else case when w.last_notified_at is null then 'Waiting' else 'Notified' end end)doc
 from private.waitlist_enrollments w where w.event_id=p_event_id and w.tier_id=p_tier_id and (last_id is null or (w.joined_at,w.id)<(last_time,last_id)) order by w.joined_at desc,w.id desc limit 51)page;
 if jsonb_array_length(rows)>50 then next_cursor:=jsonb_build_object('id',rows->49->>'id','joinedAt',rows->49->>'joinedAt','tierId',p_tier_id);rows:=rows-50;end if;
 closed:=case when p_tier_id is null then not exists(select 1 from public.ticket_tiers where event_id=p_event_id and private.waitlist_policy(p_event_id,id,clock_timestamp())<>'closed') else private.waitlist_policy(p_event_id,p_tier_id,clock_timestamp())='closed' end;
 return jsonb_build_object('tiers',summary,'entries',rows,'nextCursor',next_cursor,'closed',closed);
end;$$;
create function public.server_leave_waitlist(p_token_hash text,p_ip_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.waitlist_settings;w private.waitlist_enrollments;
begin
 select * into s from private.waitlist_settings where singleton;
 if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('kind','unavailable');end if;
 if not private.waitlist_consume_rate('leave_ip',p_ip_hash,s.ip_hour,s.ip_day) then return jsonb_build_object('kind','rate_limited');end if;
 select e.* into w from private.waitlist_leave_tokens t join private.waitlist_enrollments e on e.id=t.enrollment_id
 where t.token_hash=p_token_hash and t.expires_at>clock_timestamp()
 and coalesce(e.removed_at,e.purchased_at,e.operational_closed_at,clock_timestamp())>clock_timestamp()-interval '90 days' for update of e;
 if not found then return jsonb_build_object('kind','unavailable');end if;
 update private.waitlist_enrollments set lifecycle='removed',removed_at=clock_timestamp(),removed_reason='buyer' where id=w.id and lifecycle='active';
 return jsonb_build_object('kind','removed');
end;$$;

create function public.server_next_waitlist_tiers(p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;s private.waitlist_settings;
begin
 select * into s from private.waitlist_settings where singleton;
 if not s.observer_enabled or p_limit is null or p_limit<1 then return '[]';end if;
 with due as(select t.tier_id from private.waitlist_tier_state t where next_check_at<=clock_timestamp()
 and exists(select 1 from private.waitlist_enrollments w where w.tier_id=t.tier_id and lifecycle='active' and operational_closed_at is null)
 order by next_check_at,t.tier_id limit least(p_limit,s.tier_batch) for update skip locked), claimed as(
 update private.waitlist_tier_state t set next_check_at=clock_timestamp()+interval '60 seconds' from due where t.tier_id=due.tier_id returning t.tier_id)
 select coalesce(jsonb_agg(tier_id),'[]') into result from claimed;return result;
end;$$;
create function public.server_observe_waitlist(p_tier_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare st private.waitlist_tier_state;c private.waitlist_availability_cycles;s private.waitlist_settings;w private.waitlist_enrollments;
 at_time timestamptz;work_until timestamptz;policy text;availability text;n integer:=0;last_id uuid;reason text;more boolean:=false;
begin
 select * into s from private.waitlist_settings where singleton;
 if not s.observer_enabled then return jsonb_build_object('kind','disabled');end if;
 select * into st from private.waitlist_tier_state where tier_id=p_tier_id;
 if not found or not private.waitlist_lock(st.event_id,p_tier_id) then return jsonb_build_object('kind','deferred');end if;
 select * into st from private.waitlist_tier_state where tier_id=p_tier_id for update;
 at_time:=clock_timestamp();policy:=private.waitlist_policy(st.event_id,p_tier_id,at_time);
 if policy='closed' then
  st.closed_through:=at_time;
  update private.waitlist_tier_state set closed_through=at_time,observed_state='closed',observed_at=at_time where tier_id=p_tier_id;
 end if;
 -- Persist the closure cutoff before bounded cleanup. Restoration cannot revive its backlog.
 if st.closed_through is not null then
  with page as(select id from private.waitlist_enrollments where tier_id=p_tier_id and joined_at<=st.closed_through and lifecycle='active' and operational_closed_at is null order by id limit s.page_size for update skip locked)
  update private.waitlist_enrollments enrollment set operational_closed_at=st.closed_through,closed_reason='event_or_tier_closed' from page where enrollment.id=page.id;
  get diagnostics n=row_count;
  more:=exists(select 1 from private.waitlist_enrollments where tier_id=p_tier_id and joined_at<=st.closed_through and lifecycle='active' and operational_closed_at is null);
  if policy='closed' or n>0 or more then
   update private.waitlist_tier_state set next_check_at=case when more then at_time else at_time+interval '60 seconds' end where tier_id=p_tier_id;
   return jsonb_build_object('kind','closed','more',more);
  end if;
 end if;
 if policy<>'eligible' then
  -- Preserve last inventory observation while paused; no invented restock on policy recovery.
  update private.waitlist_tier_state set observed_at=at_time where tier_id=p_tier_id;return jsonb_build_object('kind','paused');
 end if;
 select availability_status into availability from private.ticket_tier_inventory(p_tier_id,at_time);
 if availability='available' and st.observed_state='sold_out' then
  st.cycle:=st.cycle+1;
  insert into private.waitlist_availability_cycles(tier_id,sequence,opened_at) values(p_tier_id,st.cycle,at_time);
 end if;
 update private.waitlist_tier_state set cycle=st.cycle,observed_state=availability,observed_at=at_time,
 transitioned_at=case when observed_state<>availability then at_time else transitioned_at end where tier_id=p_tier_id;
 select * into c from private.waitlist_availability_cycles where tier_id=p_tier_id and completed_at is null order by sequence limit 1 for update;
 -- A transaction processes one page: fanout OR ordinary reconciliation, never both.
 work_until:=clock_timestamp()+interval '5 milliseconds';
 if c.id is null then
 for w in select * from private.waitlist_enrollments where tier_id=p_tier_id and lifecycle='active' and operational_closed_at is null and (st.scan_cursor is null or id>st.scan_cursor) order by id limit s.page_size loop
  if not private.waitlist_reconcile(w.id) then more:=true;exit;end if;last_id:=w.id;
  exit when clock_timestamp()>work_until;
 end loop;
 update private.waitlist_tier_state set scan_cursor=last_id where tier_id=p_tier_id;
 end if;
 if c.id is not null then
  for w in select * from private.waitlist_enrollments where tier_id=p_tier_id and joined_at<=c.opened_at and (c.cursor_id is null or id>c.cursor_id) order by id limit s.page_size loop
   if not private.waitlist_reconcile(w.id) then exit;end if;
   select * into w from private.waitlist_enrollments where id=w.id;
   reason:=null;
   if w.lifecycle<>'active' or w.operational_closed_at is not null then reason:='enrollment_closed';
   elsif availability<>'available' or c.sequence<>st.cycle then reason:='stale_cycle';
   elsif exists(select 1 from private.ticket_email_recipient_blocks where recipient_hash=w.recipient_hash) then reason:='recipient_suppressed';
   elsif (select count(*) from private.waitlist_deliveries where enrollment_id=w.id and purpose='restock' and first_possible_dispatch_at>at_time-interval '24 hours')>=s.restock_day then reason:='restock_limit';end if;
   insert into private.waitlist_deliveries(enrollment_id,purpose,cycle_id,state,dispatch_stopped_reason)
   values(w.id,'restock',c.id,case when reason is null then 'queued' else 'suppressed' end,reason) on conflict do nothing;
   c.cursor_id:=w.id;n:=n+1;
   exit when clock_timestamp()>work_until;
  end loop;
  more:=exists(select 1 from private.waitlist_enrollments where tier_id=p_tier_id and joined_at<=c.opened_at and (c.cursor_id is null or id>c.cursor_id));
  update private.waitlist_availability_cycles set cursor_id=c.cursor_id,completed_at=case when not more then at_time else null end where id=c.id;
 end if;
 update private.waitlist_tier_state set next_check_at=case when more then at_time else at_time+interval '60 seconds' end where tier_id=p_tier_id;
 return jsonb_build_object('kind','observed','cycle',st.cycle,'processed',n,'more',more);
end;$$;

-- Explicit boundary grants; private implementation functions never browser executable.
do $$declare f record;begin
 for f in select p.oid::regprocedure sig,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='private' and p.proname like 'waitlist_%') or (n.nspname='public' and p.proname in
 ('server_join_waitlist','get_public_waitlist_capability','remove_owned_waitlist','get_owned_waitlist','server_leave_waitlist','server_next_waitlist_tiers','server_observe_waitlist')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);
 if f.nspname='public' then
  if f.proname='get_public_waitlist_capability' then execute format('grant execute on function %s to anon,authenticated',f.sig);
  elsif f.proname in ('remove_owned_waitlist','get_owned_waitlist') then execute format('grant execute on function %s to authenticated',f.sig);
  else execute format('grant execute on function %s to service_role',f.sig);end if;
 end if;
 end loop;
end;$$;

create function private.waitlist_facts(p_enrollment uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('eventId',e.id,'eventName',e.title,'tierName',t.name,'amountMinor',t.unit_amount_minor,'currency',t.currency,
 'startsAt',e.starts_at,'endsAt',e.ends_at,'timezone',e.timezone,'venueName',coalesce(e.venue_name,e.address_line1),'senderEmail',s.sender_email,'replyTo',s.reply_to,
 'eventUrl',s.app_origin||'/events/'||e.id||'/tickets','appOrigin',s.app_origin)
 from private.waitlist_enrollments w join public.events e on e.id=w.event_id join public.ticket_tiers t on t.id=w.tier_id cross join private.waitlist_settings s where w.id=p_enrollment;
$$;
create function private.waitlist_delivery_lock(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare w private.waitlist_enrollments;
begin
 select e.* into w from private.waitlist_enrollments e join private.waitlist_deliveries d on d.enrollment_id=e.id where d.id=p_id;
 if not found or not private.waitlist_lock(w.event_id,w.tier_id) then return false;end if;
 perform id from private.waitlist_enrollments where id=w.id for update nowait;
 perform id from private.waitlist_deliveries where id=p_id for update nowait;return found;
exception when lock_not_available then return false;
end;$$;
create function private.waitlist_delivery_reason(p_id uuid) returns text language plpgsql security definer set search_path='' as $$
declare d private.waitlist_deliveries;w private.waitlist_enrollments;s private.waitlist_settings;at_time timestamptz:=clock_timestamp();policy text;
begin
 select * into d from private.waitlist_deliveries where id=p_id;
 perform private.waitlist_reconcile(d.enrollment_id);
 select * into w from private.waitlist_enrollments where id=d.enrollment_id;
 select * into s from private.waitlist_settings where singleton;
 policy:=private.waitlist_policy(w.event_id,w.tier_id,at_time);
 if policy='closed' then update private.waitlist_enrollments set operational_closed_at=coalesce(operational_closed_at,at_time),closed_reason='event_or_tier_closed' where id=w.id;end if;
 if w.lifecycle<>'active' or w.operational_closed_at is not null or policy='closed' then return 'enrollment_closed';end if;
 if policy<>'eligible' then return 'policy_unavailable';end if;
 if exists(select 1 from private.ticket_email_recipient_blocks where recipient_hash=w.recipient_hash) then return 'recipient_suppressed';end if;
 if d.purpose='restock' then
 if not (select checkout_creation_enabled from private.checkout_runtime_control where singleton) then return 'checkout_unavailable';end if;
 if (select availability_status from private.ticket_tier_inventory(w.tier_id,at_time)) is distinct from 'available' then return 'sold_out';end if;
 if not exists(select 1 from private.waitlist_availability_cycles c join private.waitlist_tier_state t on t.tier_id=c.tier_id where c.id=d.cycle_id and c.sequence=t.cycle) then return 'stale_cycle';end if;
 if d.first_possible_dispatch_at is null and (select count(*) from private.waitlist_deliveries where enrollment_id=w.id and purpose='restock' and first_possible_dispatch_at>at_time-interval '24 hours')>=s.restock_day then return 'restock_limit';end if;
 end if;
 if d.payload is not null and d.facts_digest is distinct from private.ticket_email_fingerprint(private.waitlist_facts(w.id)::text) then return 'facts_changed';end if;
 return null;
end;$$;
create function public.server_acknowledge_waitlist_worker() returns boolean language plpgsql security definer set search_path='' as $$
begin update private.waitlist_settings set worker_healthy_at=clock_timestamp() where singleton and delivery_enabled;return found;end;$$;
create function public.server_claim_waitlist_delivery() returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.waitlist_deliveries;at_time timestamptz:=clock_timestamp();
begin
 if not (select delivery_enabled from private.waitlist_settings where singleton) then return null;end if;
 select * into d from private.waitlist_deliveries where state in ('queued','unknown','sending') and dispatch_stopped_reason is null
 and next_attempt_at<=at_time and (lease_until is null or lease_until<=at_time) order by next_attempt_at,id limit 1 for update skip locked;
 if not found then return null;end if;
 if d.first_possible_dispatch_at is not null and (d.dispatch_count>=6 or d.first_possible_dispatch_at<=at_time-interval '23 hours') then
 update private.waitlist_deliveries set state='unknown',dispatch_stopped_reason='retry_window_exhausted',lease_until=null where id=d.id;return null;end if;
 update private.waitlist_deliveries set lease_id=gen_random_uuid(),lease_until=at_time+interval '2 minutes',state=case when state='sending' then 'unknown' else state end where id=d.id returning * into d;
 return jsonb_build_object('attemptId',d.id,'leaseId',d.lease_id,'payload',d.payload);
end;$$;
create function public.server_stop_waitlist_delivery(p_attempt_id uuid,p_lease_id uuid,p_reason text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_reason is null or p_reason not in ('payload_unreadable','invalid_projection','configuration_unavailable','enrollment_closed','policy_unavailable','recipient_suppressed','checkout_unavailable','sold_out','stale_cycle','restock_limit','facts_changed') then return false;end if;
 update private.waitlist_deliveries set state=case when state='accepted' then state when first_possible_dispatch_at is null then 'suppressed' else 'unknown' end,
 dispatch_stopped_reason=p_reason,lease_until=null where id=p_attempt_id and lease_id=p_lease_id and lease_until>clock_timestamp();return found;
end;$$;
-- Release only the caller's unsent lease; never rewrite provider outcome or immutable bytes.
create function public.server_defer_waitlist_delivery(p_attempt_id uuid,p_lease_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update private.waitlist_deliveries set lease_until=null,next_attempt_at=greatest(next_attempt_at,clock_timestamp()+interval '1 second')
 where id=p_attempt_id and lease_id=p_lease_id and lease_until>clock_timestamp() and state in ('queued','unknown') and dispatch_stopped_reason is null;
 return found;
end;$$;
create function public.server_prepare_waitlist_delivery(p_attempt_id uuid,p_lease_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.waitlist_deliveries;w private.waitlist_enrollments;reason text;
begin
 if not (select delivery_enabled from private.waitlist_settings where singleton) or not private.waitlist_delivery_lock(p_attempt_id) then return null;end if;
 select * into d from private.waitlist_deliveries where id=p_attempt_id and lease_id=p_lease_id and lease_until>clock_timestamp() and dispatch_stopped_reason is null and state in ('queued','unknown');
 if not found then return null;end if;
 reason:=private.waitlist_delivery_reason(d.id);
 if reason in ('policy_unavailable','checkout_unavailable') then
 update private.waitlist_deliveries set lease_until=null,next_attempt_at=clock_timestamp()+interval '60 seconds' where id=d.id;return null;
 end if;
 if reason is not null then perform public.server_stop_waitlist_delivery(d.id,p_lease_id,reason);return null;end if;
 select * into w from private.waitlist_enrollments where id=d.enrollment_id;
 return jsonb_build_object('attemptId',d.id,'recipient',w.normalized_email,'purpose',d.purpose,'facts',private.waitlist_facts(w.id),'factsDigest',private.ticket_email_fingerprint(private.waitlist_facts(w.id)::text),'payload',d.payload);
end;$$;
create function public.server_save_waitlist_payload(p_attempt_id uuid,p_lease_id uuid,p_payload jsonb,p_token_hash text,p_facts_digest text) returns boolean language plpgsql security definer set search_path='' as $$
declare d private.waitlist_deliveries;
begin
 if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_payload is null or not private.ticket_email_envelope_valid(p_payload) then return false;end if;
 if not private.waitlist_delivery_lock(p_attempt_id) then return false;end if;
 select * into d from private.waitlist_deliveries where id=p_attempt_id and lease_id=p_lease_id and lease_until>clock_timestamp() and state='queued' and payload is null and dispatch_stopped_reason is null;
 if not found then return false;end if;
 if private.waitlist_delivery_reason(d.id) is not null or p_facts_digest is distinct from private.ticket_email_fingerprint(private.waitlist_facts(d.enrollment_id)::text) then return false;end if;
 insert into private.waitlist_leave_tokens(token_hash,enrollment_id,delivery_id,expires_at)
 select p_token_hash,w.id,d.id,e.ends_at+interval '90 days' from private.waitlist_enrollments w join public.events e on e.id=w.event_id where w.id=d.enrollment_id;
 update private.waitlist_deliveries set payload=p_payload,facts_digest=p_facts_digest where id=d.id;return true;
end;$$;
create function public.server_begin_waitlist_dispatch(p_attempt_id uuid,p_lease_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.waitlist_deliveries;s private.waitlist_settings;reason text;t timestamptz;
begin
 if not private.waitlist_delivery_lock(p_attempt_id) then return null;end if;
 select * into d from private.waitlist_deliveries where id=p_attempt_id and lease_id=p_lease_id and lease_until>clock_timestamp() and state in ('queued','unknown') and payload is not null and dispatch_stopped_reason is null;
 if not found then return null;end if;
 if not pg_try_advisory_xact_lock(hashtextextended('waitlist-capacity',0)) then return null;end if;
 select * into s from private.waitlist_settings where singleton for share;
 t:=clock_timestamp();
 if not s.delivery_enabled or s.capacity_minute is null or s.capacity_day is null or s.capacity_month is null then return null;end if;
 if d.dispatch_count>=6 or d.first_possible_dispatch_at<=t-interval '23 hours' then
 update private.waitlist_deliveries set state='unknown',dispatch_stopped_reason='retry_window_exhausted',lease_until=null where id=d.id;return null;end if;
 reason:=private.waitlist_delivery_reason(d.id);
 if reason in ('policy_unavailable','checkout_unavailable') then
 update private.waitlist_deliveries set lease_until=null,next_attempt_at=clock_timestamp()+interval '60 seconds' where id=d.id;return null;
 end if;
 if reason is not null then perform public.server_stop_waitlist_delivery(d.id,p_lease_id,reason);return null;end if;
 if (select count(*) from private.waitlist_rate_events where lane='dispatch' and at>t-interval '1 minute')>=s.capacity_minute
 or (select count(*) from private.waitlist_rate_events where lane='dispatch' and at>t-interval '24 hours')>=s.capacity_day
 or (select count(*) from private.waitlist_rate_events where lane='dispatch' and at>t-interval '31 days')>=s.capacity_month then
 update private.waitlist_deliveries set lease_until=null,next_attempt_at=t+interval '60 seconds' where id=d.id;return null;end if;
 insert into private.waitlist_rate_events(lane,identity_hash,at) values('dispatch',d.id::text,t);
 update private.waitlist_deliveries set state='sending',first_possible_dispatch_at=coalesce(first_possible_dispatch_at,t),dispatch_count=dispatch_count+1 where id=d.id returning * into d;
 return jsonb_build_object('attemptId',d.id,'payload',d.payload,'idempotencyKey','waitlist/'||d.id,'leaseUntil',d.lease_until,'firstPossibleDispatchAt',d.first_possible_dispatch_at,'dispatchCount',d.dispatch_count);
end;$$;
create function public.server_finish_waitlist_dispatch(p_attempt_id uuid,p_lease_id uuid,p_outcome text,p_provider_id text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare d private.waitlist_deliveries;
begin
 if p_outcome is null or p_outcome not in ('accepted','failed','unknown') or (p_outcome='accepted' and (p_provider_id is null or p_provider_id !~ '^[A-Za-z0-9_-]{1,200}$')) then return false;end if;
 -- Enrollment precedes delivery everywhere, including webhook/finish, to avoid observer inversion.
 perform w.id from private.waitlist_enrollments w join private.waitlist_deliveries q on q.enrollment_id=w.id where q.id=p_attempt_id for update of w;
 select * into d from private.waitlist_deliveries where id=p_attempt_id and lease_id=p_lease_id and lease_until>clock_timestamp() and first_possible_dispatch_at is not null for update;
 if not found then return false;end if;
 if d.state='accepted' then return true;end if;
 if p_outcome='failed' and d.dispatch_count>1 then p_outcome:='unknown';end if;
 update private.waitlist_deliveries set state=p_outcome,provider_id=case when p_outcome='accepted' then p_provider_id else provider_id end,
 accepted_at=case when p_outcome='accepted' then coalesce(accepted_at,clock_timestamp()) else accepted_at end,lease_until=null,next_attempt_at=clock_timestamp()+interval '60 seconds',
 dispatch_stopped_reason=case when p_outcome='unknown' and (dispatch_count>=6 or first_possible_dispatch_at<=clock_timestamp()-interval '23 hours') then 'retry_window_exhausted' else dispatch_stopped_reason end where id=d.id;
 if p_outcome='accepted' and d.purpose='restock' then update private.waitlist_enrollments set last_notified_at=clock_timestamp(),last_notified_cycle=(select sequence from private.waitlist_availability_cycles where id=d.cycle_id) where id=d.enrollment_id;end if;
 return true;
end;$$;

alter table private.ticket_email_recipient_blocks add column waitlist_delivery_id uuid references private.waitlist_deliveries(id) on delete restrict;
alter table private.ticket_email_recipient_blocks drop constraint recipient_block_one_provenance;
alter table private.ticket_email_recipient_blocks add constraint recipient_block_one_provenance check(num_nonnulls(attempt_id,organizer_recipient_id,waitlist_delivery_id)=1);
create function public.server_observe_waitlist_email(p_webhook_id text,p_attempt_id uuid,p_provider_id text,p_kind text,p_observed_at timestamptz) returns boolean language plpgsql security definer set search_path='' as $$
declare d private.waitlist_deliveries;recipient text;
begin
 if p_webhook_id is null or char_length(p_webhook_id) not between 1 and 200 or p_provider_id is null or p_provider_id !~ '^[A-Za-z0-9_-]{1,200}$' or p_kind is null or p_kind not in ('sent','delivered','delivery_delayed','bounced','complained','failed') or p_observed_at is null or not isfinite(p_observed_at) then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended('email-webhook/'||p_webhook_id,0));
 if exists(select 1 from private.ticket_email_observations where webhook_id=p_webhook_id) or exists(select 1 from private.organizer_message_observations where webhook_id=p_webhook_id) then return false;end if;
 perform w.id from private.waitlist_enrollments w join private.waitlist_deliveries q on q.enrollment_id=w.id where q.id=p_attempt_id for update of w;
 select * into d from private.waitlist_deliveries where id=p_attempt_id for update;
 if not found or d.first_possible_dispatch_at is null or (d.provider_id is not null and d.provider_id<>p_provider_id) then return false;end if;
 if exists(select 1 from private.waitlist_delivery_observations where webhook_id=p_webhook_id) then return exists(select 1 from private.waitlist_delivery_observations where webhook_id=p_webhook_id and delivery_id=d.id and provider_id=p_provider_id and kind=p_kind and observed_at=p_observed_at);end if;
 insert into private.waitlist_delivery_observations(webhook_id,delivery_id,provider_id,kind,observed_at) values(p_webhook_id,d.id,p_provider_id,p_kind,p_observed_at);
 update private.waitlist_deliveries set state='accepted',provider_id=p_provider_id,accepted_at=coalesce(accepted_at,clock_timestamp()),observation=(select kind from private.waitlist_delivery_observations where delivery_id=d.id order by case kind when 'complained' then 6 when 'bounced' then 5 when 'failed' then 4 when 'delivered' then 3 when 'delivery_delayed' then 2 else 1 end desc,observed_at desc limit 1) where id=d.id;
 if d.purpose='restock' then update private.waitlist_enrollments set last_notified_at=coalesce(last_notified_at,clock_timestamp()),last_notified_cycle=(select sequence from private.waitlist_availability_cycles where id=d.cycle_id) where id=d.enrollment_id;end if;
 if p_kind in ('bounced','complained') then
 select recipient_hash into recipient from private.waitlist_enrollments where id=d.enrollment_id;
 insert into private.ticket_email_recipient_blocks(recipient_hash,reason,waitlist_delivery_id) values(recipient,p_kind,d.id)
 on conflict(recipient_hash) do update set reason=case when private.ticket_email_recipient_blocks.reason='complained' then 'complained' else excluded.reason end,attempt_id=null,organizer_recipient_id=null,waitlist_delivery_id=excluded.waitlist_delivery_id,recorded_at=clock_timestamp();
 end if;
 return true;
end;$$;
create or replace function public.server_observe_organizer_message(p_webhook_id text,p_attempt_id uuid,p_provider_id text,p_kind text,p_observed_at timestamptz) returns boolean
language plpgsql security definer set search_path='' as $$
declare q private.organizer_message_recipients; recipient text;
begin
 if p_webhook_id is null or char_length(p_webhook_id) not between 1 and 200 or p_provider_id is null or char_length(p_provider_id) not between 1 and 200 or p_kind is null or p_kind not in ('sent','delivered','delivery_delayed','bounced','complained','failed') or p_observed_at is null or not isfinite(p_observed_at) then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended('email-webhook/'||p_webhook_id,0));
 if exists(select 1 from private.waitlist_delivery_observations where webhook_id=p_webhook_id) then return false;end if;
 if exists(select 1 from private.ticket_email_observations where webhook_id=p_webhook_id) then return false;end if;
 select * into q from private.organizer_message_recipients where id=p_attempt_id for update;
 if not found or q.first_possible_dispatch_at is null or (q.provider_id is not null and q.provider_id<>p_provider_id) then return false; end if;
 if exists(select 1 from private.organizer_message_observations where webhook_id=p_webhook_id) then
  return exists(select 1 from private.organizer_message_observations where webhook_id=p_webhook_id and recipient_id=q.id and provider_id=p_provider_id and kind=p_kind and observed_at=p_observed_at);
 end if;
 insert into private.organizer_message_observations(webhook_id,recipient_id,provider_id,kind,observed_at) values(p_webhook_id,q.id,p_provider_id,p_kind,p_observed_at);
 update private.organizer_message_recipients set state='accepted',provider_id=p_provider_id,accepted_at=coalesce(accepted_at,clock_timestamp()),updated_at=clock_timestamp(),
 observation=(select kind from private.organizer_message_observations where recipient_id=q.id
  order by case kind when 'complained' then 6 when 'bounced' then 5 when 'failed' then 4 when 'delivered' then 3 when 'delivery_delayed' then 2 else 1 end desc,observed_at desc limit 1)
 where id=q.id;
 if p_kind in ('bounced','complained') then
  recipient:=q.recipient_hash;
  if recipient is not null then
   insert into private.ticket_email_recipient_blocks(recipient_hash,reason,organizer_recipient_id) values(recipient,p_kind,q.id)
   on conflict(recipient_hash) do update set reason=case when private.ticket_email_recipient_blocks.reason='complained' then 'complained' else excluded.reason end,attempt_id=null,organizer_recipient_id=excluded.organizer_recipient_id,waitlist_delivery_id=null,recorded_at=clock_timestamp();
  end if;
 end if;
 return true;
end;
$$;

create or replace function public.server_observe_ticket_email(p_webhook_id text,p_attempt_id uuid,p_provider_id text,p_kind text,p_observed_at timestamptz) returns boolean
language plpgsql security definer set search_path='' as $$
declare q private.ticket_email_outbox; recipient text;
begin
 if p_webhook_id is null or char_length(p_webhook_id) not between 1 and 200 or p_provider_id is null or char_length(p_provider_id) not between 1 and 200 or p_kind is null or p_kind not in ('sent','delivered','delivery_delayed','bounced','complained','failed') or p_observed_at is null or not isfinite(p_observed_at) then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended('email-webhook/'||p_webhook_id,0));
 if exists(select 1 from private.waitlist_delivery_observations where webhook_id=p_webhook_id) then return false;end if;
 if exists(select 1 from private.organizer_message_observations where webhook_id=p_webhook_id) then return false;end if;
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
   on conflict(recipient_hash) do update set reason=case when private.ticket_email_recipient_blocks.reason='complained' then 'complained' else excluded.reason end,attempt_id=excluded.attempt_id,organizer_recipient_id=null,waitlist_delivery_id=null,recorded_at=clock_timestamp();
  end if;
 end if;
 return true;
end;
$$;
create or replace function public.server_observe_email(p_webhook_id text,p_attempt_id uuid,p_provider_id text,p_kind text,p_observed_at timestamptz) returns boolean language plpgsql security definer set search_path='' as $$
declare ticket boolean;organizer boolean;waitlist boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended('email-webhook/'||p_webhook_id,0));
 ticket:=exists(select 1 from private.ticket_email_outbox where id=p_attempt_id);
 organizer:=exists(select 1 from private.organizer_message_recipients where id=p_attempt_id);
 waitlist:=exists(select 1 from private.waitlist_deliveries where id=p_attempt_id);
 if ticket::integer+organizer::integer+waitlist::integer<>1 then return false;end if;
 if ticket then return public.server_observe_ticket_email(p_webhook_id,p_attempt_id,p_provider_id,p_kind,p_observed_at);end if;
 if organizer then return public.server_observe_organizer_message(p_webhook_id,p_attempt_id,p_provider_id,p_kind,p_observed_at);end if;
 return public.server_observe_waitlist_email(p_webhook_id,p_attempt_id,p_provider_id,p_kind,p_observed_at);
end;$$;
-- Newly added contracts stay service-only. Existing owner/public grants above remain explicit.
do $$declare f record;begin
 for f in select p.oid::regprocedure sig,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='private' and p.proname like 'waitlist_%') or (n.nspname='public' and (p.proname like 'server_%waitlist%' or p.proname='server_acknowledge_waitlist_worker')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);
 if f.nspname='public' then execute format('grant execute on function %s to service_role',f.sig);end if;
 end loop;
end;$$;

create function public.server_configure_waitlist(p_config jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_config is null or jsonb_typeof(p_config)<>'object' or exists(select 1 from jsonb_object_keys(p_config)k where k<>all(array['acceptingJoins','observerEnabled','deliveryEnabled','senderEmail','replyTo','appOrigin','capacityMinute','capacityDay','capacityMonth','emailHour','emailDay','ipHour','ipDay','restockDay','pageSize','tierBatch','healthSeconds'])) then raise exception 'INVALID_CONFIG';end if;
 perform pg_advisory_xact_lock(hashtextextended('waitlist-capacity',0));
 update private.waitlist_settings set accepting_joins=coalesce((p_config->>'acceptingJoins')::boolean,accepting_joins),observer_enabled=coalesce((p_config->>'observerEnabled')::boolean,observer_enabled),delivery_enabled=coalesce((p_config->>'deliveryEnabled')::boolean,delivery_enabled),
 sender_email=coalesce(p_config->>'senderEmail',sender_email),reply_to=coalesce(p_config->>'replyTo',reply_to),app_origin=coalesce(p_config->>'appOrigin',app_origin),
 capacity_minute=coalesce((p_config->>'capacityMinute')::integer,capacity_minute),capacity_day=coalesce((p_config->>'capacityDay')::integer,capacity_day),capacity_month=coalesce((p_config->>'capacityMonth')::integer,capacity_month),
 email_hour=coalesce((p_config->>'emailHour')::integer,email_hour),email_day=coalesce((p_config->>'emailDay')::integer,email_day),ip_hour=coalesce((p_config->>'ipHour')::integer,ip_hour),ip_day=coalesce((p_config->>'ipDay')::integer,ip_day),restock_day=coalesce((p_config->>'restockDay')::integer,restock_day),page_size=coalesce((p_config->>'pageSize')::integer,page_size),tier_batch=coalesce((p_config->>'tierBatch')::integer,tier_batch),health_seconds=coalesce((p_config->>'healthSeconds')::integer,health_seconds) where singleton;
end;$$;
create function private.waitlist_protect_identity() returns trigger language plpgsql set search_path='' as $$
declare purge boolean;
begin
 if tg_op='DELETE' then raise exception 'Durable waitlist history';end if;
 if tg_table_name='waitlist_enrollments' then
 purge:=old.pii_purged_at is null and new.pii_purged_at is not null and new.name is null and new.normalized_email is null
 and coalesce(old.removed_at,old.purchased_at,old.operational_closed_at)> '-infinity'::timestamptz
 and coalesce(old.removed_at,old.purchased_at,old.operational_closed_at)<clock_timestamp()-interval '90 days'
 and not exists(select 1 from private.waitlist_deliveries where enrollment_id=old.id and payload_purged_at is null);
 if row(new.id,new.event_id,new.tier_id,new.recipient_hash,new.joined_at) is distinct from row(old.id,old.event_id,old.tier_id,old.recipient_hash,old.joined_at)
 or (row(new.name,new.normalized_email,new.pii_purged_at) is distinct from row(old.name,old.normalized_email,old.pii_purged_at) and not purge)
 or (old.lifecycle<>'active' and new.lifecycle<>old.lifecycle)
 or (old.operational_closed_at is not null and new.operational_closed_at is distinct from old.operational_closed_at) then raise exception 'Immutable waitlist enrollment';end if;
 elsif tg_table_name='waitlist_deliveries' then
 purge:=old.payload_purged_at is null and new.payload_purged_at is not null and new.payload is null
 and not (old.state in ('queued','sending','unknown') and old.dispatch_stopped_reason is null)
 and (old.lease_until is null or old.lease_until<clock_timestamp())
 and exists(select 1 from private.waitlist_enrollments w where id=old.enrollment_id and coalesce(w.removed_at,w.purchased_at,w.operational_closed_at)<clock_timestamp()-interval '90 days');
 if row(new.id,new.enrollment_id,new.purpose,new.cycle_id,new.created_at) is distinct from row(old.id,old.enrollment_id,old.purpose,old.cycle_id,old.created_at)
 or (old.payload is not null and row(new.payload,new.facts_digest) is distinct from row(old.payload,old.facts_digest) and not purge)
 or (old.first_possible_dispatch_at is not null and new.first_possible_dispatch_at is distinct from old.first_possible_dispatch_at)
 or new.dispatch_count<old.dispatch_count or (old.state='accepted' and new.state<>'accepted')
 or (old.first_possible_dispatch_at is not null and new.state in ('queued','suppressed')) then raise exception 'Immutable waitlist delivery';end if;
 end if;
 return new;
end;$$;
create trigger waitlist_enrollment_guard before update or delete on private.waitlist_enrollments for each row execute function private.waitlist_protect_identity();
create trigger waitlist_delivery_guard before update or delete on private.waitlist_deliveries for each row execute function private.waitlist_protect_identity();
create function public.server_prune_waitlist() returns integer language plpgsql security definer set search_path='' as $$
declare n integer:=0;w private.waitlist_enrollments;
begin
 for w in select * from private.waitlist_enrollments e where pii_purged_at is null and coalesce(removed_at,purchased_at,operational_closed_at)<clock_timestamp()-interval '90 days'
 and not exists(select 1 from private.waitlist_deliveries d where d.enrollment_id=e.id and ((state in ('queued','sending','unknown') and dispatch_stopped_reason is null) or lease_until>clock_timestamp()))
 order by id limit 100 for update skip locked loop
 update private.waitlist_deliveries set payload=null,payload_purged_at=clock_timestamp() where enrollment_id=w.id and payload_purged_at is null;
 delete from private.waitlist_leave_tokens where enrollment_id=w.id and (expires_at<clock_timestamp() or coalesce(w.removed_at,w.purchased_at,w.operational_closed_at)<clock_timestamp()-interval '90 days');
 update private.waitlist_enrollments set name=null,normalized_email=null,pii_purged_at=clock_timestamp() where id=w.id;n:=n+1;
 end loop;
 -- Hash-only request receipts remain for replay; no new enrollment can arise from a prior UUID.
 delete from private.waitlist_rate_events where at<clock_timestamp()-interval '32 days';return n;
end;$$;
revoke all on function private.waitlist_protect_identity(),public.server_configure_waitlist(jsonb),public.server_prune_waitlist() from public,anon,authenticated,service_role;
grant execute on function public.server_configure_waitlist(jsonb),public.server_prune_waitlist() to service_role;

-- New static route must never collide with a permanent organizer handle.
-- Refuse migration if the name was claimed; activation must resolve it explicitly.
do $$begin
 if exists(select 1 from public.organizers where handle='waitlist') then raise exception 'WAITLIST_ROUTE_HANDLE_CONFLICT';end if;
end;$$;
create or replace function private.storefront_handle_valid(p_handle text) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(char_length(p_handle) between 3 and 30 and p_handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
 and p_handle <> all(array['auth','discover','discovery','event-policy','event-status','events','moderation','orders','organizer','organizer-terms','refund-details','rsvp','ticket-access','waitlist','tickets','assets','api','terms','privacy','support','help','admin','login','signup','__dev']),false);
$$;
