-- Measurement only: canonical orders, registrations and tickets remain unchanged.
create table private.storefront_visits (
 token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
 organizer_id uuid not null references public.organizers(id),
 ref text check(ref ~ '^[a-zA-Z0-9_-]{1,64}$'),
 created_at timestamptz not null default clock_timestamp()
);
create index storefront_visits_owner_time on private.storefront_visits(organizer_id,created_at);
create table private.storefront_starts (
 token_hash text references private.storefront_visits(token_hash),
 event_id uuid references public.events(id),
 kind text not null check(kind in ('paid','free')),
 created_at timestamptz not null default clock_timestamp(),
 primary key(token_hash,event_id,kind)
);
create table private.storefront_sources (
 kind text not null check(kind in ('paid','free')),
 source_id uuid not null,
 token_hash text references private.storefront_visits(token_hash),
 organizer_id uuid not null references public.organizers(id),
 primary key(kind,source_id)
);
create table private.storefront_rate_limits(identity_hash text primary key,window_start timestamptz not null,hits integer not null);
alter table private.storefront_visits enable row level security;
alter table private.storefront_starts enable row level security;
alter table private.storefront_sources enable row level security;
alter table private.storefront_rate_limits enable row level security;
revoke all on private.storefront_visits,private.storefront_starts,private.storefront_sources,private.storefront_rate_limits from public,anon,authenticated,service_role;
create function public.server_record_storefront_telemetry(p_input jsonb,p_identity_hash text) returns boolean language plpgsql security definer set search_path='' as $$
declare owner uuid; v private.storefront_visits; rate private.storefront_rate_limits; event_id uuid; kind text;
begin
 if p_identity_hash is null or p_identity_hash !~ '^[a-f0-9]{64}$' or p_input->>'tokenHash' is null or p_input->>'tokenHash' !~ '^[a-f0-9]{64}$' then return false;end if;
 insert into private.storefront_rate_limits values(p_identity_hash,clock_timestamp(),1)
 on conflict(identity_hash) do update set window_start=case when private.storefront_rate_limits.window_start<clock_timestamp()-interval '1 hour' then clock_timestamp() else private.storefront_rate_limits.window_start end,
 hits=case when private.storefront_rate_limits.window_start<clock_timestamp()-interval '1 hour' then 1 else least(private.storefront_rate_limits.hits+1,121) end returning * into rate;
 if rate.hits>120 then return false;end if;
 if p_input->>'kind'='visit' then
  select id into owner from public.organizers where handle=p_input->>'handle' and storefront_status='published';
  if owner is null or (p_input->>'ref' is not null and p_input->>'ref' !~ '^[a-zA-Z0-9_-]{1,64}$') then return false;end if;
  insert into private.storefront_visits(token_hash,organizer_id,ref) values(p_input->>'tokenHash',owner,p_input->>'ref') on conflict do nothing;
 elsif p_input->>'kind'='start' then
  select * into v from private.storefront_visits where token_hash=p_input->>'tokenHash' and created_at>clock_timestamp()-interval '30 days';
  begin event_id:=(p_input->>'eventId')::uuid;exception when others then return false;end;
  kind:=p_input->>'admissionType';
  if v.organizer_id is null or not exists(select 1 from public.events e where e.id=event_id and e.organizer_id=v.organizer_id and e.admission_type=kind and private.event_is_publicly_eligible(e.id,statement_timestamp())) then return false;end if;
  insert into private.storefront_starts(token_hash,event_id,kind) values(v.token_hash,event_id,kind) on conflict do nothing;
 else return false;end if;
 -- Only transient IP-derived rate keys are pruned; no raw visitor identity is stored.
 delete from private.storefront_rate_limits where window_start<clock_timestamp()-interval '2 hours';
 return true;
end; $$;
create function public.server_associate_storefront_transaction(p_kind text,p_request_id uuid,p_event_id uuid,p_token_hash text default null) returns void language plpgsql security definer set search_path='' as $$
declare source uuid; owner uuid; created timestamptz; hash text;
begin
 if p_kind='paid' then
  select id,organizer_id,created_at into source,owner,created from public.orders where client_request_id=p_request_id and event_id=p_event_id;
 elsif p_kind='free' then
  select id,organizer_id,created_at into source,owner,created from public.free_registrations where request_id=p_request_id and event_id=p_event_id;
 else return;end if;
 if source is null then return;end if;
 select token_hash into hash from private.storefront_visits where token_hash=p_token_hash and organizer_id=owner and created_at<=created and created_at>created-interval '30 days';
 -- Freeze even an absent/invalid context. Retries cannot reassign an existing source.
 insert into private.storefront_sources(kind,source_id,token_hash,organizer_id) values(p_kind,source,hash,owner) on conflict do nothing;
end; $$;
create function public.get_owned_storefront_insights() returns jsonb language sql stable security definer set search_path='' as $$
 with visits as(select * from private.storefront_visits where organizer_id=auth.uid()),
 paid as(select o.* from public.orders o join private.storefront_sources s on s.source_id=o.id and s.kind='paid' and s.token_hash is not null where s.organizer_id=auth.uid() and o.paid_at is not null),
 gross as(select p.currency,sum(i.subtotal_minor) amount from paid p join public.order_items i on i.order_id=p.id group by p.currency)
 select jsonb_build_object('visits',(select count(*) from visits),'ticketStarts',(select count(*) from private.storefront_starts s join visits v using(token_hash) where s.kind='paid'),
 'rsvpStarts',(select count(*) from private.storefront_starts s join visits v using(token_hash) where s.kind='free'),
 'paidOrders',(select count(*) from paid),'confirmedRsvps',(select count(*) from private.storefront_sources s join public.free_registrations r on r.id=s.source_id where s.organizer_id=auth.uid() and s.kind='free' and s.token_hash is not null and r.status='confirmed'),
 'grossByCurrency',(select coalesce(jsonb_agg(jsonb_build_object('currency',currency,'amountMinor',amount)),'[]') from gross),
 'refLabels',(select coalesce(jsonb_agg(row),'[]') from (select ref,count(*) visits from visits group by ref order by count(*) desc,ref nulls last limit 50) row));
$$;
revoke all on function public.server_record_storefront_telemetry(jsonb,text),public.server_associate_storefront_transaction(text,uuid,uuid,text),public.get_owned_storefront_insights() from public,anon,authenticated,service_role;
grant execute on function public.server_record_storefront_telemetry(jsonb,text),public.server_associate_storefront_transaction(text,uuid,uuid,text) to service_role;
grant execute on function public.get_owned_storefront_insights() to authenticated;
