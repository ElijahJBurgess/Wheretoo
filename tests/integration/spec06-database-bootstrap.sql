-- Disposable test environment only. Run exclusively via the guarded Spec06 runner.
-- The cached Postgres image has a legacy auth.uid shim. Support both the SQL
-- fixtures' scalar claim and modern PostgREST's claims JSON; this is not GoTrue.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;
update private.organizer_policy_release_settings set environment='development',updated_at=statement_timestamp() where singleton_id;
update private.organizer_policy_requirements set policy_version_id=case policy_kind when 'organizer_terms' then 'dev-organizer-terms-v1' else 'dev-event-policy-v1' end;
