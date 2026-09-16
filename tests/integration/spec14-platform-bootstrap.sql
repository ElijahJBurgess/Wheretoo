-- Disposable platform compatibility, before application migration revokes only.
-- Current GoTrue owns its schema; this helper supports modern JWT claims from
-- PostgREST as well as the scalar claim used by inherited rollback-only SQL tests.
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgtap with schema extensions;

create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;

-- Restore the cached platform image's service defaults for postgres-created
-- objects. Each application migration still applies all of its explicit revokes.
alter default privileges for role postgres in schema public grant all on tables to service_role;
alter default privileges for role postgres in schema public grant all on sequences to service_role;
alter default privileges for role postgres in schema public grant all on functions to service_role;
