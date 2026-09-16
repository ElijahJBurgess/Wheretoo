-- Free admissions share tickets; requests are durable proof-bound outcomes, not orders.
create table public.free_registration_requests (
 id uuid primary key,
 event_id uuid,
 name text,
 email text,
 quantity integer,
 access_hash text not null unique check(access_hash ~ '^[0-9a-f]{64}$'),
 result jsonb,
 created_at timestamptz not null default now()
);
create table public.free_registrations (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique references public.free_registration_requests(id) on delete restrict,
 event_id uuid not null references public.events(id) on delete restrict,
 organizer_id uuid not null references public.organizers(id) on delete restrict,
 name text not null check(char_length(name) between 1 and 200 and name=btrim(regexp_replace(name,'[[:space:]]+',' ','g')) and name !~ '[[:cntrl:]]'),
 email text not null check(char_length(email) between 3 and 320 and email=lower(btrim(email)) and email ~ $email$^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$$email$ and octet_length(email)=char_length(email)),
 quantity integer not null check(quantity between 1 and 10),
 access_hash text not null unique check(access_hash ~ '^[0-9a-f]{64}$'),
 status text not null default 'confirmed' check(status in ('confirmed','cancelled')),
 created_at timestamptz not null default now(),
 cancelled_at timestamptz,
 check((status='confirmed' and cancelled_at is null) or (status='cancelled' and cancelled_at is not null))
);
create index free_registrations_event_status on public.free_registrations(event_id,status);
create index free_registrations_event_created on public.free_registrations(event_id,created_at,id);
alter table public.tickets
 alter column order_id drop not null,
 alter column order_item_id drop not null,
 alter column ticket_tier_id drop not null,
 add column registration_id uuid references public.free_registrations(id) on delete restrict,
 add constraint tickets_exact_source check(
  (registration_id is null and order_id is not null and order_item_id is not null and ticket_tier_id is not null)
  or (registration_id is not null and order_id is null and order_item_id is null and ticket_tier_id is null)),
 add constraint tickets_free_not_refunded check(registration_id is null or (status<>'refunded' and refunded_at is null)),
 add constraint tickets_registration_unit_key unique(registration_id,unit_sequence);
alter table public.free_registration_requests enable row level security;
alter table public.free_registrations enable row level security;
revoke all on public.free_registration_requests,public.free_registrations from public,anon,authenticated,service_role;
-- Service callers receive narrow RPCs, never direct mutation access.
create function private.free_reserved_admissions(p_event_id uuid) returns bigint
language sql stable security definer set search_path='' as $$
 select coalesce(sum(case when r.status='confirmed' then r.quantity else
  (select count(*) from public.tickets t where t.registration_id=r.id and t.status='used') end),0)::bigint
 from public.free_registrations r where r.event_id=p_event_id;
$$;
create function private.free_registration_is_coherent(p_registration_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.free_registrations r
 join public.events e on e.id=r.event_id and e.organizer_id=r.organizer_id and e.admission_type='free'
 join public.free_registration_requests q on q.id=r.request_id
 where r.id=p_registration_id and row(q.event_id,q.name,q.email,q.quantity,q.access_hash)
  is not distinct from row(r.event_id,r.name,r.email,r.quantity,r.access_hash)
 and q.result=jsonb_build_object('kind','confirmed','registrationId',r.id,'eventId',r.event_id,'quantity',r.quantity)
 and (select count(*) from public.tickets t where t.registration_id=r.id)=r.quantity
 and not exists(select 1 from generate_series(1,r.quantity) n where not exists(
  select 1 from public.tickets t where t.registration_id=r.id and t.unit_sequence=n
   and t.event_id=r.event_id and t.organizer_id=r.organizer_id
   and t.order_id is null and t.order_item_id is null and t.ticket_tier_id is null
   and t.admission_label='General Admission' and octet_length(t.credential_hash)=32
   and t.refunded_at is null and (
    (t.status='used' and t.used_at is not null and t.cancelled_at is null)
    or (r.status='confirmed' and e.status<>'cancelled' and t.status='valid' and t.used_at is null and t.cancelled_at is null)
    or (r.status='cancelled' and t.status='cancelled' and t.used_at is null and t.cancelled_at is not null)))));
$$;
create function private.guard_free_source_identity() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception using errcode='P0001',message='FREE_SOURCE_IMMUTABLE'; end if;
 if tg_table_name='free_registration_requests' then
  if row(new.id,new.event_id,new.name,new.email,new.quantity,new.access_hash,new.created_at)
   is distinct from row(old.id,old.event_id,old.name,old.email,old.quantity,old.access_hash,old.created_at)
   or old.result is not null then raise exception using errcode='P0001',message='FREE_SOURCE_IMMUTABLE'; end if;
 else
  if row(new.id,new.request_id,new.event_id,new.organizer_id,new.name,new.email,new.quantity,new.access_hash,new.created_at)
   is distinct from row(old.id,old.request_id,old.event_id,old.organizer_id,old.name,old.email,old.quantity,old.access_hash,old.created_at)
   or not ((new.status=old.status and new.cancelled_at is not distinct from old.cancelled_at)
    or (old.status='confirmed' and new.status='cancelled' and new.cancelled_at is not null)) then
    raise exception using errcode='P0001',message='FREE_SOURCE_IMMUTABLE'; end if;
 end if;
 return new;
end;
$$;
create trigger free_requests_identity before update or delete on public.free_registration_requests for each row execute function private.guard_free_source_identity();
create trigger free_registrations_identity before update or delete on public.free_registrations for each row execute function private.guard_free_source_identity();
create function private.guard_free_ticket_source() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then
  if old.registration_id is not null then raise exception using errcode='P0001',message='FREE_SOURCE_IMMUTABLE'; end if;
  return old;
 end if;
 if new.registration_id is distinct from old.registration_id then raise exception using errcode='P0001',message='TICKET_IDENTITY_IMMUTABLE'; end if;
 return new;
end;
$$;
create trigger tickets_free_source_identity before update or delete on public.tickets for each row execute function private.guard_free_ticket_source();
create function private.check_free_source_complete() returns trigger language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_q public.free_registration_requests;
begin
 if tg_table_name='free_registration_requests' then
  select * into v_q from public.free_registration_requests where id=new.id;
  if v_q.result is null or v_q.result->>'kind' not in ('confirmed','rejected') then
   raise exception using errcode='P0001',message='FREE_RECEIPT_INCOMPLETE'; end if;
  select id into v_id from public.free_registrations where request_id=new.id;
  if (v_q.result->>'kind'='confirmed') is distinct from (v_id is not null) then
   raise exception using errcode='P0001',message='FREE_RECEIPT_INCOMPLETE'; end if;
 elsif tg_table_name='free_registrations' then v_id:=new.id;
 else v_id:=new.registration_id;
 end if;
 if v_id is not null and not private.free_registration_is_coherent(v_id) then
  raise exception using errcode='P0001',message='FREE_TICKET_SET_MISMATCH'; end if;
 return null;
end;
$$;
create constraint trigger free_requests_complete after insert or update on public.free_registration_requests deferrable initially deferred for each row execute function private.check_free_source_complete();
create constraint trigger free_registrations_complete after insert or update on public.free_registrations deferrable initially deferred for each row execute function private.check_free_source_complete();
create constraint trigger free_tickets_complete after insert or update on public.tickets deferrable initially deferred for each row when (new.registration_id is not null) execute function private.check_free_source_complete();
-- Event UPDATE already holds its row lock. Do not acquire the advisory lock
-- here: direct UPDATE -> advisory would invert the existing RPC hierarchy.
create function private.guard_registered_free_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.free_registrations r where r.event_id=old.id) then
  if new.admission_type<>'free' or new.organizer_id<>old.organizer_id then
   raise exception using errcode='P0001',message='FREE_REGISTRATION_EVENT_IMMUTABLE'; end if;
  if new.capacity is not null and new.capacity<private.free_reserved_admissions(old.id) then
   raise exception using errcode='P0001',message='FREE_CAPACITY_BELOW_RESERVED'; end if;
 end if;
 return new;
end;
$$;
create trigger events_free_registration_guard before update on public.events for each row execute function private.guard_registered_free_event();
create function private.cancel_free_event_sources() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='cancelled' and old.status is distinct from new.status then
  update public.free_registrations set status='cancelled',cancelled_at=clock_timestamp() where event_id=new.id and status='confirmed';
  update public.tickets set status='cancelled',cancelled_at=clock_timestamp() where event_id=new.id and registration_id is not null and status='valid';
 end if;
 return null;
end;
$$;
create trigger events_cancel_free_sources after update of status on public.events for each row execute function private.cancel_free_event_sources();
-- Defense for privileged direct source inserts: use the event row as capacity mutex.
create function private.guard_free_registration_insert() returns trigger language plpgsql security definer set search_path='' as $$
declare e public.events;
begin
 select * into e from public.events where id=new.event_id for update;
 if not found or e.admission_type<>'free' or e.organizer_id<>new.organizer_id or e.status<>'published'
  or not private.event_is_publicly_eligible(e.id,clock_timestamp()) then
  raise exception using errcode='P0001',message='FREE_EVENT_UNAVAILABLE'; end if;
 if e.capacity is not null and private.free_reserved_admissions(e.id)+new.quantity>e.capacity then
  raise exception using errcode='P0001',message='FREE_CAPACITY_EXCEEDED'; end if;
 return new;
end;
$$;
create trigger free_registrations_insert_guard before insert on public.free_registrations for each row execute function private.guard_free_registration_insert();
revoke all on function private.free_reserved_admissions(uuid),private.free_registration_is_coherent(uuid),private.guard_free_source_identity(),private.guard_free_ticket_source(),private.check_free_source_complete(),private.guard_registered_free_event(),private.cancel_free_event_sources(),private.guard_free_registration_insert() from public,anon,authenticated,service_role;
