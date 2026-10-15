-- Additive foundation only: no assignment write path, public event projection,
-- moderation digest, or existing transaction function is changed here.
begin;

create function private.map_icon_keys(j jsonb, keys text[]) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(j) = 'object' and j ?& keys and j - keys = '{}'::jsonb, false)
$$;
create function private.map_icon_number(j jsonb, lo numeric, hi numeric) returns boolean
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(j) = 'number' then (j::text)::numeric between lo and hi else false end
$$;

create function private.valid_map_icon_metadata(m jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare p jsonb; s jsonb; last_zoom numeric; w numeric; h numeric; r numeric; scale numeric;
begin
  if not private.map_icon_keys(m, array['schemaVersion','widthPx','heightPx','pixelRatio','contactPx','anchor','selectedScale','desktop','mobile','hit','alignment','collisionMode','sdf'])
    or m->'schemaVersion' <> '1'::jsonb or m->'anchor' <> '"bottom"'::jsonb
    or m->'collisionMode' <> '"always-visible"'::jsonb or m->'sdf' <> 'false'::jsonb
    or m->'alignment' <> '{"pitch":"viewport","rotation":"viewport"}'::jsonb
    or not private.map_icon_number(m->'widthPx',1,1024) or not private.map_icon_number(m->'heightPx',1,1024)
    or not (m->'pixelRatio' = any(array['1','2','3']::jsonb[]))
    or not private.map_icon_number(m->'selectedScale',1,1.25) then return false; end if;
  w := (m->>'widthPx')::numeric; h := (m->>'heightPx')::numeric;
  r := (m->>'pixelRatio')::numeric; scale := (m->>'selectedScale')::numeric;
  if w <> trunc(w) or h <> trunc(h) or jsonb_typeof(m->'contactPx') <> 'array'
    or jsonb_array_length(m->'contactPx') <> 2
    or not private.map_icon_number(m#>'{contactPx,0}',0,w)
    or not private.map_icon_number(m#>'{contactPx,1}',0,h) then return false; end if;
  foreach p in array array[m->'desktop',m->'mobile'] loop
    if not private.map_icon_keys(p,array['minZoom','maxZoom','stops'])
      or not private.map_icon_number(p->'minZoom',0,24) or not private.map_icon_number(p->'maxZoom',0,24)
      or (p->>'minZoom')::numeric >= (p->>'maxZoom')::numeric
      or jsonb_typeof(p->'stops') <> 'array' or jsonb_array_length(p->'stops') not between 2 and 6 then return false; end if;
    last_zoom := -1;
    for s in select value from jsonb_array_elements(p->'stops') loop
      if jsonb_typeof(s) <> 'array' or jsonb_array_length(s) <> 2
        or not private.map_icon_number(s->0,(p->>'minZoom')::numeric,(p->>'maxZoom')::numeric)
        or not private.map_icon_number(s->1,0,4) or (s->>1)::numeric <= 0
        or (s->>0)::numeric <= last_zoom
        or greatest(w,h)/r*(s->>1)::numeric*scale > 96 then return false; end if;
      last_zoom := (s->>0)::numeric;
    end loop;
  end loop;
  p := m->'hit';
  return private.map_icon_keys(p,array['kind','radius','translation','minTargetDiameter'])
    and p->'kind' = '"legacy-css-circle"'::jsonb and p->'minTargetDiameter' = '44'::jsonb
    and private.map_icon_number(p->'radius',22,64)
    and jsonb_typeof(p->'translation') = 'array' and jsonb_array_length(p->'translation') = 2
    and private.map_icon_number(p#>'{translation,0}',-96,96)
    and private.map_icon_number(p#>'{translation,1}',-96,96);
exception when others then return false;
end $$;

create table private.map_icons (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  current_version_id uuid,
  selectable boolean not null default true,
  created_at timestamptz not null default now()
);
create table private.map_icon_versions (
  id uuid primary key default gen_random_uuid(),
  icon_id uuid not null references private.map_icons on delete restrict,
  version integer not null check (version > 0),
  request_id uuid not null unique,
  state text not null default 'validated' check (state in ('validated','approved','published','retired','revoked')),
  metadata jsonb not null check (private.valid_map_icon_metadata(metadata) is true),
  provenance jsonb not null,
  package_hash text not null check (package_hash ~ '^[a-f0-9]{64}$'),
  png_sha256 text not null check (png_sha256 ~ '^[a-f0-9]{64}$'),
  byte_size integer not null check (byte_size between 1 and 1048576),
  original_path text not null unique,
  crop_path text not null unique,
  runtime_path text not null unique,
  created_by uuid not null references auth.users on delete restrict,
  created_at timestamptz not null default now(),
  approved_by uuid references auth.users on delete restrict,
  approved_at timestamptz,
  published_at timestamptz,
  unique(icon_id, version), unique(icon_id,id),
  check (runtime_path = 'icons/' || icon_id || '/' || id || '/' || png_sha256 || '.png'),
  check (original_path = 'icons/' || icon_id || '/' || id || '/original.png'),
  check (crop_path = 'icons/' || icon_id || '/' || id || '/crop.png'),
  check ((state = 'validated' and approved_by is null and approved_at is null and published_at is null)
    or (state = 'approved' and approved_by is not null and approved_at is not null and published_at is null)
    or (state in ('published','retired','revoked') and approved_by is not null and approved_at is not null and published_at is not null))
);
alter table private.map_icons add constraint map_icons_current_version_fk
  foreign key(id,current_version_id) references private.map_icon_versions(icon_id,id) on delete restrict;
create table private.map_icon_audit (
  id bigint generated always as identity primary key,
  version_id uuid not null references private.map_icon_versions on delete restrict,
  actor_id uuid not null references auth.users on delete restrict,
  action text not null check (action in ('validated','approved','published','retired','revoked')),
  package_hash text not null,
  reason text not null check (length(reason) between 1 and 500),
  created_at timestamptz not null default now(),
  unique(version_id,action)
);
create table private.map_icon_settings (
  singleton boolean primary key default true check(singleton),
  catalog_revision bigint not null default 0,
  rendering_enabled boolean not null default false,
  selection_enabled boolean not null default false
);
insert into private.map_icon_settings(singleton) values(true);
alter table public.events add column map_icon_version_id uuid
  references private.map_icon_versions(id) on delete restrict;
create index events_map_icon_version_idx on public.events(map_icon_version_id) where map_icon_version_id is not null;

alter table private.map_icons enable row level security;
alter table private.map_icon_versions enable row level security;
alter table private.map_icon_audit enable row level security;
alter table private.map_icon_settings enable row level security;
revoke all on private.map_icons, private.map_icon_versions, private.map_icon_audit, private.map_icon_settings from public,anon,authenticated,service_role;

create function private.guard_map_icon_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'ICON_VERSION_IMMUTABLE'; end if;
  if (to_jsonb(new) - array['state','approved_by','approved_at','published_at']) is distinct from
     (to_jsonb(old) - array['state','approved_by','approved_at','published_at'])
    or (old.approved_at is not null and (new.approved_at,new.approved_by) is distinct from (old.approved_at,old.approved_by))
    or (old.published_at is not null and new.published_at is distinct from old.published_at)
    or not ((old.state,new.state) in (('validated','approved'),('approved','published'),('published','retired'),('published','revoked'),('retired','revoked')))
  then raise exception 'ICON_VERSION_IMMUTABLE'; end if;
  return new;
end $$;
create trigger map_icon_version_immutable before update or delete on private.map_icon_versions
  for each row execute function private.guard_map_icon_version();
create trigger map_icon_audit_immutable before update or delete on private.map_icon_audit
  for each row execute function private.reject_immutable_moderation_record_change();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
  ('map-icon-originals','map-icon-originals',false,10485760,array['image/png']),
  ('map-icon-published','map-icon-published',true,1048576,array['image/png']);
-- No browser write policies. Only the trusted curation importer uses the
-- server-side Storage credential; authenticated admins use narrow SQL RPCs.
-- Restrictive policies also prevent a future unrelated permissive policy from
-- accidentally granting icon object access (public /object/public reads bypass RLS).
create policy map_icon_objects_private_boundary on storage.objects as restrictive
  for all to anon,authenticated
  using (bucket_id not in ('map-icon-originals','map-icon-published'))
  with check (bucket_id not in ('map-icon-originals','map-icon-published'));

create function private.map_icon_descriptor(v private.map_icon_versions) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('versionId',v.id,'iconId',v.icon_id,'name',i.display_name,
    'packageHash',v.package_hash,'pngSha256',v.png_sha256,'runtimeObjectKey',v.runtime_path,
    'byteSize',v.byte_size,'metadata',v.metadata)
  from private.map_icons i where i.id=v.icon_id
$$;
create function public.get_public_map_icon_versions(p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_ids is null or cardinality(p_ids)>64 or array_position(p_ids,null) is not null then raise exception 'ICON_IDS_INVALID'; end if;
  return (select jsonb_build_object('catalogRevision',s.catalog_revision,'renderingEnabled',s.rendering_enabled,
    'versions',coalesce((select jsonb_agg(private.map_icon_descriptor(v) order by v.id)
      from private.map_icon_versions v where v.id=any(p_ids) and v.state in ('published','retired')), '[]'::jsonb))
    from private.map_icon_settings s where singleton);
end $$;
create function public.list_selectable_map_icons(p_after uuid default null,p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_limit is null or p_limit not between 1 and 50 then raise exception 'ICON_LIMIT_INVALID'; end if;
  return (select jsonb_build_object('catalogRevision',s.catalog_revision,'selectionEnabled',s.selection_enabled,
    'icons',coalesce((select jsonb_agg(x.descriptor order by x.id) from
      (select v.id,private.map_icon_descriptor(v) descriptor from private.map_icons i
       join private.map_icon_versions v on v.id=i.current_version_id
       where i.selectable and v.state='published' and (p_after is null or v.id>p_after)
       order by v.id limit p_limit) x),'[]'::jsonb)) from private.map_icon_settings s where singleton);
end $$;

-- Trusted operator attests decoded identity via the bounded local importer.
-- SQL validates metadata/provenance shape and binds approval to the full package.
create function public.prepare_map_icon_version(p_request_id uuid,p_slug text,p_name text,p_metadata jsonb,p_provenance jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i private.map_icons; v private.map_icon_versions; vid uuid := gen_random_uuid(); ph text; p jsonb := p_provenance; crop jsonb;
begin
  perform private.require_active_staff_role(true);
  if p_request_id is null or not coalesce(private.valid_map_icon_metadata(p_metadata),false)
    or not private.map_icon_keys(p,array['originalSha256','pngSha256','rgbaSha256','originalBytes','runtimeBytes','originalWidth','originalHeight','crop'])
    or jsonb_typeof(p->'originalSha256') <> 'string' or jsonb_typeof(p->'pngSha256') <> 'string' or jsonb_typeof(p->'rgbaSha256') <> 'string'
    or not coalesce(p->>'originalSha256' ~ '^[a-f0-9]{64}$' and p->>'pngSha256' ~ '^[a-f0-9]{64}$' and p->>'rgbaSha256' ~ '^[a-f0-9]{64}$',false)
    or not private.map_icon_number(p->'originalBytes',1,10485760) or not private.map_icon_number(p->'runtimeBytes',1,1048576)
    or not private.map_icon_number(p->'originalWidth',1,16000000) or not private.map_icon_number(p->'originalHeight',1,16000000)
    then raise exception 'ICON_PACKAGE_INVALID'; end if;
  crop := p->'crop';
  if not private.map_icon_keys(crop,array['x','y','width','height'])
    or not private.map_icon_number(crop->'x',0,16000000) or not private.map_icon_number(crop->'y',0,16000000)
    or crop->'width' <> p_metadata->'widthPx' or crop->'height' <> p_metadata->'heightPx'
    or (crop->>'x')::numeric+(crop->>'width')::numeric>(p->>'originalWidth')::numeric
    or (crop->>'y')::numeric+(crop->>'height')::numeric>(p->>'originalHeight')::numeric
    or (p->>'originalWidth')::numeric*(p->>'originalHeight')::numeric>16000000
    or exists(select 1 from jsonb_each(p) e where e.key in ('originalBytes','runtimeBytes','originalWidth','originalHeight') and (e.value::text)::numeric <> trunc((e.value::text)::numeric))
    or (crop->>'x')::numeric <> trunc((crop->>'x')::numeric) or (crop->>'y')::numeric <> trunc((crop->>'y')::numeric)
    then raise exception 'ICON_PACKAGE_INVALID'; end if;
  ph := encode(extensions.digest(jsonb_build_object('metadata',p_metadata,'provenance',p,'slug',p_slug,'name',p_name)::text,'sha256'),'hex');
  -- Global curation lock is deliberately small-scope; never acquires event locks.
  perform 1 from private.map_icon_settings where singleton for update;
  select * into v from private.map_icon_versions where request_id=p_request_id;
  if found then
    if v.package_hash <> ph then raise exception 'ICON_REQUEST_CONFLICT'; end if;
    return jsonb_build_object('iconId',v.icon_id,'versionId',v.id,'state',v.state,'packageHash',v.package_hash,'originalPath',v.original_path,'cropPath',v.crop_path,'runtimePath',v.runtime_path);
  end if;
  insert into private.map_icons(slug,display_name) values(p_slug,p_name) on conflict(slug) do nothing;
  select * into strict i from private.map_icons where slug=p_slug;
  if i.display_name <> p_name then raise exception 'ICON_NAME_CONFLICT'; end if;
  insert into private.map_icon_versions(id,icon_id,version,request_id,metadata,provenance,package_hash,png_sha256,byte_size,original_path,crop_path,runtime_path,created_by)
    values(vid,i.id,(select coalesce(max(version),0)+1 from private.map_icon_versions where icon_id=i.id),p_request_id,p_metadata,p,ph,p->>'pngSha256',(p->>'runtimeBytes')::integer,
      'icons/'||i.id||'/'||vid||'/original.png','icons/'||i.id||'/'||vid||'/crop.png','icons/'||i.id||'/'||vid||'/'||(p->>'pngSha256')||'.png',auth.uid()) returning * into v;
  insert into private.map_icon_audit(version_id,actor_id,action,package_hash,reason) values(v.id,auth.uid(),'validated',ph,'Trusted curator verified exact PNG and crop pixels');
  return jsonb_build_object('iconId',v.icon_id,'versionId',v.id,'state',v.state,'packageHash',v.package_hash,'originalPath',v.original_path,'cropPath',v.crop_path,'runtimePath',v.runtime_path);
end $$;

create function public.transition_map_icon_version(p_version_id uuid,p_package_hash text,p_action text,p_reason text)
returns text language plpgsql security definer set search_path = '' as $$
declare v private.map_icon_versions;
begin
  perform private.require_active_staff_role(true);
  if p_reason is null or length(btrim(p_reason)) not between 1 and 500 or p_action is null or p_action not in ('approved','published','retired','revoked') then raise exception 'ICON_ACTION_INVALID'; end if;
  perform 1 from private.map_icon_settings where singleton for update;
  select * into strict v from private.map_icon_versions where id=p_version_id for update;
  if p_package_hash is distinct from v.package_hash then raise exception 'ICON_PACKAGE_CONFLICT'; end if;
  if v.state=p_action then return v.state; end if;
  if p_action='approved' then
    if v.state <> 'validated' then raise exception 'ICON_STATE_INVALID'; end if;
    if not exists(select 1 from storage.objects where bucket_id='map-icon-originals' and name=v.original_path and metadata->>'mimetype'='image/png' and (metadata->>'size')::bigint=(v.provenance->>'originalBytes')::bigint)
      or not exists(select 1 from storage.objects where bucket_id='map-icon-originals' and name=v.crop_path and metadata->>'mimetype'='image/png' and (metadata->>'size')::bigint=v.byte_size) then raise exception 'ICON_PRIVATE_ASSETS_MISSING'; end if;
    update private.map_icon_versions set state='approved',approved_by=auth.uid(),approved_at=now() where id=v.id;
  elsif p_action='published' then
    if v.state <> 'approved' then raise exception 'ICON_STATE_INVALID'; end if;
    if not exists(select 1 from storage.objects where bucket_id='map-icon-published' and name=v.runtime_path and metadata->>'mimetype'='image/png' and (metadata->>'size')::bigint=v.byte_size) then raise exception 'ICON_RUNTIME_ASSET_MISSING'; end if;
    update private.map_icon_versions set state='published',published_at=now() where id=v.id;
    update private.map_icons set current_version_id=v.id where id=v.icon_id;
  else
    if not ((v.state,p_action) in (('published','retired'),('published','revoked'),('retired','revoked'))) then raise exception 'ICON_STATE_INVALID'; end if;
    update private.map_icon_versions set state=p_action where id=v.id;
  end if;
  insert into private.map_icon_audit(version_id,actor_id,action,package_hash,reason) values(v.id,auth.uid(),p_action,v.package_hash,p_reason);
  update private.map_icon_settings set catalog_revision=catalog_revision+1 where singleton;
  return p_action;
end $$;

revoke all on function private.map_icon_keys(jsonb,text[]),private.map_icon_number(jsonb,numeric,numeric),private.valid_map_icon_metadata(jsonb),private.guard_map_icon_version(),private.map_icon_descriptor(private.map_icon_versions) from public,anon,authenticated,service_role;
revoke all on function public.get_public_map_icon_versions(uuid[]),public.list_selectable_map_icons(uuid,integer),public.prepare_map_icon_version(uuid,text,text,jsonb,jsonb),public.transition_map_icon_version(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_public_map_icon_versions(uuid[]) to anon,authenticated;
grant execute on function public.list_selectable_map_icons(uuid,integer),public.prepare_map_icon_version(uuid,text,text,jsonb,jsonb),public.transition_map_icon_version(uuid,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
