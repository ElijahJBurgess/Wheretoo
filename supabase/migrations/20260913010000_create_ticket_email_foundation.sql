-- Spec 07 is an access/delivery ledger. These objects never write admissions.
create table private.ticket_email_settings (
 singleton boolean primary key default true check(singleton),
 enabled_at timestamptz,
 worker_enabled boolean not null default false,
 limits jsonb, -- Intentionally NULL until a numeric profile is approved and configured.
 rate_secret bytea not null default extensions.gen_random_bytes(32)
);
insert into private.ticket_email_settings(singleton) values(true);
create table private.ticket_email_grants (
 id uuid primary key default gen_random_uuid(),
 token_hash text unique check(token_hash ~ '^[0-9a-f]{64}$'),
 purpose text not null check(purpose in ('initial','resend','recovery')),
 prepared_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null check(isfinite(expires_at)),
 scheduled_end_at timestamptz, -- Frozen initial/resend lifetime basis, independent of later event edits.
 revoked_at timestamptz,
 check(expires_at>prepared_at),
 constraint ticket_email_grants_schedule_basis check(
  (purpose='recovery' and scheduled_end_at is null)
  or (purpose<>'recovery' and scheduled_end_at is not null and isfinite(scheduled_end_at)
   and expires_at=scheduled_end_at+interval '24 hours'))
);
create table private.ticket_email_members (
 grant_id uuid not null references private.ticket_email_grants(id) on delete cascade,
 position integer not null check(position between 1 and 200),
 order_id uuid references public.orders(id) on delete restrict,
 registration_id uuid references public.free_registrations(id) on delete restrict,
 primary key(grant_id,position),
 check(num_nonnulls(order_id,registration_id)=1)
);
create unique index ticket_email_members_order on private.ticket_email_members(grant_id,order_id) where order_id is not null;
create unique index ticket_email_members_registration on private.ticket_email_members(grant_id,registration_id) where registration_id is not null;
create table private.ticket_email_outbox (
 id uuid primary key default gen_random_uuid(),
 purpose text not null check(purpose in ('initial','resend','recovery')),
 order_id uuid references public.orders(id) on delete restrict,
 registration_id uuid references public.free_registrations(id) on delete restrict,
 requested_by uuid references auth.users(id) on delete restrict,
 request_id uuid,
 recovery_payload jsonb,
 grant_id uuid unique references private.ticket_email_grants(id) on delete restrict,
 payload jsonb,
 state text not null default 'queued' check(state in ('queued','sending','accepted','failed','unknown','suppressed')),
 provider_id text unique,
 first_possible_dispatch_at timestamptz,
 dispatch_count integer not null default 0 check(dispatch_count between 0 and 6),
 next_attempt_at timestamptz not null default clock_timestamp(),
 lease_id uuid,
 lease_until timestamptz,
 dispatch_stopped_reason text,
 observation text check(observation in ('sent','delivered','delivery_delayed','bounced','complained','failed')),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check((purpose='recovery' and num_nonnulls(order_id,registration_id)=0 and recovery_payload is not null and request_id is not null)
   or (purpose<>'recovery' and num_nonnulls(order_id,registration_id)=1 and recovery_payload is null)),
 check((purpose='resend' and requested_by is not null and request_id is not null) or (purpose<>'resend' and requested_by is null)),
 check((first_possible_dispatch_at is null and dispatch_count=0) or (first_possible_dispatch_at is not null and dispatch_count>0)),
 check(payload is null or grant_id is not null)
);
create unique index ticket_email_initial_order on private.ticket_email_outbox(order_id) where purpose='initial';
create unique index ticket_email_initial_registration on private.ticket_email_outbox(registration_id) where purpose='initial';
create unique index ticket_email_request on private.ticket_email_outbox(purpose,request_id) where request_id is not null;
create index ticket_email_ready on private.ticket_email_outbox(next_attempt_at) where state in ('queued','sending','unknown') and dispatch_stopped_reason is null;
create table private.ticket_email_observations (
 webhook_id text primary key check(char_length(webhook_id) between 1 and 200),
 attempt_id uuid not null references private.ticket_email_outbox(id) on delete restrict,
 provider_id text not null check(char_length(provider_id) between 1 and 200),
 kind text not null check(kind in ('sent','delivered','delivery_delayed','bounced','complained','failed')),
 observed_at timestamptz not null,
 received_at timestamptz not null default clock_timestamp()
);
create table private.ticket_email_rate_events (
 lane text not null, identity_hash text not null check(identity_hash ~ '^[0-9a-f]{64}$'),
 at timestamptz not null default clock_timestamp()
);
create index ticket_email_rate_lookup on private.ticket_email_rate_events(lane,identity_hash,at);

-- Defense in depth against accidental payload/key/window rewrites and premature retention.
create function private.protect_ticket_email_ledger() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_TABLE_NAME='ticket_email_outbox' then
  if (old.payload is not null and new.payload is distinct from old.payload)
   or (old.grant_id is not null and new.grant_id is distinct from old.grant_id)
   or new.recovery_payload is distinct from old.recovery_payload
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
  if row(new.id,new.purpose,new.prepared_at,new.expires_at,new.scheduled_end_at) is distinct from row(old.id,old.purpose,old.prepared_at,old.expires_at,old.scheduled_end_at)
   or (old.token_hash is not null and new.token_hash is distinct from old.token_hash)
   or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then raise exception 'Immutable email grant'; end if;
 elsif TG_TABLE_NAME='ticket_email_members' then
  if TG_OP='UPDATE' then raise exception 'Immutable email membership'; end if;
  if exists(select 1 from private.ticket_email_grants where id=old.grant_id and expires_at>clock_timestamp()) then raise exception 'Unexpired access must be retained'; end if;
  return old;
 end if;
 return new;
end;
$$;
create trigger ticket_email_outbox_immutable before update on private.ticket_email_outbox for each row execute function private.protect_ticket_email_ledger();
create trigger ticket_email_grant_immutable before update or delete on private.ticket_email_grants for each row execute function private.protect_ticket_email_ledger();
create trigger ticket_email_members_immutable before update or delete on private.ticket_email_members for each row execute function private.protect_ticket_email_ledger();

-- Canonical new-send eligibility; historical reads deliberately use the existing resolvers.
create function private.ticket_email_source(p_kind text,p_id uuid) returns jsonb
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
 return jsonb_build_object('sourceKind',p_kind,'sourceId',p_id,'eventId',e.id,'organizerId',e.organizer_id,
 'email',recipient,'recipientName',label,'quantity',qty,'eventName',e.title,'startsAt',e.starts_at,'endsAt',e.ends_at,
 'timezone',e.timezone,'venueName',e.venue_name,'eligible',reason is null,'reason',reason,
 'admissions',(select jsonb_agg(jsonb_build_object('admissionLabel',t.admission_label,'position',t.position,'status',t.status,'usedAt',t.used_at) order by t.position)
  from (select admission_label,status,used_at,row_number() over(order by order_item_id,unit_sequence) as position
   from public.tickets where (p_kind='paid_order' and order_id=p_id) or (p_kind='free_registration' and registration_id=p_id)) t));
end;
$$;

-- Sliding-window limits, atomically checked across all lanes. No implicit production profile.
create function private.consume_ticket_email_limits(p_identities jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare item jsonb; rule jsonb; profile jsonb; at_time timestamptz:=clock_timestamp();
begin
 select limits into profile from private.ticket_email_settings where singleton;
 if profile is null or jsonb_typeof(p_identities)<>'array' or jsonb_array_length(p_identities) not between 1 and 6 then return false; end if;
 -- Deterministic lock ordering prevents deadlocks for overlapping recipient/IP/actor limits.
 for item in select value from jsonb_array_elements(p_identities) order by value->>'lane',value->>'hash' loop
  if item->>'hash' is null or (item->>'hash') !~ '^[0-9a-f]{64}$' or jsonb_typeof(profile->(item->>'lane')) is distinct from 'array' then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('ticket-email-rate:'||(item->>'lane')||':'||(item->>'hash'),0));
 end loop;
 for item in select value from jsonb_array_elements(p_identities) loop
  for rule in select value from jsonb_array_elements(profile->(item->>'lane')) loop
   if (rule->>'seconds')::integer<=0 or (rule->>'max')::integer<=0 then return false; end if;
   if (select count(*) from private.ticket_email_rate_events where lane=item->>'lane' and identity_hash=item->>'hash' and at>at_time-make_interval(secs=>(rule->>'seconds')::integer)) >= (rule->>'max')::integer then return false; end if;
  end loop;
 end loop;
 insert into private.ticket_email_rate_events(lane,identity_hash,at) select value->>'lane',value->>'hash',at_time from jsonb_array_elements(p_identities);
 return true;
end;
$$;
create function private.ticket_email_fingerprint(p_subject text) returns text language sql stable security definer set search_path='' as $$
 select encode(extensions.hmac(convert_to(p_subject,'UTF8'),rate_secret,'sha256'),'hex') from private.ticket_email_settings where singleton;
$$;

revoke all on private.ticket_email_settings,private.ticket_email_grants,private.ticket_email_members,private.ticket_email_outbox,private.ticket_email_observations,private.ticket_email_rate_events from public,anon,authenticated,service_role;
revoke all on function private.protect_ticket_email_ledger(),private.ticket_email_source(text,uuid),private.consume_ticket_email_limits(jsonb),private.ticket_email_fingerprint(text) from public,anon,authenticated,service_role;
