create or replace function private.is_canonical_production_policy_url(p_url text)
returns boolean
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  v_host text;
  v_path text;
  v_labels text[];
  v_label text;
  v_segment text;
begin
  if p_url <> pg_catalog.btrim(p_url)
    or p_url !~ '^https://[a-z0-9.-]+(/[A-Za-z0-9._~:/-]*)$' then
    return false;
  end if;

  v_host := pg_catalog.substring(p_url, '^https://([^/]+)');
  v_path := pg_catalog.substring(p_url, '^https://[^/]+(/.*)$');
  v_labels := pg_catalog.string_to_array(v_host, '.');

  if pg_catalog.char_length(v_host) > 253
    or pg_catalog.cardinality(v_labels) < 2
    or (v_labels[pg_catalog.cardinality(v_labels)] !~ '[a-z]') then
    return false;
  end if;

  foreach v_label in array v_labels loop
    if pg_catalog.char_length(v_label) not between 1 and 63
      or v_label !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' then
      return false;
    end if;
  end loop;

  if v_path is not null then
    foreach v_segment in array pg_catalog.string_to_array(v_path, '/') loop
      if v_segment in ('.', '..') then
        return false;
      end if;
    end loop;
  end if;

  return true;
end;
$$;

revoke all on function private.is_canonical_production_policy_url(text)
from public, anon, authenticated, service_role;
