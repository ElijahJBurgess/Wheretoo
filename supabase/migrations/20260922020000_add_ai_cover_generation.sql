-- Bounded, request-driven generation. Canonical attachment mutations stay in Phase 1.
create table private.event_cover_limits (
  singleton boolean primary key default true check(singleton),
  event_daily integer not null default 3 check(event_daily between 1 and 100),
  organizer_daily integer not null default 10 check(organizer_daily between 1 and 1000),
  retention_days integer not null default 7 check(retention_days between 1 and 30)
);
insert into private.event_cover_limits default values;
alter table private.event_cover_limits enable row level security;
revoke all on private.event_cover_limits from public,anon,authenticated,service_role;
alter table private.event_cover_generations
  add column context jsonb not null default '{}',
  add column expires_at timestamptz not null default (now()+interval '7 days'),
  add column active_until timestamptz not null default (now()+interval '15 minutes'),
  add column cleanup_paths text[] not null default '{}',
  add column cleanup_done boolean not null default false;
alter table private.event_cover_candidates
  add column attempts integer not null default 0 check(attempts between 0 and 2),
  add column claim_token uuid,
  add column lease_until timestamptz;
create index event_cover_generations_organizer_idx on private.event_cover_generations(organizer_id,created_at);

create function private.recover_cover_work(p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  -- Caller holds the organizer advisory lock. Never starts provider work on recovery.
  update private.event_cover_candidates c set status='failed',failure_code='COVER_STALE',claim_token=null,lease_until=null,updated_at=now()
  from private.event_cover_generations g join private.event_cover_state s on s.event_id=g.event_id
  where g.id=c.generation_id and g.organizer_id=p_actor and c.status='pending'
    and (s.latest_generation_id is distinct from g.id or s.revision<>g.expected_revision or g.selected_slot is not null);
  update private.event_cover_candidates c set status='failed',failure_code='PROVIDER_TIMEOUT',claim_token=null,lease_until=null,updated_at=now()
  from private.event_cover_generations g where g.id=c.generation_id and g.organizer_id=p_actor and c.status='pending'
    and (g.active_until<=now() or (c.lease_until is not null and c.lease_until<=now()));
end; $$;

create or replace function public.create_event_cover_generation(p_event_id uuid,p_request_id uuid,p_expected_revision bigint,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare r bigint; g private.event_cover_generations; e public.events; cfg private.event_cover_limits; day_start timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('cover:'||auth.uid(),0));
  r:=private.lock_event_cover(p_event_id,auth.uid());
  select * into g from private.event_cover_generations where id=p_request_id;
  if found then
    if g.event_id<>p_event_id or g.organizer_id<>auth.uid() or g.expected_revision is distinct from p_expected_revision or g.input is distinct from p_input then raise exception 'COVER_REQUEST_CONFLICT'; end if;
    return public.get_event_cover_generation(g.id);
  end if;
  if r is distinct from p_expected_revision then raise exception 'COVER_STALE'; end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>4096
    or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('mood','direction'))
    or (p_input ? 'mood' and (jsonb_typeof(p_input->'mood')<>'string' or p_input->>'mood' not in ('Nightlife','Editorial','Minimal','Colorful','Underground','Luxury','Community','Energetic','Surprise me','editorial')))
    or (p_input ? 'direction' and (jsonb_typeof(p_input->'direction')<>'string' or length(p_input->>'direction')>300)) then raise exception 'COVER_INPUT_INVALID'; end if;
  perform private.recover_cover_work(auth.uid());
  if exists(select 1 from private.event_cover_generations x join private.event_cover_candidates c on c.generation_id=x.id where x.organizer_id=auth.uid() and c.status='pending') then raise exception 'COVER_ACTIVE'; end if;
  select * into cfg from private.event_cover_limits where singleton;
  day_start:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
  if (select count(*) from private.event_cover_generations where event_id=p_event_id and created_at>=day_start)>=cfg.event_daily then raise exception 'COVER_EVENT_LIMIT'; end if;
  if (select count(*) from private.event_cover_generations where organizer_id=auth.uid() and created_at>=day_start)>=cfg.organizer_daily then raise exception 'COVER_ORGANIZER_LIMIT'; end if;
  select * into e from public.events where id=p_event_id;
  if coalesce(length(btrim(e.title)),0)=0 then raise exception 'COVER_SAVE_DETAILS'; end if;
  insert into private.event_cover_generations(id,event_id,organizer_id,expected_revision,input,context,expires_at)
  values(p_request_id,p_event_id,auth.uid(),r,p_input,jsonb_build_object('title',left(e.title,120),'description',left(e.description,2000),'category',e.category,'city',left(e.city,160),'venue',e.venue_name,
    'timeOfDay',case when e.starts_at is null then null when extract(hour from e.starts_at at time zone e.timezone)<6 then 'late night' when extract(hour from e.starts_at at time zone e.timezone)<12 then 'morning' when extract(hour from e.starts_at at time zone e.timezone)<18 then 'afternoon' else 'evening' end),now()+make_interval(days=>cfg.retention_days));
  insert into private.event_cover_candidates(generation_id,slot) select p_request_id,n from generate_series(1,3)n;
  update private.event_cover_state set latest_generation_id=p_request_id where event_id=p_event_id;
  return public.get_event_cover_generation(p_request_id);
end; $$;

create or replace function public.get_event_cover_generation(p_generation_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare g private.event_cover_generations;
begin
  select * into g from private.event_cover_generations where id=p_generation_id and organizer_id=auth.uid();
  if not found or not exists(select 1 from public.events where id=g.event_id and organizer_id=auth.uid() and status in ('draft','published')) then raise exception 'COVER_NOT_OWNED'; end if;
  return jsonb_build_object('id',g.id,'eventId',g.event_id,'expectedRevision',g.expected_revision,'input',g.input,'expiresAt',g.expires_at,'expired',g.expires_at<=now(),
    'selectedSlot',g.selected_slot,'selectedImageId',g.selected_image_id,'selectedRevision',g.selected_revision,
    'candidates',(select jsonb_agg(jsonb_build_object('id',c.id,'slot',c.slot,'status',c.status,'path',case when g.expires_at>now() then c.object_path else null end,'failureCode',c.failure_code,'attempts',c.attempts,'retryAfter',c.updated_at+interval '15 seconds') order by c.slot)
    from private.event_cover_candidates c where c.generation_id=g.id));
end; $$;
create function public.server_recover_cover_generation(p_generation_id uuid,p_organizer_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare g private.event_cover_generations;
begin
  perform pg_advisory_xact_lock(hashtextextended('cover:'||p_organizer_id,0));
  select * into g from private.event_cover_generations where id=p_generation_id and organizer_id=p_organizer_id;
  if not found then raise exception 'COVER_NOT_OWNED'; end if;
  perform private.lock_event_cover(g.event_id,p_organizer_id);
  perform private.recover_cover_work(p_organizer_id);
end; $$;
create function public.server_claim_cover_candidate(p_generation_id uuid,p_slot smallint,p_organizer_id uuid,p_attempt integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g private.event_cover_generations; c private.event_cover_candidates; r bigint; token uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('cover:'||p_organizer_id,0));
  select * into g from private.event_cover_generations where id=p_generation_id and organizer_id=p_organizer_id;
  if not found then raise exception 'COVER_NOT_OWNED'; end if;
  r:=private.lock_event_cover(g.event_id,p_organizer_id);
  perform private.recover_cover_work(p_organizer_id);
  if g.selected_slot is not null or g.expires_at<=now() or g.expected_revision<>r or (select latest_generation_id from private.event_cover_state where event_id=g.event_id) is distinct from g.id then raise exception 'COVER_STALE'; end if;
  if coalesce(length(btrim(g.context->>'title')),0)=0 then raise exception 'COVER_SAVE_DETAILS'; end if;
  select * into c from private.event_cover_candidates where generation_id=g.id and slot=p_slot for update;
  if not found or p_attempt is null or p_attempt<0 then raise exception 'COVER_INPUT_INVALID'; end if;
  -- Caller supplies the observed attempt number, so replay cannot spend another attempt.
  if c.attempts<>p_attempt or c.status='ready' or c.claim_token is not null then return jsonb_build_object('claimed',false); end if;
  if c.attempts>=2 then raise exception 'COVER_RETRY_LIMIT'; end if;
  if c.status='failed' and (c.failure_code not in ('PROVIDER_TIMEOUT','PROVIDER_FAILED','PROVIDER_RATE_LIMIT','STORAGE_FAILED','INVALID_PROVIDER_IMAGE') or c.updated_at+interval '15 seconds'>now()) then raise exception 'COVER_RETRY_UNAVAILABLE'; end if;
  if exists(select 1 from private.event_cover_generations x join private.event_cover_candidates y on y.generation_id=x.id where x.organizer_id=p_organizer_id and x.id<>g.id and y.status='pending') then raise exception 'COVER_ACTIVE'; end if;
  token:=gen_random_uuid();
  update private.event_cover_candidates set status='pending',failure_code=null,attempts=attempts+1,claim_token=token,lease_until=now()+interval '140 seconds',updated_at=now() where generation_id=g.id and slot=p_slot;
  update private.event_cover_generations set active_until=now()+interval '15 minutes' where id=g.id;
  return jsonb_build_object('claimed',true,'claimToken',token,'eventId',g.event_id,'candidateId',c.id,'context',g.context,'input',g.input);
end; $$;
create function public.server_finish_cover_candidate(p_generation_id uuid,p_slot smallint,p_claim_token uuid,p_path text,p_failure_code text default null) returns void
language plpgsql security definer set search_path='' as $$
declare g private.event_cover_generations; c private.event_cover_candidates;
begin
  select * into g from private.event_cover_generations where id=p_generation_id;
  if not found then raise exception 'COVER_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cover:'||g.organizer_id,0));
  perform private.lock_event_cover(g.event_id,g.organizer_id);
  select * into c from private.event_cover_candidates where generation_id=g.id and slot=p_slot for update;
  if c.claim_token is distinct from p_claim_token or p_claim_token is null or c.lease_until<=now() then raise exception 'COVER_CLAIM_LOST'; end if;
  perform public.server_complete_event_cover_candidate(g.id,p_slot,p_path,p_failure_code);
  update private.event_cover_candidates set claim_token=null,lease_until=null where generation_id=g.id and slot=p_slot;
end; $$;
-- Expired previews cannot be newly signed; existing short-lived signed URLs expire naturally.
create or replace function private.can_read_cover_candidate(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.event_cover_candidates c join private.event_cover_generations g on g.id=c.generation_id
  join public.events e on e.id=g.event_id where c.object_path=p_path and c.status='ready' and g.expires_at>now()
  and g.organizer_id=auth.uid() and e.organizer_id=auth.uid() and e.status in ('draft','published'));
$$;
-- Bounded request-driven retention. Keep durable deletion receipts until Storage confirms.
create function public.server_expire_cover_candidates(p_organizer_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g private.event_cover_generations; paths text[]; result jsonb:='[]';
begin
  perform pg_advisory_xact_lock(hashtextextended('cover:'||p_organizer_id,0));
  for g in select * from private.event_cover_generations where organizer_id=p_organizer_id and expires_at<=now() and not cleanup_done order by expires_at limit 10 loop
    -- Lock even cancelled events; expiration must not depend on edit eligibility.
    perform 1 from public.events where id=g.event_id for update;
    -- Include deterministic paths for interrupted uploads not yet recorded as ready.
    select array_agg(g.event_id||'/'||g.id||'/'||id||'.png') into paths from private.event_cover_candidates where generation_id=g.id;
    select array_agg(distinct p) into paths from unnest(coalesce(paths,'{}')||g.cleanup_paths||coalesce((select array_agg(object_path) from private.event_cover_candidates where generation_id=g.id and object_path is not null),'{}')) p;
    update private.event_cover_candidates set status='failed',object_path=null,failure_code='EXPIRED',claim_token=null,lease_until=null where generation_id=g.id;
    update private.event_cover_generations set cleanup_paths=paths where id=g.id;
    result:=result||jsonb_build_array(jsonb_build_object('id',g.id,'paths',paths));
  end loop;
  return result;
end; $$;
create function public.server_ack_cover_cleanup(p_generation_id uuid) returns void
language sql security definer set search_path='' as $$
  update private.event_cover_generations set cleanup_paths='{}',cleanup_done=true where id=p_generation_id and expires_at<=now();
$$;
revoke all on function private.recover_cover_work(uuid),public.server_recover_cover_generation(uuid,uuid),public.server_claim_cover_candidate(uuid,smallint,uuid,integer),public.server_finish_cover_candidate(uuid,smallint,uuid,text,text),public.server_expire_cover_candidates(uuid),public.server_ack_cover_cleanup(uuid) from public,anon,authenticated,service_role;
grant execute on function public.server_recover_cover_generation(uuid,uuid),public.server_claim_cover_candidate(uuid,smallint,uuid,integer),public.server_finish_cover_candidate(uuid,smallint,uuid,text,text),public.server_expire_cover_candidates(uuid),public.server_ack_cover_cleanup(uuid) to service_role;

create or replace function public.server_get_event_cover_candidate(p_generation_id uuid,p_slot smallint,p_organizer_id uuid,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g private.event_cover_generations; c private.event_cover_candidates; r bigint;
begin
  select * into g from private.event_cover_generations where id=p_generation_id and organizer_id=p_organizer_id;
  if not found then raise exception 'COVER_NOT_OWNED'; end if;
  r:=private.lock_event_cover(g.event_id,p_organizer_id);
  select * into g from private.event_cover_generations where id=p_generation_id;
  if g.selected_slot is not null then
    if g.selected_slot<>p_slot then raise exception 'COVER_ALREADY_SELECTED'; end if;
    return jsonb_build_object('selected',true,'eventId',g.event_id,'revision',g.selected_revision,'currentRevision',r,'imageId',g.selected_image_id);
  end if;
  if g.expires_at<=now() then raise exception 'COVER_EXPIRED'; end if;
  if r is distinct from p_expected_revision or r<>g.expected_revision
    or (select latest_generation_id from private.event_cover_state where event_id=g.event_id) is distinct from g.id then raise exception 'COVER_STALE'; end if;
  select * into c from private.event_cover_candidates where generation_id=g.id and slot=p_slot and status='ready';
  if not found then raise exception 'COVER_CANDIDATE_NOT_READY'; end if;
  return jsonb_build_object('selected',false,'eventId',g.event_id,'revision',r,'candidateId',c.id,'path',c.object_path);
end; $$;


-- Reconcile bytes persisted before a process died, even after the attempt budget.
-- No provider execution, new claim or attempt increment is authorized here.
create function public.server_cover_recovery_objects(p_generation_id uuid,p_organizer_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g private.event_cover_generations; r bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('cover:'||p_organizer_id,0));
  select * into g from private.event_cover_generations where id=p_generation_id and organizer_id=p_organizer_id;
  if not found then raise exception 'COVER_NOT_OWNED'; end if;
  r:=private.lock_event_cover(g.event_id,p_organizer_id);
  if g.selected_slot is not null or g.expected_revision<>r or g.expires_at<=now() or (select latest_generation_id from private.event_cover_state where event_id=g.event_id) is distinct from g.id then return '[]'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('slot',slot,'path',g.event_id||'/'||g.id||'/'||id||'.png')),'[]') from private.event_cover_candidates where generation_id=g.id and attempts>0 and status<>'ready' and (lease_until is null or lease_until<=now()));
end; $$;
create function public.server_reconcile_cover_object(p_generation_id uuid,p_organizer_id uuid,p_slot smallint,p_path text) returns void
language plpgsql security definer set search_path='' as $$
declare eligible jsonb; c private.event_cover_candidates;
begin
  eligible:=public.server_cover_recovery_objects(p_generation_id,p_organizer_id);
  if not exists(select 1 from jsonb_array_elements(eligible) x where (x->>'slot')::smallint=p_slot and x->>'path'=p_path) then raise exception 'COVER_CLAIM_LOST'; end if;
  select * into c from private.event_cover_candidates where generation_id=p_generation_id and slot=p_slot for update;
  update private.event_cover_candidates set status='pending',failure_code=null,claim_token=null,lease_until=null where generation_id=p_generation_id and slot=p_slot;
  perform public.server_complete_event_cover_candidate(p_generation_id,p_slot,p_path,null);
end; $$;
revoke all on function public.server_cover_recovery_objects(uuid,uuid),public.server_reconcile_cover_object(uuid,uuid,smallint,text) from public,anon,authenticated,service_role;
grant execute on function public.server_cover_recovery_objects(uuid,uuid),public.server_reconcile_cover_object(uuid,uuid,smallint,text) to service_role;
