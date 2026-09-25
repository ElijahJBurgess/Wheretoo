-- Private operational state only. public.events remains the sole event truth.
create table private.event_import_settings (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 destination_organizer_id uuid references public.organizers(id) on delete restrict,
 revision bigint not null default 1 check(revision>0), provider_paused boolean not null default false,
 budget_day date, budget_used integer not null default 0 check(budget_used>=0), budget_limit integer not null default 2500 check(budget_limit between 1 and 100000),
 updated_at timestamptz not null default now()
);
insert into private.event_import_settings(singleton) values(true);
create table private.event_import_batches (
 id uuid primary key default gen_random_uuid(), actor_id uuid not null references auth.users(id),
 destination_organizer_id uuid not null references public.organizers(id), config_revision bigint not null,
 request_id uuid not null, file_digest text not null check(file_digest ~ '^[a-f0-9]{64}$'), filename text not null check(length(filename) between 1 and 255),
 parser_version integer not null default 1, row_count integer not null check(row_count between 0 and 500),
 state text not null default 'uploaded' check(state in ('uploaded','validating','ready','importing','completed','completed_with_skips','failed','cancelled')),
 error_code text, created_at timestamptz not null default now(), validated_at timestamptz, imported_at timestamptz,cancelled_at timestamptz,pruned_at timestamptz,
 unique(actor_id,request_id)
);
create table private.event_import_rows (
 id uuid primary key default gen_random_uuid(),batch_id uuid not null references private.event_import_batches(id) on delete restrict,
 record_number integer not null check(record_number>1),start_line integer not null check(start_line>1),
 input jsonb not null check(jsonb_typeof(input)='object' and octet_length(input::text)<=65536),
 errors jsonb not null default '[]' check(jsonb_typeof(errors)='array' and octet_length(errors::text)<=8192),
 state text not null default 'pending' check(state in ('pending','geocoding','ready','needs_review','invalid','duplicate_possible','skipped','imported','failed')),
 revision bigint not null default 1,location jsonb,evidence jsonb,verified_at timestamptz,
 duplicate_candidates jsonb not null default '[]',duplicate_count integer not null default 0,duplicate_digest text,
 override_digest text,decision_actor uuid references auth.users(id),decision_at timestamptz,
 requested_by uuid references auth.users(id),requested_at timestamptz,
 lease_token uuid,lease_until timestamptz,attempts integer not null default 0,next_attempt_at timestamptz not null default now(),
 failure_code text,resulting_event_id uuid unique references public.events(id) on delete restrict,imported_by uuid references auth.users(id),imported_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(batch_id,record_number),check((lease_token is null)=(lease_until is null)),
 check((state='imported')=(resulting_event_id is not null)),check((resulting_event_id is null)=(imported_at is null)),
 check(location is null or (jsonb_typeof(location)='object' and octet_length(location::text)<=4096)),
 check(evidence is null or octet_length(evidence::text)<=4096)
);
create index event_import_batch_history on private.event_import_batches(created_at desc,id);
create index event_import_row_page on private.event_import_rows(batch_id,state,record_number);
create index event_import_due on private.event_import_rows(next_attempt_at,id) where state in ('pending','geocoding','failed');
do $$declare n text;begin foreach n in array array['settings','batches','rows'] loop
 execute format('alter table private.event_import_%I enable row level security',n);
 execute format('revoke all on private.event_import_%I from public,anon,authenticated,service_role',n);
end loop;end;$$;

create function private.import_actor(p_actor uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from private.staff_roles where user_id=p_actor and active and role='admin' for share;
 if not found then raise exception using errcode='42501',message='IMPORT_ADMIN_REQUIRED';end if;
end;$$;
create function private.import_destination() returns private.event_import_settings language plpgsql security definer set search_path='' as $$
declare s private.event_import_settings;
begin
 select * into s from private.event_import_settings where singleton for share;
 if not found or not s.enabled or s.destination_organizer_id is null then raise exception 'IMPORT_NOT_CONFIGURED';end if;
 perform 1 from public.organizers o join auth.users u on u.id=o.id where o.id=s.destination_organizer_id
 and o.onboarding_completed_at is not null and length(btrim(o.display_name))>=2 and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share of o,u;
 if not found then raise exception 'IMPORT_DESTINATION_INVALID';end if;return s;
end;$$;
create function private.import_lock(p_actor uuid,p_batch uuid,p_write boolean default true) returns private.event_import_batches language plpgsql security definer set search_path='' as $$
declare b private.event_import_batches;s private.event_import_settings;
begin
 perform private.import_actor(p_actor);
 select * into s from private.event_import_settings where singleton for share;
 select * into b from private.event_import_batches where id=p_batch for update;
 if not found then raise exception 'IMPORT_BATCH_NOT_FOUND';end if;
 if p_write then
  s:=private.import_destination();
  if b.destination_organizer_id<>s.destination_organizer_id or b.config_revision<>s.revision then raise exception 'IMPORT_CONFIGURATION_CHANGED';end if;
  if b.state in ('cancelled','failed') or b.pruned_at is not null then raise exception 'IMPORT_BATCH_CLOSED';end if;
 end if;return b;
end;$$;
create function private.import_normalize(p_text text) returns text language sql immutable security definer parallel safe set search_path='' as $$
 select btrim(regexp_replace(lower(normalize(coalesce(p_text,''),NFKC)),'[^[:alnum:]]+',' ','g'));
$$;
create function private.import_address(p_line text,p_unit text,p_city text,p_postal text,p_region text,p_country text) returns text language sql immutable security definer parallel safe set search_path='' as $$
 select concat_ws('|',private.import_normalize(p_line),private.import_normalize(p_unit),private.import_normalize(p_city),left(coalesce(p_postal,''),5),p_region,p_country);
$$;
create index event_import_match_feature on public.events(private.import_normalize(title),mapbox_feature_id,starts_at);
create index event_import_match_address on public.events(private.import_normalize(title),private.import_address(address_line1,address_line2,city,postal_code,region,country_code),starts_at);

create function private.import_input_valid(i jsonb,p_future boolean default true) returns boolean language plpgsql volatile set search_path='' as $$
declare s timestamptz;e timestamptz;c numeric;
begin
 if jsonb_typeof(i)<>'object' or exists(select 1 from jsonb_object_keys(i) k where k not in ('title','description','category','venue_name','address','city','postal_code','start_date','start_time','end_date','end_time','starts_at','ends_at','capacity','source_url','source_name','notes')) then return false;end if;
 if not (i ?& array['title','description','category','venue_name','address','city','postal_code','start_date','start_time','end_date','end_time','starts_at','ends_at','capacity','source_url','source_name','notes']) then return false;end if;
 if exists(select 1 from jsonb_object_keys(i) k where k<>'capacity' and jsonb_typeof(i->k)<>'string') then return false;end if;
 if length(btrim(i->>'title')) not between 3 and 120 or length(btrim(i->>'description')) not between 20 and 5000 or length(btrim(i->>'venue_name')) not between 1 and 160
 or length(btrim(i->>'address')) not between 1 and 250 or length(btrim(i->>'city')) not between 1 and 120 or i->>'postal_code' !~ '^\d{5}(-\d{4})?$'
 or i->>'category' not in ('food_drink','music','fitness','art_culture','shopping','community','nightlife','other')
 or length(i->>'source_url')>2048 or length(i->>'source_name')>160 or length(i->>'notes')>1000 then return false;end if;
 if i->'capacity'<>'null'::jsonb then c:=(i->>'capacity')::numeric;if jsonb_typeof(i->'capacity')<>'number' or c<>trunc(c) or c not between 1 and 2147483647 then return false;end if;end if;
 s:=(i->>'starts_at')::timestamptz;e:=(i->>'ends_at')::timestamptz;
 if not isfinite(s) or not isfinite(e) or e<=s or (p_future and s<=clock_timestamp()) then return false;end if;
 if to_char(s at time zone 'America/Los_Angeles','YYYY-MM-DD HH24:MI')<>(i->>'start_date')||' '||(i->>'start_time')
 or to_char(e at time zone 'America/Los_Angeles','YYYY-MM-DD HH24:MI')<>(i->>'end_date')||' '||(i->>'end_time') then return false;end if;
 -- LA's fold has a second occurrence one hour away; no disambiguation is accepted.
 if to_char((s+interval '1 hour') at time zone 'America/Los_Angeles','YYYY-MM-DD HH24:MI')=to_char(s at time zone 'America/Los_Angeles','YYYY-MM-DD HH24:MI')
 or to_char((s-interval '1 hour') at time zone 'America/Los_Angeles','YYYY-MM-DD HH24:MI')=to_char(s at time zone 'America/Los_Angeles','YYYY-MM-DD HH24:MI')
 or to_char((e+interval '1 hour') at time zone 'America/Los_Angeles','YYYY-MM-DD HH24:MI')=to_char(e at time zone 'America/Los_Angeles','YYYY-MM-DD HH24:MI')
 or to_char((e-interval '1 hour') at time zone 'America/Los_Angeles','YYYY-MM-DD HH24:MI')=to_char(e at time zone 'America/Los_Angeles','YYYY-MM-DD HH24:MI') then return false;end if;
 return true;
exception when others then return false;end;$$;
create function private.import_location_valid(l jsonb,e jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(l)='object' and jsonb_typeof(e)='object' and e->>'policy'='1' and e->>'confidence' in ('exact','high') and e->>'accuracy' in ('rooftop','parcel','point')
 and l->>'region'='CA' and l->>'country_code'='US' and length(btrim(l->>'mapbox_feature_id')) between 1 and 500 and length(btrim(l->>'address_line1')) between 1 and 500
 and length(btrim(l->>'city')) between 1 and 120 and l->>'postal_code' ~ '^\d{5}(-\d{4})?$'
 and jsonb_typeof(l->'latitude')='number' and jsonb_typeof(l->'longitude')='number' and (l->>'latitude')::numeric between 36.8 and 38.9 and (l->>'longitude')::numeric between -123.6 and -121.0,false);
$$;
create function private.import_refresh(p_batch uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update private.event_import_batches b set state=case
 when exists(select 1 from private.event_import_rows where batch_id=b.id and state not in ('imported','skipped')) then
  case when exists(select 1 from private.event_import_rows where batch_id=b.id and requested_at is not null and state='ready') then 'importing'
  when exists(select 1 from private.event_import_rows where batch_id=b.id and state in ('pending','geocoding')) then 'validating' else 'ready' end
 when exists(select 1 from private.event_import_rows where batch_id=b.id and state='skipped') then 'completed_with_skips' else 'completed' end,
 validated_at=case when not exists(select 1 from private.event_import_rows where batch_id=b.id and state in ('pending','geocoding')) then coalesce(validated_at,clock_timestamp()) else validated_at end,
 imported_at=case when not exists(select 1 from private.event_import_rows where batch_id=b.id and state not in ('imported','skipped')) then coalesce(imported_at,clock_timestamp()) else imported_at end
 where b.id=p_batch and b.state not in ('failed','cancelled');
end;$$;
create function private.import_candidates(p_row uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.event_import_rows;v jsonb;key text;address_key text;start_at timestamptz;
begin
 select * into strict r from private.event_import_rows where id=p_row;
 key:=private.import_normalize(r.input->>'title');start_at:=(r.input->>'starts_at')::timestamptz;
 address_key:=private.import_address(r.location->>'address_line1',r.location->>'address_line2',r.location->>'city',r.location->>'postal_code',r.location->>'region',r.location->>'country_code');
 select coalesce(jsonb_agg(candidate order by candidate->>'kind',candidate->>'id'),'[]') into v from (
 select jsonb_build_object('kind','event','id',e.id,'title',e.title,'startsAt',e.starts_at,'status',e.status,'revision',e.content_revision,'updatedAt',e.updated_at,'moderationStatus',e.moderation_status,'location',jsonb_build_array(e.mapbox_feature_id,e.address_line1,e.address_line2,e.city,e.postal_code,e.region,e.country_code)) candidate from public.events e
 where private.import_normalize(e.title)=key and e.starts_at between start_at-interval '30 minutes' and start_at+interval '30 minutes'
 and (e.mapbox_feature_id=r.location->>'mapbox_feature_id' or private.import_address(e.address_line1,e.address_line2,e.city,e.postal_code,e.region,e.country_code)=address_key)

 union all
 select jsonb_build_object('kind','row','id',x.id,'title',x.input->>'title','startsAt',x.input->>'starts_at','recordNumber',x.record_number) from private.event_import_rows x
 where x.batch_id=r.batch_id and x.record_number<r.record_number and x.state not in ('skipped','invalid') and x.resulting_event_id is null and x.location is not null
 and private.import_normalize(x.input->>'title')=key and (x.input->>'starts_at')::timestamptz between start_at-interval '30 minutes' and start_at+interval '30 minutes'
 and (x.location->>'mapbox_feature_id'=r.location->>'mapbox_feature_id' or private.import_address(x.location->>'address_line1',x.location->>'address_line2',x.location->>'city',x.location->>'postal_code',x.location->>'region',x.location->>'country_code')=address_key)
 ) q;return v;
end;$$;
create function private.import_check_duplicates(p_row uuid) returns void language plpgsql security definer set search_path='' as $$
declare candidates jsonb;digest text;
begin
 candidates:=private.import_candidates(p_row);digest:=encode(extensions.digest(candidates::text,'sha256'),'hex');
 update private.event_import_rows r set duplicate_candidates=(select coalesce(jsonb_agg(value),'[]') from (select value from jsonb_array_elements(candidates) limit 20) t),duplicate_count=jsonb_array_length(candidates),duplicate_digest=digest,
 state=case when jsonb_array_length(candidates)>0 and override_digest is distinct from digest then 'duplicate_possible' else 'ready' end,updated_at=clock_timestamp()
 where id=p_row and state not in ('imported','skipped','invalid','needs_review');
end;$$;

create function public.server_create_event_import_batch(p_actor uuid,p_request uuid,p_digest text,p_filename text,p_rows jsonb,p_error text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare s private.event_import_settings;b private.event_import_batches;x jsonb;count_rows integer;
begin
 perform private.import_actor(p_actor);
 perform pg_advisory_xact_lock(hashtextextended('import-upload:'||p_actor::text||':'||p_request::text,0));
 select * into b from private.event_import_batches where actor_id=p_actor and request_id=p_request;
 if found then if b.file_digest<>p_digest or b.filename<>p_filename then raise exception 'IMPORT_REQUEST_CONFLICT';end if;return b.id;end if;
 s:=private.import_destination();
 if p_request is null or p_digest !~ '^[a-f0-9]{64}$' or p_filename !~* '\.csv$' or length(p_filename)>255 or p_filename ~ '[[:cntrl:]]'
 or jsonb_typeof(p_rows) is distinct from 'array' or octet_length(p_rows::text)>8388608 then raise exception 'IMPORT_INVALID_UPLOAD';end if;
 count_rows:=jsonb_array_length(p_rows);
 if count_rows>500 or (p_error is null and count_rows<1) or (p_error is not null and count_rows<>0) then raise exception 'IMPORT_INVALID_UPLOAD';end if;
 insert into private.event_import_batches(actor_id,destination_organizer_id,config_revision,request_id,file_digest,filename,row_count,state,error_code)
 values(p_actor,s.destination_organizer_id,s.revision,p_request,p_digest,p_filename,count_rows,case when p_error is null then 'validating' else 'failed' end,left(p_error,80)) returning * into b;
 for x in select value from jsonb_array_elements(p_rows) loop
  if not (x ?& array['recordNumber','startLine','input','errors']) or jsonb_typeof(x->'errors') is distinct from 'array' then raise exception 'IMPORT_INVALID_ROW';end if;
  insert into private.event_import_rows(batch_id,record_number,start_line,input,errors,state)
  values(b.id,(x->>'recordNumber')::integer,(x->>'startLine')::integer,x->'input',x->'errors',case when jsonb_array_length(x->'errors')>0 or not private.import_input_valid(x->'input') then 'invalid' else 'pending' end);
 end loop;
 perform private.import_refresh(b.id);return b.id;
end;$$;
create function public.server_claim_event_import_work(p_actor uuid,p_batch uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare b private.event_import_batches;s private.event_import_settings;r private.event_import_rows;token uuid:=gen_random_uuid();at_time timestamptz:=clock_timestamp();
begin
 perform private.import_actor(p_actor);
 -- All claimers take the global budget lock before any batch or row locks.
 select * into s from private.event_import_settings where singleton for update;
 b:=private.import_lock(p_actor,p_batch);
 if s.provider_paused then return jsonb_build_object('kind','paused','code','PROVIDER_PAUSED');end if;
 if s.budget_day is distinct from (at_time at time zone 'UTC')::date then update private.event_import_settings set budget_day=(at_time at time zone 'UTC')::date,budget_used=0 where singleton; s.budget_used:=0;end if;
 if s.budget_used>=s.budget_limit then return jsonb_build_object('kind','paused','code','PROVIDER_BUDGET');end if;
 if (select count(*) from private.event_import_rows where lease_until>at_time)>=2 then return jsonb_build_object('kind','busy');end if;
 select * into r from private.event_import_rows where batch_id=p_batch and state in ('pending','geocoding') and next_attempt_at<=at_time and (lease_until is null or lease_until<=at_time) order by record_number limit 1 for update;
 if not found then return jsonb_build_object('kind','idle');end if;
 if r.attempts>=5 then update private.event_import_rows set state='failed',failure_code='PROVIDER_RETRIES_EXHAUSTED',lease_token=null,lease_until=null where id=r.id;perform private.import_refresh(p_batch);return jsonb_build_object('kind','idle');end if;
 update private.event_import_settings set budget_used=budget_used+1 where singleton;
 update private.event_import_rows set state='geocoding',attempts=attempts+1,lease_token=token,lease_until=at_time+interval '60 seconds' where id=r.id;
 return jsonb_build_object('kind','claimed','rowId',r.id,'token',token,'revision',r.revision,'input',r.input);
end;$$;
create function public.server_complete_event_import_geocode(p_actor uuid,p_batch uuid,p_row uuid,p_token uuid,p_revision bigint,p_result jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare r private.event_import_rows;delay integer;
begin
 perform private.import_actor(p_actor);
 perform 1 from private.event_import_settings where singleton for update;
 perform private.import_lock(p_actor,p_batch);
 select * into r from private.event_import_rows where id=p_row and batch_id=p_batch for update;
 if not found or r.lease_token is distinct from p_token or r.lease_until<=clock_timestamp() or r.revision<>p_revision or r.state<>'geocoding' then return false;end if;
 if p_result->>'kind'='verified' then
  if not private.import_location_valid(p_result->'location',p_result->'evidence') or left(p_result#>>'{location,postal_code}',5)<>left(r.input->>'postal_code',5) then raise exception 'IMPORT_GEOCODE_INVALID';end if;
  update private.event_import_rows set location=p_result->'location',evidence=p_result->'evidence',verified_at=clock_timestamp(),state='ready',failure_code=null where id=p_row;
  perform private.import_check_duplicates(p_row);
 elsif p_result->>'kind'='configuration_error' then
  update private.event_import_settings set provider_paused=true where singleton;
  update private.event_import_rows set state='pending',failure_code='PROVIDER_PAUSED' where id=p_row;
 elsif p_result->>'kind'='retryable' then
  delay:=greatest((array[2,10,30,120,120])[least(r.attempts,5)],least(3600,greatest(0,coalesce((p_result->>'retryAfterSeconds')::integer,0))));
  update private.event_import_rows set state=case when attempts>=5 then 'failed' else 'pending' end,next_attempt_at=clock_timestamp()+make_interval(secs=>delay),failure_code=left(p_result->>'code',80) where id=p_row;
 elsif p_result->>'kind' in ('invalid','needs_review') then
  update private.event_import_rows set state=p_result->>'kind',failure_code=left(p_result->>'code',80) where id=p_row;
 else raise exception 'IMPORT_GEOCODE_INVALID';end if;
 update private.event_import_rows set lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=p_row;
 perform private.import_refresh(p_batch);return true;
end;$$;
create function public.server_resolve_event_import_row(p_actor uuid,p_batch uuid,p_row uuid,p_action text,p_digest text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare r private.event_import_rows;
begin
 perform private.import_lock(p_actor,p_batch);
 select * into r from private.event_import_rows where id=p_row and batch_id=p_batch for update;
 if not found then raise exception 'IMPORT_ROW_NOT_FOUND';end if;
 if r.state in ('imported','skipped') then return true;end if;
 if p_action='skip' then update private.event_import_rows set state='skipped',decision_actor=p_actor,decision_at=clock_timestamp(),lease_token=null,lease_until=null,requested_at=null,requested_by=null where id=p_row;
 elsif p_action='retry' and r.state='failed' then
  update private.event_import_rows set state=case when location is null then 'pending' else 'ready' end,attempts=0,next_attempt_at=clock_timestamp(),failure_code=null where id=p_row;
 elsif p_action='override_duplicate' and r.location is not null and r.state in ('ready','duplicate_possible') then
  perform private.import_check_duplicates(p_row);
  select * into r from private.event_import_rows where id=p_row;
  if p_digest is null or p_digest<>r.duplicate_digest then perform private.import_refresh(p_batch);return false;end if;
  update private.event_import_rows set override_digest=p_digest,state='ready',decision_actor=p_actor,decision_at=clock_timestamp() where id=p_row;
 else raise exception 'IMPORT_INVALID_ACTION';end if;
 perform private.import_refresh(p_batch);return true;
end;$$;
create function public.server_request_event_import_rows(p_actor uuid,p_batch uuid,p_rows jsonb) returns void language plpgsql security definer set search_path='' as $$
declare x jsonb;r private.event_import_rows;
begin
 perform private.import_lock(p_actor,p_batch,false);
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 50 then raise exception 'IMPORT_INVALID_SELECTION';end if;
 for x in select value from jsonb_array_elements(p_rows) loop
  if (select array_agg(k order by k) from jsonb_object_keys(x) k) is distinct from array['expectedDuplicateDigest','expectedRevision','rowId']::text[] then raise exception 'IMPORT_INVALID_SELECTION';end if;
  select * into r from private.event_import_rows where id=(x->>'rowId')::uuid and batch_id=p_batch for update;
  if not found then raise exception 'IMPORT_ROW_NOT_FOUND';end if;
  if r.state='imported' then continue;end if;
  perform private.import_lock(p_actor,p_batch);
  if r.state<>'ready' or r.revision<>(x->>'expectedRevision')::bigint or r.duplicate_digest is distinct from x->>'expectedDuplicateDigest' then raise exception 'IMPORT_REVIEW_CHANGED';end if;
  update private.event_import_rows set requested_by=p_actor,requested_at=coalesce(requested_at,clock_timestamp()) where id=r.id;
 end loop;perform private.import_refresh(p_batch);
end;$$;
create function public.server_import_event_row(p_actor uuid,p_batch uuid,p_row uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare b private.event_import_batches;r private.event_import_rows;eid uuid;i jsonb;l jsonb;
begin
 b:=private.import_lock(p_actor,p_batch,false);
 select * into r from private.event_import_rows where id=p_row and batch_id=p_batch for update;
 if not found then raise exception 'IMPORT_ROW_NOT_FOUND';end if;
 if r.state='imported' then return jsonb_build_object('kind','imported','rowId',r.id,'eventId',r.resulting_event_id);end if;
 perform private.import_lock(p_actor,p_batch);
 -- Selection is authorization by a real admin, not a browser-local checkbox.
 if r.requested_by is null or r.state not in ('ready','duplicate_possible') then raise exception 'IMPORT_ROW_NOT_SELECTED';end if;
 -- The currently executing admin must authorize the continuation; no dependence on a logged-out uploader.
 perform pg_advisory_xact_lock(hashtextextended('import-title:'||private.import_normalize(r.input->>'title'),0));
 if not private.import_input_valid(r.input) then
  update private.event_import_rows set state='invalid',failure_code='EVENT_TIME_OR_FIELDS_INVALID',requested_at=null,requested_by=null where id=r.id;
  perform private.import_refresh(p_batch);return jsonb_build_object('kind','needs_review','rowId',r.id,'code','EVENT_TIME_OR_FIELDS_INVALID');
 end if;
 if not private.import_location_valid(r.location,r.evidence) then raise exception 'IMPORT_GEOCODE_REQUIRED';end if;
 perform private.import_check_duplicates(r.id);
 select * into r from private.event_import_rows where id=p_row;
 if r.state<>'ready' then
  update private.event_import_rows set requested_at=null,requested_by=null where id=r.id;
  perform private.import_refresh(p_batch);return jsonb_build_object('kind','needs_review','rowId',r.id,'code','IMPORT_REVIEW_CHANGED');
 end if;
 i:=r.input;l:=r.location;
 -- Inner block rolls back event and receipt together, while retaining a retryable row error.
 begin
  insert into public.events(organizer_id,title,description,category,starts_at,ends_at,timezone,venue_name,address_line1,address_line2,city,region,postal_code,country_code,mapbox_feature_id,latitude,longitude,admission_type,capacity)
  values(b.destination_organizer_id,i->>'title',i->>'description',i->>'category',(i->>'starts_at')::timestamptz,(i->>'ends_at')::timestamptz,'America/Los_Angeles',i->>'venue_name',l->>'address_line1',l->>'address_line2',l->>'city','CA',l->>'postal_code','US',l->>'mapbox_feature_id',(l->>'latitude')::double precision,(l->>'longitude')::double precision,'free',(i->>'capacity')::integer) returning id into eid;
  -- Flush deferred canonical invariants before recording a successful result.
  set constraints all immediate;
  update private.event_import_rows set state='imported',resulting_event_id=eid,imported_by=p_actor,imported_at=clock_timestamp(),failure_code=null where id=r.id;
 exception when others then
  update private.event_import_rows set state='failed',failure_code='EVENT_CREATION_FAILED' where id=r.id;
  perform private.import_refresh(p_batch);return jsonb_build_object('kind','failed','rowId',r.id,'code','EVENT_CREATION_FAILED','retryable',true);
 end;
 perform private.import_refresh(p_batch);return jsonb_build_object('kind','imported','rowId',r.id,'eventId',eid);
end;$$;
create function public.server_cancel_event_import_batch(p_actor uuid,p_batch uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.import_lock(p_actor,p_batch,false);
 update private.event_import_batches set state='cancelled',cancelled_at=coalesce(cancelled_at,clock_timestamp()) where id=p_batch;
 update private.event_import_rows set state='skipped',lease_token=null,lease_until=null,requested_at=null,requested_by=null,decision_actor=p_actor,decision_at=clock_timestamp(),failure_code='BATCH_CANCELLED' where batch_id=p_batch and state not in ('imported','skipped');
end;$$;
create function public.get_event_import_batch(p_batch uuid,p_offset integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare b private.event_import_batches;v jsonb;
begin
 perform private.import_actor(auth.uid());
 if p_offset<0 or p_offset>500 then raise exception 'IMPORT_INVALID_PAGE';end if;
 select * into b from private.event_import_batches where id=p_batch;if not found then raise exception 'IMPORT_BATCH_NOT_FOUND';end if;
 select jsonb_build_object('batch',to_jsonb(b),'isOwner',auth.uid()=b.destination_organizer_id,
 'counts',(select coalesce(jsonb_object_agg(state,n),'{}') from (select state,count(*) n from private.event_import_rows where batch_id=p_batch group by state) c),
 'rows',(select coalesce(jsonb_agg(to_jsonb(q)-'lease_token' order by record_number),'[]') from (select * from private.event_import_rows where batch_id=p_batch order by record_number limit 50 offset p_offset) q)) into v;
 return v;
end;$$;
create function public.list_event_import_batches() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.import_actor(auth.uid());
 return (select coalesce(jsonb_agg(to_jsonb(b) order by created_at desc,id),'[]') from (select * from private.event_import_batches order by created_at desc,id limit 50) b);
end;$$;
create function public.get_event_import_draft(p_event uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.import_actor(auth.uid());
 if not exists(select 1 from private.event_import_rows where resulting_event_id=p_event) then raise exception 'IMPORT_EVENT_NOT_FOUND';end if;
 return (select jsonb_build_object('event',to_jsonb(e),'isOwner',auth.uid()=e.organizer_id,'changedSinceImport',e.updated_at>r.imported_at) from public.events e join private.event_import_rows r on r.resulting_event_id=e.id where e.id=p_event);
end;$$;
create function public.server_get_event_import_progress(p_actor uuid,p_batch uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.import_actor(p_actor);
 if not exists(select 1 from private.event_import_batches where id=p_batch) then raise exception 'IMPORT_BATCH_NOT_FOUND';end if;
 return jsonb_build_object('selected',(select coalesce(jsonb_agg(id order by record_number),'[]') from (select id,record_number from private.event_import_rows where batch_id=p_batch and requested_at is not null and state='ready' order by record_number limit 10) q));
end;$$;
create function public.server_prune_event_imports() returns integer language plpgsql security definer set search_path='' as $$
declare b private.event_import_batches;n integer:=0;
begin
 for b in select * from private.event_import_batches where created_at<clock_timestamp()-interval '90 days' and pruned_at is null order by created_at limit 10 for update skip locked loop
  if b.state not in ('completed','completed_with_skips','cancelled','failed') then
   update private.event_import_batches set state='cancelled',cancelled_at=clock_timestamp() where id=b.id;
  end if;
  delete from private.event_import_rows where batch_id=b.id and resulting_event_id is null;
  update private.event_import_batches set pruned_at=clock_timestamp() where id=b.id;n:=n+1;
 end loop;return n;
end;$$;
create function private.import_guard_row() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.batch_id,new.record_number,new.start_line,new.input,new.revision) is distinct from (old.batch_id,old.record_number,old.start_line,old.input,old.revision)
 or (old.state in ('imported','skipped') and new is distinct from old) then raise exception 'IMPORT_ROW_IMMUTABLE';end if;return new;
end;$$;
create trigger event_import_row_immutable before update on private.event_import_rows for each row execute function private.import_guard_row();
create function private.import_guard_batch() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.actor_id,new.destination_organizer_id,new.config_revision,new.request_id,new.file_digest,new.filename,new.row_count) is distinct from (old.actor_id,old.destination_organizer_id,old.config_revision,old.request_id,old.file_digest,old.filename,old.row_count) then raise exception 'IMPORT_BATCH_IMMUTABLE';end if;return new;
end;$$;
create trigger event_import_batch_immutable before update on private.event_import_batches for each row execute function private.import_guard_batch();
-- Only the feature's functions are granted; no default PUBLIC execute survives.
do $$declare r record;begin
 for r in select p.oid::regprocedure signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='private' and p.proname like 'import_%') or (n.nspname='public' and (p.proname like 'server_%event_import%' or p.proname='server_import_event_row' or p.proname in ('get_event_import_batch','list_event_import_batches','get_event_import_draft'))) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);
 if r.nspname='public' then execute format('grant execute on function %s to %I',r.signature,case when r.proname like 'server_%' then 'service_role' else 'authenticated' end);end if;
 end loop;
end;$$;
-- Pure index expressions contain no private data; ordinary owner inserts remain valid.
grant execute on function private.import_normalize(text),private.import_address(text,text,text,text,text,text) to authenticated,service_role;
create function public.server_authorize_event_import(p_actor uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin perform private.import_actor(p_actor);return true;end;$$;
revoke all on function public.server_authorize_event_import(uuid) from public,anon,authenticated,service_role;
grant execute on function public.server_authorize_event_import(uuid) to service_role;
