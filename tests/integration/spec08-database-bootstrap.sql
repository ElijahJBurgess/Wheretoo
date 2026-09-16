-- Only the recorded disposable Spec08 database. The cached image lacks this GoTrue field.
alter table auth.users add column if not exists banned_until timestamptz;
