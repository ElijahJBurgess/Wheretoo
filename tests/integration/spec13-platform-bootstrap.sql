-- Disposable image compatibility, BEFORE replay only. Never apply to a linked DB.
-- The cached image's 00000000000000-initial-schema.sql lines 39-56 establish
-- public-schema default grants, which DROP SCHEMA removes. Restore only the
-- service-role subset for the postgres migration role. Application migrations
-- subsequently apply every explicit revoke; browser grants are not synthesized.
alter default privileges for role postgres in schema public grant all on tables to service_role;
alter default privileges for role postgres in schema public grant all on sequences to service_role;
alter default privileges for role postgres in schema public grant all on functions to service_role;
