-- Disposable SQL harness only: Storage relation surface needed by image migrations.
-- No Storage service is emulated or tested; CSV never reads these relations.
create schema if not exists storage authorization postgres;
grant usage,create on schema storage to postgres;
set role postgres;
create schema if not exists storage;
create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table if not exists storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner_id text,user_metadata jsonb,metadata jsonb,version text);
alter table storage.objects enable row level security;
reset role;
