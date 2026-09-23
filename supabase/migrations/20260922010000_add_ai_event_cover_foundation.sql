-- AI Event Cover Phase 1. No provider, worker, scheduler or public candidate assets.
create table private.event_cover_state (
  event_id uuid primary key references public.events(id) on delete cascade,
  revision bigint not null default 0 check (revision between 0 and 9007199254740991),
  latest_generation_id uuid
);
create table private.event_cover_generations (
  id uuid primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  organizer_id uuid not null references public.organizers(id),
  expected_revision bigint not null check (expected_revision >= 0),
  input jsonb not null check (jsonb_typeof(input)='object' and octet_length(input::text)<=4096),
  selected_slot smallint check (selected_slot between 1 and 3),
  selected_image_id uuid,
  selected_revision bigint,
  created_at timestamptz not null default now(),
  check (num_nonnulls(selected_slot,selected_image_id,selected_revision) in (0,3))
);
create index event_cover_generations_event_idx on private.event_cover_generations(event_id,created_at desc);
create table private.event_cover_candidates (
  id uuid not null unique default gen_random_uuid(),
  generation_id uuid not null references private.event_cover_generations(id) on delete cascade,
  slot smallint not null check (slot between 1 and 3),
  status text not null default 'pending' check (status in ('pending','ready','failed')),
  object_path text unique,
  failure_code text check (length(failure_code)<=80),
  updated_at timestamptz not null default now(),
  primary key (generation_id,slot),
  check ((status='ready' and object_path is not null and failure_code is null)
    or (status='pending' and object_path is null and failure_code is null)
    or (status='failed' and object_path is null and failure_code is not null))
);
revoke all on private.event_cover_state,private.event_cover_generations,private.event_cover_candidates from public,anon,authenticated,service_role;
alter table private.event_cover_state enable row level security;
alter table private.event_cover_generations enable row level security;
alter table private.event_cover_candidates enable row level security;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('event-cover-candidates','event-cover-candidates',false,5242880,array['image/jpeg','image/png','image/webp']);

create function private.lock_event_cover(p_event uuid,p_actor uuid) returns bigint
language plpgsql security definer set search_path='' as $$
declare r bigint;
begin
  -- Same lock order as existing publication/cancellation and image mutations.
  perform 1 from public.events where id=p_event and organizer_id=p_actor and status in ('draft','published') for update;
  if not found then raise exception 'COVER_NOT_OWNED'; end if;
  insert into private.event_cover_state(event_id) values(p_event) on conflict do nothing;
  select revision into r from private.event_cover_state where event_id=p_event for update;
  return r;
end; $$;
create function public.get_event_cover_state(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.events where id=p_event_id and organizer_id=auth.uid() and status in ('draft','published')) then raise exception 'COVER_NOT_OWNED'; end if;
  return jsonb_build_object('revision',coalesce((select revision from private.event_cover_state where event_id=p_event_id),0),
    'latestGenerationId',(select latest_generation_id from private.event_cover_state where event_id=p_event_id),
    'images',public.list_event_images(array[p_event_id]));
end; $$;
create function public.get_event_cover_generation(p_generation_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare g private.event_cover_generations;
begin
  select * into g from private.event_cover_generations where id=p_generation_id and organizer_id=auth.uid();
  if not found or not exists(select 1 from public.events where id=g.event_id and organizer_id=auth.uid() and status in ('draft','published')) then raise exception 'COVER_NOT_OWNED'; end if;
  return jsonb_build_object('id',g.id,'eventId',g.event_id,'expectedRevision',g.expected_revision,'input',g.input,
    'selectedSlot',g.selected_slot,'selectedImageId',g.selected_image_id,'selectedRevision',g.selected_revision,
    'candidates',(select jsonb_agg(jsonb_build_object('id',c.id,'slot',c.slot,'status',c.status,'path',c.object_path,'failureCode',c.failure_code) order by c.slot)
    from private.event_cover_candidates c where c.generation_id=g.id));
end; $$;
create function public.create_event_cover_generation(p_event_id uuid,p_request_id uuid,p_expected_revision bigint,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare r bigint; g private.event_cover_generations;
begin
  r:=private.lock_event_cover(p_event_id,auth.uid());
  select * into g from private.event_cover_generations where id=p_request_id;
  if found then
    if g.event_id<>p_event_id or g.organizer_id<>auth.uid() or g.expected_revision is distinct from p_expected_revision or g.input is distinct from p_input then raise exception 'COVER_REQUEST_CONFLICT'; end if;
    return public.get_event_cover_generation(g.id);
  end if;
  if r is distinct from p_expected_revision then raise exception 'COVER_STALE'; end if;
  insert into private.event_cover_generations(id,event_id,organizer_id,expected_revision,input) values(p_request_id,p_event_id,auth.uid(),r,p_input);
  insert into private.event_cover_candidates(generation_id,slot) select p_request_id,n from generate_series(1,3) n;
  update private.event_cover_state set latest_generation_id=p_request_id where event_id=p_event_id;
  return public.get_event_cover_generation(p_request_id);
end; $$;

create function private.can_read_cover_candidate(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.event_cover_candidates c join private.event_cover_generations g on g.id=c.generation_id
    join public.events e on e.id=g.event_id where c.object_path=p_path and c.status='ready'
    and g.organizer_id=auth.uid() and e.organizer_id=auth.uid() and e.status in ('draft','published'));
$$;
create policy event_cover_candidates_read on storage.objects for select to authenticated
using(bucket_id='event-cover-candidates' and private.can_read_cover_candidate(name));
-- No browser INSERT, UPDATE or DELETE on candidate storage.

create function public.server_complete_event_cover_candidate(p_generation_id uuid,p_slot smallint,p_path text,p_failure_code text default null) returns void
language plpgsql security definer set search_path='' as $$
declare g private.event_cover_generations; c private.event_cover_candidates; o storage.objects;
begin
  select * into g from private.event_cover_generations where id=p_generation_id;
  if not found then raise exception 'COVER_NOT_FOUND'; end if;
  perform private.lock_event_cover(g.event_id,g.organizer_id);
  select * into c from private.event_cover_candidates where generation_id=g.id and slot=p_slot for update;
  if not found then raise exception 'COVER_CANDIDATE_INVALID'; end if;
  if c.status<>'pending' then
    if c.object_path is not distinct from p_path and c.failure_code is not distinct from p_failure_code then return; end if;
    raise exception 'COVER_CANDIDATE_FINAL';
  end if;
  if p_path is not null then
    select * into o from storage.objects where bucket_id='event-cover-candidates' and name=p_path;
    if not found or p_path !~ ('^'||g.event_id||'/'||g.id||'/'||c.id||'\.(jpg|png|webp)$')
      or o.metadata->>'mimetype' not in ('image/jpeg','image/png','image/webp')
      or coalesce((o.metadata->>'size')::bigint,0) not between 1 and 5242880 or p_failure_code is not null then raise exception 'COVER_CANDIDATE_INVALID'; end if;
  elsif p_failure_code is null then raise exception 'COVER_CANDIDATE_INVALID'; end if;
  update private.event_cover_candidates set status=case when p_path is null then 'failed' else 'ready' end,
    object_path=p_path,failure_code=p_failure_code,updated_at=now() where generation_id=g.id and slot=p_slot;
end; $$;

-- All new canonical-bucket writes are private staged objects until the guarded commit.
-- Legacy clients fail closed rather than appending/removing artwork without a revision.
create or replace function private.attach_uploaded_event_image() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.bucket_id<>'event-images' then return new; end if;
  if new.name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$' then raise exception 'INVALID_IMAGE_PATH'; end if;
  perform private.lock_event_cover(split_part(new.name,'/',1)::uuid,(new.user_metadata->>'organizer_id')::uuid);
  if new.user_metadata->>'cover_staged' is distinct from 'true' then raise exception 'COVER_REVISION_REQUIRED'; end if;
  if new.version='1' then return new; end if;
  if new.metadata->>'mimetype' not in ('image/jpeg','image/png','image/webp') or new.metadata->>'mimetype' is null
    or coalesce((new.metadata->>'size')::bigint,0) not between 1 and 5242880
    or (new.metadata->>'mimetype'='image/jpeg' and new.name !~ '\.(jpg|jpeg)$')
    or (new.metadata->>'mimetype'='image/png' and new.name !~ '\.png$')
    or (new.metadata->>'mimetype'='image/webp' and new.name !~ '\.webp$') then raise exception 'INVALID_IMAGE_FILE'; end if;
  return new;
end; $$;
create or replace function private.prevent_event_image_overwrite() returns trigger
language plpgsql set search_path='' as $$
begin
  if (old.bucket_id in ('event-images','event-cover-candidates') or new.bucket_id in ('event-images','event-cover-candidates'))
    and row(old.name,old.bucket_id,old.version,old.metadata,old.owner_id,old.user_metadata)
      is distinct from row(new.name,new.bucket_id,new.version,new.metadata,new.owner_id,new.user_metadata)
    then raise exception 'EVENT_IMAGE_IMMUTABLE'; end if;
  return new;
end; $$;
drop policy event_images_delete on storage.objects;
revoke execute on function public.reorder_event_images(uuid,uuid[]) from authenticated;

create function public.server_get_event_cover_candidate(p_generation_id uuid,p_slot smallint,p_organizer_id uuid,p_expected_revision bigint) returns jsonb
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
  if r is distinct from p_expected_revision or r<>g.expected_revision
    or (select latest_generation_id from private.event_cover_state where event_id=g.event_id) is distinct from g.id then raise exception 'COVER_STALE'; end if;
  select * into c from private.event_cover_candidates where generation_id=g.id and slot=p_slot and status='ready';
  if not found then raise exception 'COVER_CANDIDATE_NOT_READY'; end if;
  return jsonb_build_object('selected',false,'eventId',g.event_id,'revision',r,'candidateId',c.id,'path',c.object_path);
end; $$;

create function public.server_commit_event_cover(p_event_id uuid,p_organizer_id uuid,p_expected_revision bigint,p_path text,p_generation_id uuid default null,p_slot smallint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r bigint; o storage.objects; result jsonb; retired jsonb; c private.event_cover_candidates;
begin
  r:=private.lock_event_cover(p_event_id,p_organizer_id);
  if p_generation_id is not null then
    result:=public.server_get_event_cover_candidate(p_generation_id,p_slot,p_organizer_id,p_expected_revision);
    if (result->>'eventId')::uuid<>p_event_id then raise exception 'COVER_CANDIDATE_INVALID'; end if;
    if (result->>'selected')::boolean then return result; end if;
    select * into c from private.event_cover_candidates where generation_id=p_generation_id and slot=p_slot;
    if p_path is distinct from (p_event_id||'/'||c.id||'.'||split_part(c.object_path,'.',2)) then raise exception 'COVER_CANDIDATE_INVALID'; end if;
  end if;
  select * into o from storage.objects where bucket_id='event-images' and name=p_path;
  if not found or split_part(p_path,'/',1)<>p_event_id::text or o.user_metadata->>'organizer_id' is distinct from p_organizer_id::text
    or o.user_metadata->>'cover_staged' is distinct from 'true' then raise exception 'COVER_OBJECT_NOT_READY'; end if;
  -- A lost manual response can be replayed only while its object is still attached.
  if p_generation_id is null and exists(select 1 from private.event_images where event_id=p_event_id and id=o.id and position=1) then
    return jsonb_build_object('revision',r,'imageId',o.id,'retired','[]'::jsonb);
  end if;
  if r is distinct from p_expected_revision or o.user_metadata->>'cover_revision' is distinct from p_expected_revision::text then raise exception 'COVER_STALE'; end if;
  if p_generation_id is not null and o.user_metadata->>'candidate_id' is distinct from c.id::text then raise exception 'COVER_CANDIDATE_INVALID'; end if;
  select coalesce(jsonb_agg(object_path),'[]') into retired from private.event_images where event_id=p_event_id;
  delete from private.event_images where event_id=p_event_id;
  insert into private.event_images(id,event_id,object_path,position) values(o.id,p_event_id,p_path,1);
  update private.event_cover_state set revision=revision+1 where event_id=p_event_id returning revision into r;
  if p_generation_id is not null then
    update private.event_cover_generations set selected_slot=p_slot,selected_image_id=o.id,selected_revision=r where id=p_generation_id;
  end if;
  return jsonb_build_object('revision',r,'imageId',o.id,'retired',retired);
end; $$;
create function public.server_remove_event_cover(p_event_id uuid,p_organizer_id uuid,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r bigint; retired jsonb;
begin
  r:=private.lock_event_cover(p_event_id,p_organizer_id);
  if r=p_expected_revision+1 and not exists(select 1 from private.event_images where event_id=p_event_id) then
    return jsonb_build_object('revision',r,'retired','[]'::jsonb);
  end if;
  if r is distinct from p_expected_revision then raise exception 'COVER_STALE'; end if;
  select coalesce(jsonb_agg(object_path),'[]') into retired from private.event_images where event_id=p_event_id;
  delete from private.event_images where event_id=p_event_id;
  update private.event_cover_state set revision=revision+1 where event_id=p_event_id returning revision into r;
  return jsonb_build_object('revision',r,'retired',retired);
end; $$;

revoke all on function private.lock_event_cover(uuid,uuid),private.can_read_cover_candidate(text),
 public.get_event_cover_state(uuid),public.get_event_cover_generation(uuid),public.create_event_cover_generation(uuid,uuid,bigint,jsonb),
 public.server_complete_event_cover_candidate(uuid,smallint,text,text),public.server_get_event_cover_candidate(uuid,smallint,uuid,bigint),
 public.server_commit_event_cover(uuid,uuid,bigint,text,uuid,smallint),public.server_remove_event_cover(uuid,uuid,bigint)
 from public,anon,authenticated,service_role;
grant execute on function private.can_read_cover_candidate(text),public.get_event_cover_state(uuid),public.get_event_cover_generation(uuid),public.create_event_cover_generation(uuid,uuid,bigint,jsonb) to authenticated;
grant execute on function public.server_complete_event_cover_candidate(uuid,smallint,text,text),public.server_get_event_cover_candidate(uuid,smallint,uuid,bigint),public.server_commit_event_cover(uuid,uuid,bigint,text,uuid,smallint),public.server_remove_event_cover(uuid,uuid,bigint) to service_role;
