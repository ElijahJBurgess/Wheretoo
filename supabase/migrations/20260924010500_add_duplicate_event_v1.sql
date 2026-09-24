-- Configuration-only duplication. No lifecycle/history/payment source is cloned.
create function private.assert_duplicate_source(p_source uuid,p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
declare s text; m text; z text; a text; has_image boolean;
begin
 select e.status,e.moderation_status,e.timezone,e.artwork_path,
 exists(select 1 from private.event_images i where i.event_id=e.id and i.position=1)
 into s,m,z,a,has_image from public.events e where e.id=p_source and e.organizer_id=p_actor;
 if p_actor is null or not found then raise exception 'EVENT_NOT_FOUND'; end if;
 if m in ('blocked','removed') then raise exception 'DUPLICATE_MODERATION_BLOCKED'; end if;
 if s not in ('draft','published','cancelled') or z<>'America/Los_Angeles' or (a is not null and not has_image) then
   raise exception 'DUPLICATE_SOURCE_UNSUPPORTED';
 end if;
end; $$;

create function private.event_duplicate_configuration(p_source uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'event',jsonb_build_object('id',e.id,'organizer_id',e.organizer_id,'title',e.title,'description',e.description,'category',e.category,
 'venue_name',e.venue_name,'address_line1',e.address_line1,'address_line2',e.address_line2,'city',e.city,'region',e.region,
 'postal_code',e.postal_code,'country_code',e.country_code,'mapbox_feature_id',e.mapbox_feature_id,'latitude',e.latitude,'longitude',e.longitude,
 'timezone',e.timezone,'admission_type',e.admission_type,'capacity',e.capacity,'starts_at',e.starts_at,'ends_at',e.ends_at,
 'status',e.status,'moderation_status',e.moderation_status,'moderation_version',e.moderation_version,'content_revision',e.content_revision,'artwork_path',e.artwork_path),
 'tiers',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'description',t.description,'unit_amount_minor',t.unit_amount_minor,
 'currency',t.currency,'quantity_total',t.quantity_total,'sort_order',t.sort_order,'status',t.status) order by t.sort_order)
 from public.ticket_tiers t where t.event_id=e.id and e.admission_type='paid' and t.status in ('draft','active')),'[]'::jsonb),
 'requirements',(select jsonb_build_object('minimum_age',d.minimum_age,'alcohol_present',d.alcohol_present,'cannabis_present',d.cannabis_present,
 'explicit_adult_content',d.explicit_adult_content,'gambling_present',d.gambling_present,'weapons_present',d.weapons_present,'high_risk_activity',d.high_risk_activity)
 from private.event_risk_disclosures d where d.event_id=e.id),
 'image',(select jsonb_build_object('id',i.id,'path',i.object_path) from private.event_images i where i.event_id=e.id and i.position=1),
 'cover_revision',coalesce((select revision from private.event_cover_state where event_id=e.id),0))
 from public.events e where e.id=p_source;
$$;
create function private.event_duplicate_fingerprint(p_config jsonb) returns text
language sql immutable set search_path='' as $$ select encode(extensions.digest(p_config::text,'sha256'),'hex'); $$;
create function private.event_duplicate_title(p_title text) returns text
language plpgsql immutable set search_path='' as $$
declare base text:=regexp_replace(coalesce(p_title,''),'^[[:space:]]+|[[:space:]]+$','','g'); result text:=''; c text; units integer:=0; n integer;
begin
 if base='' then base:='Untitled event'; end if;
 for n in 1..char_length(base) loop
   c:=substr(base,n,1); units:=units+case when ascii(c)>65535 then 2 else 1 end;
   exit when units>113;
   result:=result||c;
 end loop;
 return regexp_replace(result,'[[:space:]]+$','')||' — Copy';
end; $$;

create function public.get_owned_event_duplicate_context(p_source_event_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare config jsonb;
begin
 perform private.assert_duplicate_source(p_source_event_id,auth.uid());
 perform private.lock_event_change_rows(p_source_event_id);
 perform private.assert_duplicate_source(p_source_event_id,auth.uid());
 config:=private.event_duplicate_configuration(p_source_event_id);
 return jsonb_build_object('fingerprint',private.event_duplicate_fingerprint(config),'image',config->'image');
end; $$;

-- Keep ordinary uploads on their existing path. Only a service-created duplicate
-- stage may refer to a not-yet-created event; no attachment is created here.
create or replace function private.attach_uploaded_event_image() returns trigger
language plpgsql security definer set search_path='' as $$
declare source_id uuid; target_id uuid; actor uuid; config jsonb;
begin
 if new.bucket_id<>'event-images' then return new; end if;
 if new.name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$' then raise exception 'INVALID_IMAGE_PATH'; end if;
 if new.user_metadata ? 'duplicate_source' then
   if auth.role() is distinct from 'service_role' then raise exception 'DUPLICATE_STAGE_INVALID'; end if;
   source_id:=(new.user_metadata->>'duplicate_source')::uuid;
   actor:=(new.user_metadata->>'organizer_id')::uuid;
   target_id:=split_part(new.name,'/',1)::uuid;
   perform private.assert_duplicate_source(source_id,actor);
   perform private.lock_event_change_rows(source_id);
   perform private.assert_duplicate_source(source_id,actor);
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('duplicate-target:'||target_id::text,0));
   if exists(select 1 from public.events where id=target_id) then raise exception 'DUPLICATE_TARGET_EXISTS'; end if;
   config:=private.event_duplicate_configuration(source_id);
   if new.user_metadata->>'duplicate_fingerprint' is distinct from private.event_duplicate_fingerprint(config) then raise exception 'DUPLICATE_SOURCE_CHANGED'; end if;
   if config->'image'='null'::jsonb or new.user_metadata->>'duplicate_image' is distinct from config#>>'{image,id}'
     or new.user_metadata->>'cover_revision' is distinct from '0'
     or coalesce(new.user_metadata->>'digest','') !~ '^[0-9a-f]{64}$'
     or (select array_agg(k order by k) from jsonb_object_keys(new.user_metadata) k) is distinct from
       array['cover_revision','cover_staged','digest','duplicate_fingerprint','duplicate_image','duplicate_source','organizer_id']::text[]
     then raise exception 'DUPLICATE_STAGE_INVALID'; end if;
 else
   perform private.lock_event_cover(split_part(new.name,'/',1)::uuid,(new.user_metadata->>'organizer_id')::uuid);
 end if;
 if new.user_metadata->>'cover_staged' is distinct from 'true' then raise exception 'COVER_REVISION_REQUIRED'; end if;
 -- Storage's rollback-only permission probe precedes actual byte metadata.
 if new.version='1' then return new; end if;
 if new.metadata->>'mimetype' not in ('image/jpeg','image/png','image/webp') or new.metadata->>'mimetype' is null
   or coalesce((new.metadata->>'size')::bigint,0) not between 1 and 5242880
   or (new.metadata->>'mimetype'='image/jpeg' and new.name !~ '\.(jpg|jpeg)$')
   or (new.metadata->>'mimetype'='image/png' and new.name !~ '\.png$')
   or (new.metadata->>'mimetype'='image/webp' and new.name !~ '\.webp$') then raise exception 'INVALID_IMAGE_FILE'; end if;
 return new;
end; $$;

-- Only atomic duplication can first attach these objects. Existing normal cover
-- replay may acknowledge an already attached object, never adopt a staged orphan.
alter function public.server_commit_event_cover(uuid,uuid,bigint,text,uuid,smallint) rename to server_commit_event_cover_without_duplicate_guard;
revoke all on function public.server_commit_event_cover_without_duplicate_guard(uuid,uuid,bigint,text,uuid,smallint) from public,anon,authenticated,service_role;
create function public.server_commit_event_cover(p_event_id uuid,p_organizer_id uuid,p_expected_revision bigint,p_path text,p_generation_id uuid default null,p_slot smallint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from storage.objects where bucket_id='event-images' and name=p_path and user_metadata ? 'duplicate_source')
   and not exists(select 1 from private.event_images where event_id=p_event_id and object_path=p_path and position=1)
   then raise exception 'DUPLICATE_STAGE_INVALID'; end if;
 return public.server_commit_event_cover_without_duplicate_guard(p_event_id,p_organizer_id,p_expected_revision,p_path,p_generation_id,p_slot);
end; $$;
revoke all on function public.server_commit_event_cover(uuid,uuid,bigint,text,uuid,smallint) from public,anon,authenticated,service_role;
grant execute on function public.server_commit_event_cover(uuid,uuid,bigint,text,uuid,smallint) to service_role;

create function public.duplicate_owned_event(p_source_event_id uuid,p_new_event_id uuid,p_expected_fingerprint text,p_staged_path text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); config jsonb; object_id uuid; object_meta jsonb; file_meta jsonb; object_created timestamptz;
begin
 perform private.assert_duplicate_source(p_source_event_id,actor);
 if p_new_event_id is null or p_new_event_id=p_source_event_id then raise exception 'DUPLICATE_TARGET_EXISTS'; end if;
 perform private.lock_event_change_rows(p_source_event_id);
 perform private.assert_duplicate_source(p_source_event_id,actor);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('duplicate-target:'||p_new_event_id::text,0));
 if exists(select 1 from public.events where id=p_new_event_id) then raise exception 'DUPLICATE_TARGET_EXISTS'; end if;
 config:=private.event_duplicate_configuration(p_source_event_id);
 if p_expected_fingerprint is distinct from private.event_duplicate_fingerprint(config) then raise exception 'DUPLICATE_SOURCE_CHANGED'; end if;
 if config->'image'<>'null'::jsonb then
   select id,user_metadata,metadata,created_at into object_id,object_meta,file_meta,object_created
   from storage.objects where bucket_id='event-images' and name=p_staged_path for update;
   if not found or split_part(p_staged_path,'/',1)<>p_new_event_id::text
      or object_meta->>'organizer_id' is distinct from actor::text
      or object_meta->>'duplicate_source' is distinct from p_source_event_id::text
      or object_meta->>'duplicate_image' is distinct from config#>>'{image,id}'
      or object_meta->>'duplicate_fingerprint' is distinct from p_expected_fingerprint
      or object_meta->>'cover_staged' is distinct from 'true'
      or object_meta->>'cover_revision' is distinct from '0'
      or coalesce(object_meta->>'digest','') !~ '^[0-9a-f]{64}$'
      or object_created < clock_timestamp()-interval '15 minutes'
      or file_meta->>'mimetype' not in ('image/jpeg','image/png','image/webp')
      or file_meta->>'mimetype' is null
      or coalesce((file_meta->>'size')::bigint,0) not between 1 and 5242880
      or exists(select 1 from private.event_images where id=object_id or object_path=p_staged_path)
      then raise exception 'DUPLICATE_STAGE_INVALID'; end if;
 elsif p_staged_path is not null then raise exception 'DUPLICATE_STAGE_INVALID'; end if;
 insert into public.events(id,organizer_id,title,description,category,venue_name,address_line1,address_line2,city,region,postal_code,country_code,
 mapbox_feature_id,latitude,longitude,timezone,admission_type,capacity,starts_at,ends_at)
 select p_new_event_id,actor,private.event_duplicate_title(e.title),e.description,e.category,e.venue_name,e.address_line1,e.address_line2,e.city,e.region,e.postal_code,e.country_code,
 e.mapbox_feature_id,e.latitude,e.longitude,e.timezone,e.admission_type,e.capacity,null,null from public.events e where e.id=p_source_event_id;
 insert into public.ticket_tiers(event_id,name,description,unit_amount_minor,currency,quantity_total,sort_order)
 select p_new_event_id,t.name,t.description,t.unit_amount_minor,t.currency,t.quantity_total,t.sort_order
 from public.ticket_tiers t where t.event_id=p_source_event_id and t.status in ('draft','active') and config#>>'{event,admission_type}'='paid';
 insert into private.event_risk_disclosures(event_id,minimum_age,alcohol_present,cannabis_present,explicit_adult_content,gambling_present,weapons_present,high_risk_activity)
 select p_new_event_id,d.minimum_age,d.alcohol_present,d.cannabis_present,d.explicit_adult_content,d.gambling_present,d.weapons_present,d.high_risk_activity
 from private.event_risk_disclosures d where d.event_id=p_source_event_id;
 if object_id is not null then
   insert into private.event_cover_state(event_id,revision) values(p_new_event_id,1);
   insert into private.event_images(id,event_id,object_path,position) values(object_id,p_new_event_id,p_staged_path,1);
 end if;
 return p_new_event_id;
end; $$;
revoke all on function private.assert_duplicate_source(uuid,uuid),private.event_duplicate_configuration(uuid),private.event_duplicate_fingerprint(jsonb),private.event_duplicate_title(text),
 public.get_owned_event_duplicate_context(uuid),public.duplicate_owned_event(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_owned_event_duplicate_context(uuid),public.duplicate_owned_event(uuid,uuid,text,text) to authenticated;
