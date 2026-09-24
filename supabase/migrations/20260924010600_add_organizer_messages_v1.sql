-- Separate operational messages. Deployment does not activate acceptance or delivery.
create table private.organizer_message_settings (
 singleton boolean primary key default true check(singleton), accepting_sends boolean not null default false,
 worker_enabled boolean not null default false, preview_secret text not null default encode(extensions.gen_random_bytes(32),'hex'),
 sender_email text, reply_to text, app_origin text, media_origin text, template_version text not null default 'organizer-message-v1',
 capacity_per_minute integer check(capacity_per_minute>0), capacity_per_day integer check(capacity_per_day>0),
 capacity_per_month integer check(capacity_per_month>0), health_max_age_seconds integer check(health_max_age_seconds between 30 and 3600),
 worker_healthy_at timestamptz, max_recipients integer not null default 1000 check(max_recipients between 1 and 1000),
 event_hour integer not null default 3 check(event_hour>0), event_day integer not null default 10 check(event_day>0),
 organizer_day integer not null default 20 check(organizer_day>0), delivery_day integer not null default 5000 check(delivery_day>0),
 recipient_day integer not null default 3 check(recipient_day>0), preview_minute integer not null default 30 check(preview_minute>0)
);
insert into private.organizer_message_settings(singleton) values(true);
create table private.organizer_messages (
 id uuid primary key default gen_random_uuid(),event_id uuid not null references public.events(id),
 requested_by uuid not null references auth.users(id),request_id uuid not null unique,request_digest text not null,
 selector jsonb not null,preview_fingerprint text not null,subject text,body text,facts jsonb,
 confirmed_at timestamptz not null default clock_timestamp(),deadline_basis timestamptz not null,
 recipient_count integer not null check(recipient_count between 1 and 1000),content_purged_at timestamptz,
 check((content_purged_at is null and subject is not null and body is not null and facts is not null)
 or (content_purged_at is not null and subject is null and body is null and facts is null))
);
create table private.organizer_message_recipients (
 id uuid primary key default gen_random_uuid(),message_id uuid not null references private.organizer_messages(id),
 normalized_email text,recipient_hash text not null check(recipient_hash ~ '^[0-9a-f]{64}$'),
 state text not null default 'queued' check(state in ('queued','sending','accepted','failed','unknown','suppressed')),
 provider_id text unique,payload jsonb,first_possible_dispatch_at timestamptz,dispatch_count integer not null default 0 check(dispatch_count between 0 and 6),
 next_attempt_at timestamptz not null default clock_timestamp(),lease_id uuid,lease_until timestamptz,
 dispatch_stopped_reason text,observation text,accepted_at timestamptz,created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),payload_purged_at timestamptz,
 unique(message_id,recipient_hash),check(normalized_email is not null or payload_purged_at is not null)
);
create index organizer_message_ready on private.organizer_message_recipients(next_attempt_at,id)
 where state in ('queued','unknown','sending') and dispatch_stopped_reason is null;
create index organizer_messages_event_actor on private.organizer_messages(event_id,requested_by);
create table private.organizer_message_observations (
 webhook_id text primary key,recipient_id uuid not null references private.organizer_message_recipients(id),
 provider_id text not null,kind text not null check(kind in ('sent','delivered','delivery_delayed','bounced','complained','failed')),
 observed_at timestamptz not null,received_at timestamptz not null default clock_timestamp()
);
create index organizer_message_observations_recipient on private.organizer_message_observations(recipient_id);
create table private.organizer_message_rate_events (
 id bigint generated always as identity primary key,lane text not null check(lane in ('preview','send','recipient','dispatch')),
 identity_hash text not null,message_id uuid references private.organizer_messages(id),at timestamptz not null default clock_timestamp(),
 units integer not null default 1 check(units>0)
);
create index organizer_message_rate_lookup on private.organizer_message_rate_events(lane,identity_hash,at);
alter table private.organizer_message_settings enable row level security;
alter table private.organizer_messages enable row level security;
alter table private.organizer_message_recipients enable row level security;
alter table private.organizer_message_observations enable row level security;
alter table private.organizer_message_rate_events enable row level security;
revoke all on private.organizer_message_settings,private.organizer_messages,private.organizer_message_recipients,
 private.organizer_message_observations,private.organizer_message_rate_events from public,anon,authenticated,service_role;

alter table private.ticket_email_recipient_blocks alter column attempt_id drop not null;
alter table private.ticket_email_recipient_blocks add column organizer_recipient_id uuid references private.organizer_message_recipients(id) on delete restrict;
alter table private.ticket_email_recipient_blocks add constraint recipient_block_one_provenance check(num_nonnulls(attempt_id,organizer_recipient_id)=1);

create function private.organizer_message_email_valid(p_email text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(char_length(p_email) between 3 and 320 and p_email=lower(btrim(p_email))
 and octet_length(p_email)=char_length(p_email) and p_email ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$',false);
$$;
alter table private.organizer_messages add constraint organizer_message_facts_schema check(facts is null or (
 jsonb_typeof(facts)='object' and facts ?& array['eventId','eventName','organizerName','startsAt','endsAt','timezone','venueName','senderEmail','replyTo','templateVersion','eventUrl','flyerUrl','organizerLogoUrl']
 and jsonb_typeof(facts->'eventId')='string' and jsonb_typeof(facts->'organizerName')='string'
 and private.organizer_message_email_valid(facts->>'senderEmail') and private.organizer_message_email_valid(facts->>'replyTo')));
alter table private.organizer_messages add constraint organizer_message_content_shape check(
 request_digest ~ '^[0-9a-f]{64}$' and preview_fingerprint ~ '^[0-9a-f]{64}$' and isfinite(deadline_basis)
 and (subject is null or (char_length(subject) between 1 and 120 and subject !~ '[[:cntrl:]]'))
 and (body is null or (char_length(body) between 1 and 5000 and translate(body,E'\n\t','') !~ '[[:cntrl:]]')));
alter table private.organizer_message_recipients add constraint organizer_message_recipient_shape check(
 (normalized_email is null or private.organizer_message_email_valid(normalized_email))
 and (payload is null or private.ticket_email_envelope_valid(payload))
 and (provider_id is null or char_length(provider_id) between 1 and 200)
 and (observation is null or observation in ('sent','delivered','delivery_delayed','bounced','complained','failed'))
 and ((first_possible_dispatch_at is null and dispatch_count=0) or (first_possible_dispatch_at is not null and dispatch_count>0)));
create function private.organizer_message_owner(p_event_id uuid) returns public.events language plpgsql security definer set search_path='' as $$
declare e public.events;
begin
 if auth.uid() is null then raise exception using message='UNAUTHORIZED';end if;
 select * into e from public.events where id=p_event_id and organizer_id=auth.uid();
 if not found then raise exception using message='EVENT_UNAVAILABLE';end if;
 return e;
end;$$;
create function private.organizer_message_event_policy(p_event_id uuid,p_at timestamptz,p_dispatch boolean default false) returns text language plpgsql stable security definer set search_path='' as $$
declare e public.events;
begin
 select * into e from public.events where id=p_event_id;
 if not found then return 'EVENT_UNAVAILABLE';end if;
 if not p_dispatch and e.status='cancelled' then return 'EVENT_CANCELLED';end if;
 if not p_dispatch and e.status='draft' then return 'EVENT_DRAFT';end if;
 -- The canonical moderation state and revision are updated by moderation holds.
 if e.moderation_status<>'clear' or e.moderated_revision is distinct from e.content_revision
 or exists(select 1 from private.event_moderation_actions a where a.event_id=e.id and a.action in ('hold','block','remove')
 and a.moderation_version=e.moderation_version)
 then return 'MODERATION_BLOCKED';end if;
 if p_dispatch then return null;end if;
 if e.starts_at is null or e.ends_at is null or not isfinite(e.starts_at) or not isfinite(e.ends_at) or e.ends_at<=e.starts_at
 or not exists(select 1 from pg_catalog.pg_timezone_names where name=e.timezone) then return 'INVALID_SCHEDULE';end if;
 if p_at>e.ends_at+interval '168 hours' then return 'SEND_WINDOW_CLOSED';end if;
 return null;
end;$$;
create function private.organizer_message_available() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(accepting_sends and worker_enabled and private.organizer_message_email_valid(sender_email)
 and private.organizer_message_email_valid(reply_to) and app_origin ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?$'
 and capacity_per_minute>0 and capacity_per_day>0 and capacity_per_month>0
 and worker_healthy_at>clock_timestamp()-make_interval(secs=>health_max_age_seconds),false)
 from private.organizer_message_settings where singleton;
$$;
create function private.organizer_message_text(p_subject text,p_body text) returns jsonb language plpgsql immutable set search_path='' as $$
declare s text:=btrim(p_subject);b text:=btrim(replace(replace(p_body,E'\r\n',E'\n'),E'\r',E'\n'),E' \t\n');
begin
 if s is null or char_length(s) not between 1 and 120 or s ~ '[[:cntrl:]]' then raise exception using message='INVALID_SUBJECT';end if;
 if b is null or char_length(b) not between 1 and 5000 or translate(b,E'\n\t','') ~ '[[:cntrl:]]' then raise exception using message='INVALID_BODY';end if;
 return jsonb_build_object('subject',s,'body',b);
end;$$;
create function private.organizer_message_audience(p_event_id uuid,p_selector jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e public.events;k text:=p_selector->>'kind';ref uuid;emails jsonb;keys text[];
begin
 select * into e from public.events where id=p_event_id;
 if jsonb_typeof(p_selector) is distinct from 'object' then raise exception using message='INVALID_SELECTOR';end if;
 select array_agg(key order by key) into keys from jsonb_object_keys(p_selector) key;
 if k='everyone' and keys=array['kind'] then null;
 elsif k in ('tier','order','registration') and keys=array['id','kind'] and jsonb_typeof(p_selector->'id')='string'
 and (p_selector->>'id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then ref:=(p_selector->>'id')::uuid;
 else raise exception using message='INVALID_SELECTOR';end if;
 if (e.admission_type='free' and k in ('tier','order')) or (e.admission_type='paid' and k='registration') then raise exception using message='INVALID_SELECTOR';end if;
 if k='tier' and not exists(select 1 from public.ticket_tiers where id=ref and event_id=e.id) then raise exception using message='INVALID_TIER';end if;
 -- Corrupt active relationships are an unavailable audience, never a partial count.
 -- Scope by purchased item IDs before coherence; damaged/missing admissions must
 -- not hide the source whose admission truth we are attempting to validate.
 if (e.admission_type='paid' and exists(select 1 from public.orders o where o.event_id=e.id
 and o.status='paid' and o.paid_at is not null and o.refunded_at is null and o.reconciliation_status='reconciled'
 and private.order_refund_state(o)='eligible' and (k<>'order' or o.id=ref)
 and (k<>'tier' or exists(select 1 from public.order_items i where i.order_id=o.id and i.ticket_tier_id=ref))
 and not private.organizer_order_coherent(o.id)))
 or (e.admission_type='free' and exists(select 1 from public.free_registrations r where r.event_id=e.id
 and r.status='confirmed' and r.cancelled_at is null and (k<>'registration' or r.id=ref)
 and not private.free_registration_is_coherent(r.id))) then raise exception using message='AUDIENCE_UNAVAILABLE';end if;
 select coalesce(jsonb_agg(x.email order by x.email),'[]') into emails from (
 select distinct lower(btrim(o.buyer_email)) email from public.orders o
 where e.admission_type='paid' and o.event_id=e.id and o.status='paid' and o.paid_at is not null and o.refunded_at is null
 and o.reconciliation_status='reconciled' and private.organizer_order_coherent(o.id) and private.order_refund_state(o)='eligible'
 and (k<>'order' or o.id=ref)
 and exists(select 1 from public.tickets t join public.order_items i on i.id=t.order_item_id
 where t.order_id=o.id and t.status in ('valid','used') and i.order_id=o.id and (k<>'tier' or i.ticket_tier_id=ref))
 union
 select distinct lower(btrim(r.email)) from public.free_registrations r
 where e.admission_type='free' and r.event_id=e.id and r.status='confirmed' and r.cancelled_at is null
 and private.free_registration_is_coherent(r.id) and (k<>'registration' or r.id=ref)
 and exists(select 1 from public.tickets t where t.registration_id=r.id and t.status in ('valid','used'))
 ) x where private.organizer_message_email_valid(x.email)
 and not exists(select 1 from private.ticket_email_recipient_blocks b where b.recipient_hash=private.ticket_email_fingerprint(x.email));
 if k in ('order','registration') and jsonb_array_length(emails)=0 then raise exception using message='INACTIVE_INDIVIDUAL';end if;
 return emails;
end;$$;
create function private.organizer_message_preview(p_event_id uuid,p_selector jsonb,p_subject text,p_body text) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.events;s private.organizer_message_settings;txt jsonb;addresses jsonb;facts jsonb;label text;organizer text;reason text;fp text;
begin
 e:=private.organizer_message_owner(p_event_id);reason:=private.organizer_message_event_policy(e.id,clock_timestamp());
 if reason is not null then raise exception using message=reason;end if;
 if not private.organizer_message_available() then raise exception using message='EMAIL_UNAVAILABLE';end if;
 select * into s from private.organizer_message_settings where singleton;
 txt:=private.organizer_message_text(p_subject,p_body);addresses:=private.organizer_message_audience(e.id,p_selector);

 if jsonb_array_length(addresses)>s.max_recipients then raise exception using message='LIMIT_REACHED';end if;
 select display_name into organizer from public.organizers where id=e.organizer_id;
 if organizer is null or organizer ~ '[[:cntrl:]]' then organizer:='Organizer';end if;
 facts:=jsonb_build_object('eventId',e.id,'eventName',e.title,'organizerName',organizer,'startsAt',e.starts_at,'endsAt',e.ends_at,
 'timezone',e.timezone,'venueName',e.venue_name,'senderEmail',s.sender_email,'replyTo',s.reply_to,'templateVersion',s.template_version,
 'eventUrl',case when private.event_is_publicly_eligible(e.id,clock_timestamp()) then s.app_origin||'/events/'||e.id::text else null end,
 'flyerUrl',case when s.media_origin is not null and private.event_is_publicly_eligible(e.id,clock_timestamp()) then
 (select s.media_origin||'/functions/v1/event-images?id='||i.id::text from private.event_images i where i.event_id=e.id order by i.position limit 1) else null end,
 'organizerLogoUrl',case when s.media_origin is not null then (select s.media_origin||'/functions/v1/organizer-media?id='||o.storefront_logo_asset_id::text
 from public.organizers o where o.id=e.organizer_id and o.storefront_status='published' and exists(select 1 from private.organizer_media m where m.id=o.storefront_logo_asset_id and m.owner_id=o.id)) else null end);
 label:=case p_selector->>'kind' when 'everyone' then 'Everyone' when 'order' then 'Selected customer' when 'registration' then 'Selected registrant'
 else (select name from public.ticket_tiers where id=(p_selector->>'id')::uuid) end;
 fp:=encode(extensions.hmac(jsonb_build_object('actor',auth.uid(),'event',e.id,'selector',p_selector,'label',label,'text',txt,'facts',facts,
 'policy',jsonb_build_array(e.status,e.moderation_status,e.content_revision,e.moderated_revision),
 'members',(select jsonb_agg(private.ticket_email_fingerprint(value) order by value) from jsonb_array_elements_text(addresses)))::text,s.preview_secret,'sha256'),'hex');
 return jsonb_build_object('canSend',jsonb_array_length(addresses)>0,'reason',case when jsonb_array_length(addresses)=0 then 'NO_RECIPIENTS' else null end,'recipientCount',jsonb_array_length(addresses),'audienceLabel',label,'deadline',e.ends_at+interval '168 hours',
 'fingerprint',fp,'subject',txt->>'subject','body',txt->>'body','facts',facts,'addresses',addresses);
end;$$;
create function public.get_owned_organizer_message_options(p_event_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.events;reason text;
begin
 e:=private.organizer_message_owner(p_event_id);reason:=private.organizer_message_event_policy(e.id,clock_timestamp());
 if reason is null and not private.organizer_message_available() then reason:='EMAIL_UNAVAILABLE';end if;
 return jsonb_build_object('eventId',e.id,'admissionType',e.admission_type,'deadline',case when isfinite(e.ends_at) then e.ends_at+interval '168 hours' else null end,'canSend',reason is null,'reason',reason,
 'replyTo',(select reply_to from private.organizer_message_settings where singleton),
 'tiers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'archived',status='archived') order by sort_order,id),'[]') from public.ticket_tiers t where event_id=e.id and e.admission_type='paid'
 and (t.status<>'archived' or exists(select 1 from public.order_items i where i.ticket_tier_id=t.id))));
end;$$;
create function public.preview_owned_organizer_message(p_event_id uuid,p_selector jsonb,p_subject text,p_body text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb;n integer;lim integer;code text;
begin
 perform private.organizer_message_owner(p_event_id);
 perform pg_advisory_xact_lock(hashtextextended('organizer-message-preview/'||auth.uid()::text,0));
 select preview_minute into lim from private.organizer_message_settings where singleton;
 select count(*) into n from private.organizer_message_rate_events where lane='preview' and identity_hash=auth.uid()::text and at>clock_timestamp()-interval '1 minute';
 if n>=lim then return jsonb_build_object('error',jsonb_build_object('code','PREVIEW_LIMIT_REACHED'));end if;
 -- Admission is outside the caught subtransaction: expected domain failures
 -- return normally so direct authenticated RPC calls commit the preview debit.
 insert into private.organizer_message_rate_events(lane,identity_hash) values('preview',auth.uid()::text);
 begin
 v:=private.organizer_message_preview(p_event_id,p_selector,p_subject,p_body);
 exception when sqlstate 'P0001' then
 get stacked diagnostics code=message_text;
 if code not in ('EVENT_UNAVAILABLE','EVENT_CANCELLED','EVENT_DRAFT','MODERATION_BLOCKED','INVALID_SCHEDULE','SEND_WINDOW_CLOSED',
 'INVALID_SELECTOR','INVALID_TIER','INACTIVE_INDIVIDUAL','AUDIENCE_UNAVAILABLE','INVALID_SUBJECT','INVALID_BODY','NO_RECIPIENTS','LIMIT_REACHED','EMAIL_UNAVAILABLE') then raise;end if;
 return jsonb_build_object('error',jsonb_build_object('code',code));
 end;
 return v-'addresses';
end;$$;
create function private.organizer_message_receipt(p_message private.organizer_messages) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('messageId',p_message.id,'requestId',p_message.request_id,'queuedRecipients',p_message.recipient_count,'confirmedAt',p_message.confirmed_at);
$$;
create function public.get_owned_organizer_message_receipt(p_event_id uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m private.organizer_messages;
begin
 perform private.organizer_message_owner(p_event_id);
 perform pg_advisory_xact_lock(hashtextextended('organizer-message-request/'||p_request_id::text,0));
 select * into m from private.organizer_messages where request_id=p_request_id and event_id=p_event_id and requested_by=auth.uid();
 if not found then return null;end if;return private.organizer_message_receipt(m);
end;$$;
create function public.submit_owned_organizer_message(p_event_id uuid,p_selector jsonb,p_subject text,p_body text,p_fingerprint text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m private.organizer_messages;s private.organizer_message_settings;v jsonb;digest text;e public.events;addr text;n integer;
begin
 e:=private.organizer_message_owner(p_event_id);
 if p_request_id is null or p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then raise exception using message='INVALID_SELECTOR';end if;
 digest:=encode(extensions.digest(jsonb_build_object('event',e.id,'actor',auth.uid(),'selector',p_selector,'text',private.organizer_message_text(p_subject,p_body),'fingerprint',p_fingerprint)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('organizer-message-request/'||p_request_id::text,0));
 select * into m from private.organizer_messages where request_id=p_request_id;
 if found then
 if m.requested_by<>auth.uid() or m.event_id<>e.id or m.request_digest<>digest then raise exception using message='REQUEST_CONFLICT';end if;
 return private.organizer_message_receipt(m);end if;
 -- Source writers acquire event ticketing before tiers/event/sources. Maintain that order.
 perform private.lock_event_change_rows(e.id);
 perform id from public.orders where event_id=e.id order by id for update;
 perform id from public.free_registrations where event_id=e.id order by id for update;
 perform pg_advisory_xact_lock(hashtextextended('organizer-message-budget/'||auth.uid()::text,0));
 v:=private.organizer_message_preview(e.id,p_selector,p_subject,p_body);
 if v->>'fingerprint'<>p_fingerprint then raise exception using message='PREVIEW_CHANGED';end if;
 select * into s from private.organizer_message_settings where singleton;n:=(v->>'recipientCount')::integer;
 if n=0 then raise exception using message='NO_RECIPIENTS';end if;
 if (select count(*) from private.organizer_messages where event_id=e.id and confirmed_at>clock_timestamp()-interval '1 hour')>=s.event_hour
 or (select count(*) from private.organizer_messages where event_id=e.id and confirmed_at>clock_timestamp()-interval '24 hours')>=s.event_day
 or (select count(*) from private.organizer_messages where requested_by=auth.uid() and confirmed_at>clock_timestamp()-interval '24 hours')>=s.organizer_day
 or (select coalesce(sum(recipient_count),0) from private.organizer_messages where requested_by=auth.uid() and confirmed_at>clock_timestamp()-interval '24 hours')+n>s.delivery_day
 then raise exception using message='LIMIT_REACHED';end if;
 for addr in select value from jsonb_array_elements_text(v->'addresses') loop
 if (select count(*) from private.organizer_message_rate_events where lane='recipient' and identity_hash=auth.uid()::text||'/'||private.ticket_email_fingerprint(addr) and at>clock_timestamp()-interval '24 hours')>=s.recipient_day then raise exception using message='LIMIT_REACHED';end if;
 end loop;
 insert into private.organizer_messages(event_id,requested_by,request_id,request_digest,selector,preview_fingerprint,subject,body,facts,deadline_basis,recipient_count)
 values(e.id,auth.uid(),p_request_id,digest,p_selector,p_fingerprint,v->>'subject',v->>'body',v->'facts',(v->>'deadline')::timestamptz,n) returning * into m;
 insert into private.organizer_message_recipients(message_id,normalized_email,recipient_hash)
 select m.id,value,private.ticket_email_fingerprint(value) from jsonb_array_elements_text(v->'addresses');
 insert into private.organizer_message_rate_events(lane,identity_hash,message_id,units) values('send',auth.uid()::text,m.id,n);
 insert into private.organizer_message_rate_events(lane,identity_hash,message_id)
 select 'recipient',auth.uid()::text||'/'||private.ticket_email_fingerprint(value),m.id from jsonb_array_elements_text(v->'addresses');
 return private.organizer_message_receipt(m);
end;$$;
create function public.server_claim_organizer_message_recipient() returns jsonb language plpgsql security definer set search_path='' as $$
declare q private.organizer_message_recipients;t timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended('organizer-message-capacity',0));
 t:=clock_timestamp();
 if not (select worker_enabled from private.organizer_message_settings where singleton) then return null;end if;
 if exists(select 1 from private.organizer_message_recipients where lease_until>t) then return null;end if;
 if exists(select 1 from private.ticket_email_outbox where dispatch_stopped_reason is null and state in ('queued','sending','unknown')
 and (next_attempt_at<=t or lease_until>t)) then return null;end if;
 update private.organizer_message_recipients set state=case when state='sending' then 'unknown' else state end,dispatch_stopped_reason='retry_window_exhausted',lease_until=null,updated_at=t
 where state in ('sending','unknown') and dispatch_stopped_reason is null and (lease_until is null or lease_until<=t)
 and (dispatch_count>=6 or first_possible_dispatch_at<=t-interval '23 hours');
 t:=clock_timestamp();
 select * into q from private.organizer_message_recipients where state in ('queued','sending','unknown') and dispatch_stopped_reason is null
 and next_attempt_at<=t and (lease_until is null or lease_until<=t) and payload_purged_at is null
 order by next_attempt_at,id for update skip locked limit 1;
 if not found then return null;end if;
 t:=clock_timestamp();
 if q.lease_until>t or q.next_attempt_at>t then return null;end if;
 if q.dispatch_count>=6 or q.first_possible_dispatch_at<=t-interval '23 hours' then
 update private.organizer_message_recipients set state=case when state='sending' then 'unknown' else state end,dispatch_stopped_reason='retry_window_exhausted',lease_until=null,updated_at=t where id=q.id;
 return null;end if;
 update private.organizer_message_recipients set lease_id=gen_random_uuid(),lease_until=t+interval '2 minutes',
 state=case when state='sending' then 'unknown' else state end,updated_at=t where id=q.id returning * into q;
 return jsonb_build_object('attemptId',q.id,'leaseId',q.lease_id,'payload',q.payload);
end;$$;
create function public.server_prepare_organizer_message_recipient(p_attempt_id uuid,p_lease_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare q private.organizer_message_recipients;m private.organizer_messages;
begin
 select * into q from private.organizer_message_recipients where id=p_attempt_id and lease_id=p_lease_id and state in ('queued','unknown') and dispatch_stopped_reason is null for update;
 if not found or q.lease_until is null or q.lease_until<=clock_timestamp() then return null;end if;
 select * into m from private.organizer_messages where id=q.message_id;
 return jsonb_build_object('attemptId',q.id,'messageId',m.id,'recipient',q.normalized_email,'subject',m.subject,'body',m.body,'facts',m.facts,'payload',q.payload);
end;$$;
create function public.server_save_organizer_message_payload(p_attempt_id uuid,p_lease_id uuid,p_payload jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare q private.organizer_message_recipients;
begin
 if not private.ticket_email_envelope_valid(p_payload) then raise exception 'Invalid email preparation';end if;
 select * into q from private.organizer_message_recipients where id=p_attempt_id and lease_id=p_lease_id for update;
 if not found or q.lease_until is null or q.lease_until<=clock_timestamp() or q.state<>'queued' or q.dispatch_stopped_reason is not null or q.payload is not null or q.payload_purged_at is not null then return false;end if;
 update private.organizer_message_recipients set payload=p_payload,updated_at=clock_timestamp() where id=q.id;
 return true;
end;$$;
create function public.server_begin_organizer_message_dispatch(p_attempt_id uuid,p_lease_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare q private.organizer_message_recipients;s private.organizer_message_settings;t timestamptz;blocked text;
begin
 perform pg_advisory_xact_lock(hashtextextended('organizer-message-capacity',0));
 select * into s from private.organizer_message_settings where singleton;
 if not s.worker_enabled or s.capacity_per_minute is null or s.capacity_per_day is null or s.capacity_per_month is null then return null;end if;
 select * into q from private.organizer_message_recipients where id=p_attempt_id and lease_id=p_lease_id for update;
 t:=clock_timestamp();
 if not found or q.lease_until is null or q.lease_until<=t+interval '20 seconds' or q.state not in ('queued','unknown') or q.payload is null or q.dispatch_stopped_reason is not null then return null;end if;
 if q.dispatch_count>=6 or q.first_possible_dispatch_at<=t-interval '23 hours' then blocked:='retry_window_exhausted';
 elsif exists(select 1 from private.ticket_email_recipient_blocks where recipient_hash=q.recipient_hash) then blocked:='recipient_blocked';
 else blocked:=private.organizer_message_event_policy((select event_id from private.organizer_messages where id=q.message_id),t,true);end if;
 if blocked is not null then
 update private.organizer_message_recipients set dispatch_stopped_reason=blocked,state=case when first_possible_dispatch_at is null then 'suppressed' else state end,lease_until=null,updated_at=t where id=q.id;
 return null;end if;
 if exists(select 1 from private.ticket_email_outbox where dispatch_stopped_reason is null and state in ('queued','sending','unknown') and (next_attempt_at<=t or lease_until>t))
 or (select count(*) from private.organizer_message_rate_events where lane='dispatch' and at>t-interval '1 minute')>=s.capacity_per_minute
 or (select count(*) from private.organizer_message_rate_events where lane='dispatch' and at>t-interval '24 hours')>=s.capacity_per_day
 or (select count(*) from private.organizer_message_rate_events where lane='dispatch' and at>t-interval '31 days')>=s.capacity_per_month then
 update private.organizer_message_recipients set lease_until=null,next_attempt_at=t+interval '1 minute',updated_at=t where id=q.id;return null;end if;
 insert into private.organizer_message_rate_events(lane,identity_hash,message_id) values('dispatch','global',q.message_id);
 update private.organizer_message_recipients set state='sending',first_possible_dispatch_at=coalesce(first_possible_dispatch_at,t),dispatch_count=dispatch_count+1,updated_at=t where id=q.id returning * into q;
 return jsonb_build_object('attemptId',q.id,'payload',q.payload,'idempotencyKey','organizer-message/'||q.id::text,
 'leaseUntil',q.lease_until,'firstPossibleDispatchAt',q.first_possible_dispatch_at,'dispatchCount',q.dispatch_count);
end;$$;
create function public.server_finish_organizer_message_dispatch(p_attempt_id uuid,p_lease_id uuid,p_outcome text,p_provider_id text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare q private.organizer_message_recipients; at_time timestamptz;
begin
 if p_outcome is null or p_outcome not in ('accepted','failed','unknown') or (p_outcome='accepted' and (p_provider_id is null or char_length(p_provider_id) not between 1 and 200)) or (p_outcome<>'accepted' and p_provider_id is not null) then raise exception 'Invalid delivery result'; end if;
 select * into q from private.organizer_message_recipients where id=p_attempt_id and lease_id=p_lease_id for update;
 at_time:=clock_timestamp();
 if not found or q.lease_until is null or q.lease_until<=at_time or q.first_possible_dispatch_at is null then return false; end if;
 if q.provider_id is not null and p_provider_id is not null and q.provider_id<>p_provider_id then return false; end if;
 if q.state='accepted' then
  update private.organizer_message_recipients set lease_until=null,updated_at=at_time where id=q.id;
  return true; -- Earlier verified webhook evidence wins over a lost/rejected response.
 end if;
 if q.state<>'sending' then return false; end if;
 -- A retry rejection cannot prove an earlier uncertain dispatch was rejected.
 if p_outcome='failed' and q.dispatch_count>1 then p_outcome:='unknown'; end if;
 update private.organizer_message_recipients set state=p_outcome,provider_id=p_provider_id,accepted_at=case when p_outcome='accepted' then coalesce(accepted_at,at_time) else accepted_at end,
 next_attempt_at=at_time+make_interval(secs=>case dispatch_count when 1 then 60 when 2 then 300 when 3 then 1800 when 4 then 7200 else 21600 end),
 dispatch_stopped_reason=case when p_outcome='unknown' and (dispatch_count>=6 or first_possible_dispatch_at<=at_time-interval '23 hours') then 'retry_window_exhausted' else dispatch_stopped_reason end,
 lease_until=null,updated_at=at_time where id=q.id;
 return true;
end;
$$;

create function public.server_observe_organizer_message(p_webhook_id text,p_attempt_id uuid,p_provider_id text,p_kind text,p_observed_at timestamptz) returns boolean
language plpgsql security definer set search_path='' as $$
declare q private.organizer_message_recipients; recipient text;
begin
 if p_webhook_id is null or char_length(p_webhook_id) not between 1 and 200 or p_provider_id is null or char_length(p_provider_id) not between 1 and 200 or p_kind is null or p_kind not in ('sent','delivered','delivery_delayed','bounced','complained','failed') or p_observed_at is null or not isfinite(p_observed_at) then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended('email-webhook/'||p_webhook_id,0));
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
   on conflict(recipient_hash) do update set reason=case when private.ticket_email_recipient_blocks.reason='complained' then 'complained' else excluded.reason end,attempt_id=null,organizer_recipient_id=excluded.organizer_recipient_id,recorded_at=clock_timestamp();
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
   on conflict(recipient_hash) do update set reason=case when private.ticket_email_recipient_blocks.reason='complained' then 'complained' else excluded.reason end,attempt_id=excluded.attempt_id,organizer_recipient_id=null,recorded_at=clock_timestamp();
  end if;
 end if;
 return true;
end;
$$;

create function public.server_stop_organizer_message_recipient(p_attempt_id uuid,p_lease_id uuid,p_reason text) returns boolean language plpgsql security definer set search_path='' as $$
declare q private.organizer_message_recipients;
begin
 if p_reason is null or p_reason not in ('configuration_unavailable','support_unconfigured','payload_unreadable','invalid_projection') then raise exception 'Invalid delivery stop';end if;
 select * into q from private.organizer_message_recipients where id=p_attempt_id and lease_id=p_lease_id for update;
 if not found or q.lease_until is null or q.lease_until<=clock_timestamp() then return false;end if;
 update private.organizer_message_recipients set state=case when first_possible_dispatch_at is null then 'suppressed' when state='sending' then 'unknown' else state end,
 dispatch_stopped_reason=p_reason,lease_until=null,updated_at=clock_timestamp() where id=q.id;return true;
end;$$;
create function public.server_observe_email(p_webhook_id text,p_attempt_id uuid,p_provider_id text,p_kind text,p_observed_at timestamptz) returns boolean language plpgsql security definer set search_path='' as $$
declare ticket boolean;organizer boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended('email-webhook/'||p_webhook_id,0));
 ticket:=exists(select 1 from private.ticket_email_outbox where id=p_attempt_id);
 organizer:=exists(select 1 from private.organizer_message_recipients where id=p_attempt_id);
 if ticket=organizer then return false;end if;
 if ticket then return public.server_observe_ticket_email(p_webhook_id,p_attempt_id,p_provider_id,p_kind,p_observed_at);end if;
 return public.server_observe_organizer_message(p_webhook_id,p_attempt_id,p_provider_id,p_kind,p_observed_at);
end;$$;
create function private.protect_organizer_message_ledger() returns trigger language plpgsql set search_path='' as $$
declare purging boolean;
begin
 if tg_op='DELETE' then raise exception 'Durable organizer message receipt';end if;
 if tg_op='INSERT' then
 if (select count(*) from private.organizer_message_recipients where message_id=new.message_id)>=(select recipient_count from private.organizer_messages where id=new.message_id)
 then raise exception 'Immutable organizer membership';end if;
 return new;end if;
 if tg_table_name='organizer_messages' then
 purging:=old.content_purged_at is null and new.content_purged_at is not null and new.subject is null and new.body is null and new.facts is null
 and old.confirmed_at<clock_timestamp()-interval '90 days'
 and not exists(select 1 from private.organizer_message_recipients where message_id=old.id and payload_purged_at is null);
 if row(new.id,new.event_id,new.requested_by,new.request_id,new.request_digest,new.selector,new.preview_fingerprint,new.confirmed_at,new.deadline_basis,new.recipient_count)
 is distinct from row(old.id,old.event_id,old.requested_by,old.request_id,old.request_digest,old.selector,old.preview_fingerprint,old.confirmed_at,old.deadline_basis,old.recipient_count)
 or (row(new.subject,new.body,new.facts,new.content_purged_at) is distinct from row(old.subject,old.body,old.facts,old.content_purged_at) and not purging)
 then raise exception 'Immutable organizer message';end if;
 elsif tg_table_name='organizer_message_recipients' then
 purging:=old.payload_purged_at is null and new.payload_purged_at is not null and new.payload is null and new.normalized_email is null
 and old.updated_at<clock_timestamp()-interval '90 days' and old.state in ('accepted','failed','suppressed') and (old.lease_until is null or old.lease_until<=clock_timestamp());
 if row(new.id,new.message_id,new.recipient_hash,new.created_at) is distinct from row(old.id,old.message_id,old.recipient_hash,old.created_at)
 or (old.payload is not null and new.payload is distinct from old.payload and not purging)
 or (row(new.normalized_email,new.payload_purged_at) is distinct from row(old.normalized_email,old.payload_purged_at) and not purging)
 or (old.payload_purged_at is not null and new.payload is not null)
 or (old.first_possible_dispatch_at is not null and new.first_possible_dispatch_at is distinct from old.first_possible_dispatch_at)
 or new.dispatch_count<old.dispatch_count or (old.provider_id is not null and new.provider_id is distinct from old.provider_id)
 or (old.accepted_at is not null and new.accepted_at is distinct from old.accepted_at)
 then raise exception 'Immutable organizer recipient';end if;
 else raise exception 'Immutable organizer observation';end if;
 return new;
end;$$;
create trigger organizer_messages_immutable before update or delete on private.organizer_messages for each row execute function private.protect_organizer_message_ledger();
create trigger organizer_message_recipients_immutable before insert or update or delete on private.organizer_message_recipients for each row execute function private.protect_organizer_message_ledger();
create trigger organizer_message_observations_immutable before update or delete on private.organizer_message_observations for each row execute function private.protect_organizer_message_ledger();
create function public.server_prune_organizer_message_history() returns bigint language plpgsql security definer set search_path='' as $$
declare n bigint;
begin
 -- Unknown outcomes and all evidence stay intact; no receipt or hash is deleted.
 update private.organizer_message_recipients set payload=null,normalized_email=null,payload_purged_at=clock_timestamp()
 where payload_purged_at is null and updated_at<clock_timestamp()-interval '90 days' and state in ('accepted','failed','suppressed') and (lease_until is null or lease_until<=clock_timestamp());
 update private.organizer_messages m set subject=null,body=null,facts=null,content_purged_at=clock_timestamp()
 where content_purged_at is null and confirmed_at<clock_timestamp()-interval '90 days'
 and not exists(select 1 from private.organizer_message_recipients where message_id=m.id and payload_purged_at is null);
 get diagnostics n=row_count;
 delete from private.organizer_message_rate_events where at<clock_timestamp()-interval '32 days';return n;
end;$$;
create function public.server_configure_organizer_messages(p_configuration jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare c jsonb:=p_configuration;s private.organizer_message_settings;
begin
 if jsonb_typeof(c) is distinct from 'object' or exists(select 1 from jsonb_object_keys(c) k where k not in
 ('acceptingSends','workerEnabled','senderEmail','replyTo','appOrigin','mediaOrigin','templateVersion','capacityPerMinute','capacityPerDay','capacityPerMonth','healthMaxAgeSeconds',
 'maxRecipients','eventHour','eventDay','organizerDay','deliveryDay','recipientDay','previewMinute')) then raise exception 'Invalid message configuration';end if;
 perform pg_advisory_xact_lock(hashtextextended('organizer-message-capacity',0));
 update private.organizer_message_settings set
 accepting_sends=coalesce((c->>'acceptingSends')::boolean,accepting_sends),worker_enabled=coalesce((c->>'workerEnabled')::boolean,worker_enabled),
 sender_email=coalesce(c->>'senderEmail',sender_email),reply_to=coalesce(c->>'replyTo',reply_to),app_origin=coalesce(c->>'appOrigin',app_origin),media_origin=coalesce(c->>'mediaOrigin',media_origin),
 template_version=coalesce(c->>'templateVersion',template_version),capacity_per_minute=coalesce((c->>'capacityPerMinute')::integer,capacity_per_minute),
 capacity_per_day=coalesce((c->>'capacityPerDay')::integer,capacity_per_day),capacity_per_month=coalesce((c->>'capacityPerMonth')::integer,capacity_per_month),
 health_max_age_seconds=coalesce((c->>'healthMaxAgeSeconds')::integer,health_max_age_seconds),
 max_recipients=coalesce((c->>'maxRecipients')::integer,max_recipients),event_hour=coalesce((c->>'eventHour')::integer,event_hour),event_day=coalesce((c->>'eventDay')::integer,event_day),
 organizer_day=coalesce((c->>'organizerDay')::integer,organizer_day),delivery_day=coalesce((c->>'deliveryDay')::integer,delivery_day),recipient_day=coalesce((c->>'recipientDay')::integer,recipient_day),preview_minute=coalesce((c->>'previewMinute')::integer,preview_minute)
 where singleton returning * into s;
 if s.template_version<>'organizer-message-v1' or (s.media_origin is not null and s.media_origin !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?$')
 or ((s.accepting_sends or s.worker_enabled) and (not private.organizer_message_email_valid(s.sender_email) or not private.organizer_message_email_valid(s.reply_to)
 or s.app_origin is null or s.app_origin !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?$' or s.capacity_per_minute is null or s.capacity_per_day is null or s.capacity_per_month is null or s.health_max_age_seconds is null))
 then raise exception 'Invalid message configuration';end if;
 return true;
end;$$;
create function public.server_acknowledge_organizer_message_worker() returns boolean language plpgsql security definer set search_path='' as $$
begin
 update private.organizer_message_settings set worker_healthy_at=clock_timestamp() where singleton and worker_enabled and capacity_per_minute is not null and capacity_per_day is not null and capacity_per_month is not null;
 return found;
end;$$;
-- Every new function is deny-by-default; only exact public entry points are granted.
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='private' and p.proname like '%organizer_message%') or (n.nspname='public' and (p.proname like '%organizer_message%' or p.proname='server_observe_email')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end;$$;
grant execute on function public.get_owned_organizer_message_options(uuid),public.preview_owned_organizer_message(uuid,jsonb,text,text),
 public.submit_owned_organizer_message(uuid,jsonb,text,text,text,uuid),public.get_owned_organizer_message_receipt(uuid,uuid) to authenticated;
grant execute on function public.server_claim_organizer_message_recipient(),public.server_prepare_organizer_message_recipient(uuid,uuid),
 public.server_save_organizer_message_payload(uuid,uuid,jsonb),public.server_begin_organizer_message_dispatch(uuid,uuid),
 public.server_finish_organizer_message_dispatch(uuid,uuid,text,text),public.server_stop_organizer_message_recipient(uuid,uuid,text),
 public.server_observe_organizer_message(text,uuid,text,text,timestamptz),public.server_observe_email(text,uuid,text,text,timestamptz),
 public.server_prune_organizer_message_history(),public.server_configure_organizer_messages(jsonb),public.server_acknowledge_organizer_message_worker() to service_role;
