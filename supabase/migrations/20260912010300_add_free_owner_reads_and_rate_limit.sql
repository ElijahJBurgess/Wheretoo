create function private.require_owned_free_event(p_event_id uuid) returns public.events
language plpgsql stable security definer set search_path='' as $$
declare e public.events;
begin
 select * into e from public.events where id=p_event_id and organizer_id=auth.uid() and admission_type='free';
 if not found then raise exception using errcode='42501',message='Event unavailable'; end if;
 return e;
end;
$$;
create function public.get_organizer_free_registration_metrics(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e public.events;
begin
 e:=private.require_owned_free_event(p_event_id);
 if exists(select 1 from public.free_registrations r where r.event_id=e.id and not private.free_registration_is_coherent(r.id)) then
  raise exception using errcode='P0001',message='Operations data unavailable'; end if;
 return jsonb_build_object('eventId',e.id,
 'registrationCount',(select count(*) from public.free_registrations where event_id=e.id),
 'confirmedRegistrations',(select count(*) from public.free_registrations where event_id=e.id and status='confirmed'),
 'reservedAdmissions',private.free_reserved_admissions(e.id),
 'issued',(select count(*) from public.tickets where event_id=e.id and registration_id is not null),
 'checkedIn',(select count(*) from public.tickets where event_id=e.id and registration_id is not null and status='used'),
 'capacity',e.capacity,'remaining',case when e.capacity is null then null else greatest(0,e.capacity-private.free_reserved_admissions(e.id)) end);
end;
$$;
create function public.get_organizer_free_admissions(p_event_id uuid,p_search text default '',p_limit integer default 25,p_cursor jsonb default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e public.events; item record; rows jsonb:='[]'; next_cursor jsonb:=null; current_cursor jsonb:=null; n integer:=0; cursor_time timestamptz; cursor_id uuid;
begin
 e:=private.require_owned_free_event(p_event_id);
 if p_limit is null or p_limit not between 1 and 50 or p_search is null or char_length(p_search)>320 then
  raise exception using errcode='22023',message='Invalid admission query'; end if;
 if p_cursor is not null then
  if jsonb_typeof(p_cursor)<>'object' or (select array_agg(key order by key) from jsonb_object_keys(p_cursor) k(key)) is distinct from array['createdAt','ticketId']::text[]
   or jsonb_typeof(p_cursor->'createdAt') is distinct from 'string' or jsonb_typeof(p_cursor->'ticketId') is distinct from 'string' then
   raise exception using errcode='22023',message='Invalid admission query'; end if;
  begin cursor_time:=(p_cursor->>'createdAt')::timestamptz; cursor_id:=(p_cursor->>'ticketId')::uuid;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
   raise exception using errcode='22023',message='Invalid admission query'; end;
  if not isfinite(cursor_time) then raise exception using errcode='22023',message='Invalid admission query'; end if;
 end if;
 if btrim(p_search)='' then return jsonb_build_object('admissions',rows,'nextCursor',null); end if;
 for item in select r.id registration_id,r.name,r.email,r.status registration_status,r.created_at,r.quantity,
  t.id ticket_id,t.unit_sequence,t.admission_label,t.status,t.used_at
  from public.free_registrations r join public.tickets t on t.registration_id=r.id
  where r.event_id=e.id and r.organizer_id=e.organizer_id
   and (strpos(lower(r.name),lower(btrim(p_search)))>0 or r.email=lower(btrim(p_search)))
   and (cursor_id is null or (r.created_at,t.id)<(cursor_time,cursor_id))
  order by r.created_at desc,t.id desc limit p_limit+1 loop
  n:=n+1;
  if n>p_limit then next_cursor:=current_cursor; exit; end if;
  if not private.free_registration_is_coherent(item.registration_id) then
   raise exception using errcode='P0001',message='Operations data unavailable'; end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('sourceKind','free_registration','registrationId',item.registration_id,
   'registrantName',item.name,'registrantEmail',item.email,'registrationStatus',item.registration_status,'createdAt',item.created_at,
   'ticketId',item.ticket_id,'ticketPosition',item.unit_sequence,'ticketTotal',item.quantity,'admissionLabel',item.admission_label,
   'status',item.status,'usedAt',item.used_at,'admissionEligible',item.status='valid' and item.registration_status='confirmed'
    and e.status='published' and e.ends_at>statement_timestamp() and isfinite(e.ends_at) and e.ends_at>e.starts_at));
  current_cursor:=jsonb_build_object('createdAt',item.created_at,'ticketId',item.ticket_id);
 end loop;
 return jsonb_build_object('admissions',rows,'nextCursor',next_cursor);
end;
$$;
create table private.free_rsvp_rate_buckets(
 identity_hash text not null check(identity_hash ~ '^[0-9a-f]{64}$'),
 operation text not null check(operation in ('create','status')),
 window_start timestamptz not null,
 attempts integer not null check(attempts>0),
 primary key(identity_hash,operation,window_start)
);
create function public.server_consume_free_rsvp_rate_limit(p_identity_hash text,p_operation text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n integer; start_at timestamptz:=date_trunc('minute',clock_timestamp()); max_attempts integer;
begin
 if p_identity_hash is null or p_identity_hash !~ '^[0-9a-f]{64}$' or p_operation is null or p_operation not in ('create','status') then
  raise exception using errcode='22023',message='Invalid rate limit identity'; end if;
 max_attempts:=case p_operation when 'create' then 10 else 60 end;
 insert into private.free_rsvp_rate_buckets(identity_hash,operation,window_start,attempts) values(p_identity_hash,p_operation,start_at,1)
 on conflict(identity_hash,operation,window_start) do update set attempts=least(private.free_rsvp_rate_buckets.attempts+1,max_attempts+1)
 returning attempts into n;
 delete from private.free_rsvp_rate_buckets where window_start<start_at-interval '2 minutes';
 return jsonb_build_object('allowed',n<=max_attempts,'retryAfterSeconds',case when n<=max_attempts then 0 else greatest(1,ceil(extract(epoch from start_at+interval '1 minute'-clock_timestamp()))::integer) end);
end;
$$;
revoke all on private.free_rsvp_rate_buckets from public,anon,authenticated,service_role;
revoke all on function private.require_owned_free_event(uuid),public.get_organizer_free_registration_metrics(uuid),public.get_organizer_free_admissions(uuid,text,integer,jsonb),public.server_consume_free_rsvp_rate_limit(text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_organizer_free_registration_metrics(uuid),public.get_organizer_free_admissions(uuid,text,integer,jsonb) to authenticated;
grant execute on function public.server_consume_free_rsvp_rate_limit(text,text) to service_role;
