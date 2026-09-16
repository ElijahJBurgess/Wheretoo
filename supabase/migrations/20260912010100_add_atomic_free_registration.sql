create function public.server_confirm_free_registration(
 p_request_id uuid,p_event_id uuid,p_name text,p_email text,p_quantity integer,p_access_hash text,p_ticket_manifest jsonb
) returns jsonb language plpgsql security definer set search_path='' as $registration$
declare q public.free_registration_requests; e public.events; r_id uuid; v_result jsonb; remaining bigint; m jsonb;
begin
 if p_request_id is null or p_access_hash is null or p_access_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('kind','unavailable'); end if;
 -- A disjoint advisory namespace serializes the first receipt, including retries
 -- before an event row exists. No event mutation ever takes this request lock.
 perform pg_advisory_xact_lock(hashtextextended('free-request:'||p_request_id::text,0));
 select * into q from public.free_registration_requests where id=p_request_id;
 if found then
  if q.access_hash<>p_access_hash then return jsonb_build_object('kind','unavailable'); end if;
  if row(q.event_id,q.name,q.email,q.quantity) is distinct from row(p_event_id,p_name,p_email,p_quantity) then return jsonb_build_object('kind','conflict'); end if;
  return q.result;
 end if;
 -- A reused proof cannot identify two sources. ON CONFLICT also handles two
 -- different request IDs concurrently proposing the same proof.
 insert into public.free_registration_requests(id,event_id,name,email,quantity,access_hash)
 values(p_request_id,p_event_id,p_name,p_email,p_quantity,p_access_hash) on conflict(access_hash) do nothing;
 if not found then return jsonb_build_object('kind','unavailable'); end if;
 if p_event_id is null or p_quantity is null or p_quantity not between 1 and 10
  or p_name is null or char_length(p_name) not between 1 and 200
  or p_name<>btrim(regexp_replace(p_name,'[[:space:]]+',' ','g')) or p_name ~ '[[:cntrl:]]'
  or p_email is null or char_length(p_email)>320 or p_email<>lower(btrim(p_email))
  or p_email !~ $email$^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$$email$ then
  v_result:=jsonb_build_object('kind','rejected','reason','invalid_input');
 else
  perform public.lock_event_ticketing_operation(p_event_id);
  select * into e from public.events where id=p_event_id for update;
  if not found or e.admission_type<>'free' or not private.event_is_publicly_eligible(p_event_id,clock_timestamp()) then
   v_result:=jsonb_build_object('kind','rejected','reason','unavailable');
  else
   remaining:=case when e.capacity is null then null else greatest(0,e.capacity-private.free_reserved_admissions(e.id)) end;
   if remaining is not null and remaining<p_quantity then
    v_result:=jsonb_build_object('kind','rejected','reason','full','remaining',remaining);
   else
    -- Invalid server manifests are infrastructure errors: roll back the receipt.
    if jsonb_typeof(p_ticket_manifest) is distinct from 'array' then raise exception using errcode='P0001',message='FREE_MANIFEST_INVALID'; end if;
    if jsonb_array_length(p_ticket_manifest)<>p_quantity then raise exception using errcode='P0001',message='FREE_MANIFEST_INVALID'; end if;
    for m in select value from jsonb_array_elements(p_ticket_manifest) loop
     if jsonb_typeof(m)<>'object' then raise exception using errcode='P0001',message='FREE_MANIFEST_INVALID'; end if;
     if (select array_agg(key order by key) from jsonb_object_keys(m) k(key)) is distinct from array['credential_hash','unit_sequence']::text[]
      or jsonb_typeof(m->'unit_sequence') is distinct from 'number' or (m->>'unit_sequence') !~ '^([1-9]|10)$'
      or jsonb_typeof(m->'credential_hash') is distinct from 'string' or (m->>'credential_hash') !~ '^[0-9a-f]{64}$' then
      raise exception using errcode='P0001',message='FREE_MANIFEST_INVALID'; end if;
    end loop;
    if exists(select 1 from jsonb_array_elements(p_ticket_manifest) a where (a->>'unit_sequence')::integer>p_quantity)
     or (select count(distinct a->>'unit_sequence') from jsonb_array_elements(p_ticket_manifest) a)<>p_quantity
     or (select count(distinct a->>'credential_hash') from jsonb_array_elements(p_ticket_manifest) a)<>p_quantity then
     raise exception using errcode='P0001',message='FREE_MANIFEST_INVALID'; end if;
    insert into public.free_registrations(request_id,event_id,organizer_id,name,email,quantity,access_hash)
    values(p_request_id,p_event_id,e.organizer_id,p_name,p_email,p_quantity,p_access_hash) returning id into r_id;
    insert into public.tickets(registration_id,event_id,organizer_id,unit_sequence,admission_label,credential_hash)
    select r_id,p_event_id,e.organizer_id,(a->>'unit_sequence')::integer,'General Admission',decode(a->>'credential_hash','hex')
    from jsonb_array_elements(p_ticket_manifest) a;
    v_result:=jsonb_build_object('kind','confirmed','registrationId',r_id,'eventId',p_event_id,'quantity',p_quantity);
   end if;
  end if;
 end if;
 update public.free_registration_requests set result=v_result where id=p_request_id;
 return v_result;
end;
$registration$;
create function public.server_resolve_free_registration(p_request_id uuid,p_access_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.free_registration_requests;
begin
 if p_request_id is null or p_access_hash is null or p_access_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('kind','unavailable'); end if;
 select * into q from public.free_registration_requests where id=p_request_id;
 if not found then return jsonb_build_object('kind','not_found'); end if;
 if q.access_hash<>p_access_hash then return jsonb_build_object('kind','unavailable'); end if;
 return q.result;
end;
$$;
create function public.server_lookup_free_ticket_collection(p_access_hash text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('registration_id',r.id,'request_id',r.request_id,'event_id',e.id,'organizer_id',r.organizer_id,
 'registration_status',r.status,'quantity',r.quantity,'name',r.name,'event_title',e.title,'event_starts_at',e.starts_at,
 'event_ends_at',e.ends_at,'event_timezone',e.timezone,'event_venue_name',e.venue_name,'event_status',e.status,
 'event_address',concat_ws(', ',nullif(e.address_line1,''),nullif(e.address_line2,''),nullif(e.city,''),nullif(e.region,''),nullif(e.postal_code,'')),
 'tickets',(select jsonb_agg(jsonb_build_object('id',t.id,'unit_sequence',t.unit_sequence,'admission_label',t.admission_label,
 'status',t.status,'credential_hash',encode(t.credential_hash,'hex'),'used_at',t.used_at) order by t.unit_sequence) from public.tickets t where t.registration_id=r.id))
 from public.free_registrations r join public.events e on e.id=r.event_id
 where r.access_hash=p_access_hash and p_access_hash ~ '^[0-9a-f]{64}$'
 and private.free_registration_is_coherent(r.id)
 and (r.status='cancelled' or e.status='published');
$$;
create function public.get_public_free_rsvp(p_event_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('event',private.public_event_projection(e.id),'availability',jsonb_build_object(
 'status',case when e.capacity is not null and e.capacity<=private.free_reserved_admissions(e.id) then 'full' else 'available' end,
 'remaining',case when e.capacity is null then null else greatest(0,e.capacity-private.free_reserved_admissions(e.id)) end,'maxQuantity',10))
 from public.events e where e.id=p_event_id and e.admission_type='free' and private.event_is_publicly_eligible(e.id,statement_timestamp());
$$;
revoke all on function public.server_confirm_free_registration(uuid,uuid,text,text,integer,text,jsonb),public.server_resolve_free_registration(uuid,text),public.server_lookup_free_ticket_collection(text),public.get_public_free_rsvp(uuid) from public,anon,authenticated,service_role;
grant execute on function public.server_confirm_free_registration(uuid,uuid,text,text,integer,text,jsonb),public.server_resolve_free_registration(uuid,text),public.server_lookup_free_ticket_collection(text) to service_role;
grant execute on function public.get_public_free_rsvp(uuid) to anon,authenticated,service_role;
