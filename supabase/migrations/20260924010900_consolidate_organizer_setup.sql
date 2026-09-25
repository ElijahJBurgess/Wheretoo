-- Keep mutable profile drafts separate from the explicit permanent handle claim.
create function public.save_owned_organizer_setup(p_profile jsonb, p_expected_updated_at timestamptz, p_logo_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.organizers; owner uuid := auth.uid(); saved_at timestamptz;
begin
 if owner is null then raise exception using errcode='42501',message='SIGN_IN_REQUIRED'; end if;
 if jsonb_typeof(p_profile) is distinct from 'object'
 or jsonb_typeof(p_profile->'displayName') is distinct from 'string'
 or char_length(btrim(p_profile->>'displayName')) not between 2 and 100
 or exists(select 1 from jsonb_each(p_profile) x where x.key <> all(array['displayName','organizerType','bio','websiteUrl','baseCity']) or jsonb_typeof(x.value) <> 'string')
 or char_length(coalesce(p_profile->>'organizerType','')) > 80
 or char_length(coalesce(p_profile->>'bio','')) > 500
 or char_length(coalesce(p_profile->>'baseCity','')) > 120
 or char_length(coalesce(p_profile->>'websiteUrl','')) > 500
 or (coalesce(p_profile->>'websiteUrl','') <> '' and p_profile->>'websiteUrl' !~ '^https?://[^[:space:]]+$')
 then raise exception using errcode='P0001',message='ORGANIZER_PROFILE_INVALID'; end if;
 if p_logo_id is not null and not exists(select 1 from private.organizer_media where id=p_logo_id and owner_id=owner) then
  raise exception using errcode='P0001',message='LOGO_NOT_OWNED'; end if;
 if p_expected_updated_at is null then
  insert into public.organizers(id,display_name) values(owner,btrim(p_profile->>'displayName')) on conflict(id) do nothing returning * into o;
  if not found then raise exception using errcode='P0001',message='ORGANIZER_SETTINGS_CONFLICT'; end if;
 else
  -- Reuse the established operation/tier/event/organizer lock order and name
  -- revision invalidation. Do not acquire an organizer lock before this call.
  perform public.save_owned_organizer_settings(p_profile->>'displayName',nullif(p_profile->>'bio',''),p_expected_updated_at);
  select * into o from public.organizers where id=owner;
 end if;
 if o.storefront_status='published' and p_logo_id is null then raise exception using errcode='P0001',message='LOGO_REQUIRED'; end if;
 update public.organizers set
  organizer_type=nullif(btrim(p_profile->>'organizerType'),''),
  bio=nullif(p_profile->>'bio',''), website_url=nullif(btrim(p_profile->>'websiteUrl'),''),
  base_city=nullif(btrim(p_profile->>'baseCity'),''), storefront_logo_asset_id=p_logo_id
 where id=owner returning updated_at into saved_at;
 return jsonb_build_object('updatedAt',saved_at);
end; $$;
revoke all on function public.save_owned_organizer_setup(jsonb,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.save_owned_organizer_setup(jsonb,timestamptz,uuid) to authenticated;

create or replace function public.confirm_owned_storefront_handle(p_handle text,p_logo_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid(); h text:=lower(btrim(p_handle)); o public.organizers;
begin
 if not private.storefront_handle_valid(h) then raise exception using errcode='P0001',message='HANDLE_INVALID'; end if;
 select * into o from public.organizers where id=owner for update;
 if not found then raise exception using errcode='P0001',message='ORGANIZER_NOT_FOUND'; end if;
 if o.handle_confirmed_at is not null and o.handle<>h then raise exception using errcode='P0001',message='HANDLE_IMMUTABLE'; end if;
 if o.handle_confirmed_at is not null then return jsonb_build_object('handle',o.handle,'confirmedAt',o.handle_confirmed_at);end if;
 if p_logo_id is not null and not exists(select 1 from private.organizer_media where id=p_logo_id and owner_id=owner) then raise exception using errcode='P0001',message='LOGO_NOT_OWNED'; end if;
 begin
  update public.organizers set handle=h,handle_confirmed_at=clock_timestamp(),
   storefront_logo_asset_id=coalesce(storefront_logo_asset_id,p_logo_id),
   onboarding_completed_at=coalesce(onboarding_completed_at,clock_timestamp()) where id=owner returning * into o;
 exception when unique_violation then raise exception using errcode='P0001',message='HANDLE_TAKEN'; end;
 return jsonb_build_object('handle',o.handle,'confirmedAt',o.handle_confirmed_at);
end; $$;
