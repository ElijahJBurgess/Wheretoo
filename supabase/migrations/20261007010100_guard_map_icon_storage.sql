begin;
-- Storage's service credential bypasses RLS, but must not rewrite finalized
-- packages. This guard is bucket-scoped and leaves other Storage work untouched.
create function private.guard_map_icon_object() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v private.map_icon_versions;
begin
  if tg_op <> 'INSERT' and old.bucket_id in ('map-icon-originals','map-icon-published') then
    select * into v from private.map_icon_versions where
      (old.bucket_id='map-icon-originals' and old.name in (original_path,crop_path))
      or (old.bucket_id='map-icon-published' and old.name=runtime_path)
      for update;
    -- Transitions lock this same version and only MVCC-read Storage rows.
    -- If mutation wins, transition sees its committed result; if transition
    -- wins, this locking read sees finalized state and rejects the mutation.
    if found and ((old.bucket_id='map-icon-originals' and v.state<>'validated')
      or (old.bucket_id='map-icon-published' and v.state in ('published','retired','revoked')))
      then raise exception 'ICON_ASSET_IMMUTABLE'; end if;
  end if;
  if tg_op <> 'DELETE' and new.bucket_id in ('map-icon-originals','map-icon-published') then
    if not exists(select 1 from private.map_icon_versions where
      (new.bucket_id='map-icon-originals' and new.name in (original_path,crop_path) and state='validated')
      or (new.bucket_id='map-icon-published' and new.name=runtime_path and state='approved'))
      then raise exception 'ICON_ASSET_NOT_APPROVED'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function private.guard_map_icon_object() from public,anon,authenticated,service_role;
create trigger guard_map_icon_object before insert or update or delete on storage.objects
  for each row execute function private.guard_map_icon_object();
commit;
