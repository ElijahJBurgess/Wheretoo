begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

select has_column(
  'public', 'organizer_stripe_accounts', 'last_sync_sequence',
  'Connect accounts persist the last causal refresh sequence'
);
select hasnt_column(
  'public', 'organizer_stripe_accounts', 'last_sync_revision',
  'client-generated revisions no longer participate in Connect ordering'
);
select has_function(
  'public', 'server_begin_connect_refresh', array['text'],
  'Connect refreshes acquire a database-issued sequence before retrieval'
);
select hasnt_function(
  'public', 'server_persist_connect_status_if_current',
  array['text', 'timestamptz', 'text', 'text', 'text', 'text', 'integer', 'integer', 'text'],
  'the legacy client-time Connect CAS boundary is removed'
);
select has_function(
  'public', 'server_persist_connect_status_if_current',
  array['text', 'bigint', 'text', 'text', 'text', 'integer', 'integer', 'text'],
  'Connect persistence compares the database-issued causal sequence'
);
select function_privs_are(
  'public', 'server_begin_connect_refresh', array['text'],
  'service_role', array['EXECUTE'],
  'service role can begin a Connect refresh'
);
select function_privs_are(
  'public', 'server_begin_connect_refresh', array['text'],
  'anon', array[]::text[],
  'anonymous callers cannot allocate Connect refresh sequences'
);
select function_privs_are(
  'public', 'server_begin_connect_refresh', array['text'],
  'authenticated', array[]::text[],
  'authenticated callers cannot allocate Connect refresh sequences'
);
select function_privs_are(
  'public', 'server_persist_connect_status_if_current',
  array['text', 'bigint', 'text', 'text', 'text', 'integer', 'integer', 'text'],
  'service_role', array['EXECUTE'],
  'service role can persist a begun Connect refresh'
);
select function_privs_are(
  'public', 'server_persist_connect_status_if_current',
  array['text', 'bigint', 'text', 'text', 'text', 'integer', 'integer', 'text'],
  'anon', array[]::text[],
  'anonymous callers cannot persist Connect refresh truth'
);
select function_privs_are(
  'public', 'server_persist_connect_status_if_current',
  array['text', 'bigint', 'text', 'text', 'text', 'integer', 'integer', 'text'],
  'authenticated', array[]::text[],
  'authenticated callers cannot persist Connect refresh truth'
);

insert into auth.users (id, email) values (
  '19000000-0000-4000-8000-000000000003',
  'connect-refresh-sequence@example.invalid'
);
insert into public.organizers (id, display_name) values (
  '19000000-0000-4000-8000-000000000003',
  'Connect Refresh Sequence'
);
insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, transfers_status, payouts_status,
  requirements_status, requirements_currently_due_count,
  requirements_past_due_count, last_synced_at
) values (
  '19000000-0000-4000-8000-000000000003',
  'acct_ConnectRefreshSequence',
  'pending', 'pending', 'pending', 1, 0, '2099-01-01 00:00:00+00'
);

set local role service_role;

select throws_ok(
  $$ select public.server_begin_connect_refresh('acct_ConnectRefreshMissing') $$,
  'P0001', 'CONNECT_ACCOUNT_NOT_FOUND',
  'a refresh token cannot be issued before the account row exists'
);

create temporary table refresh_tokens (
  kind text primary key,
  sequence_number bigint not null
) on commit drop;
grant select on refresh_tokens to service_role;
insert into refresh_tokens values
  ('older', public.server_begin_connect_refresh('acct_ConnectRefreshSequence')),
  ('newer', public.server_begin_connect_refresh('acct_ConnectRefreshSequence'));

select ok(
  (select sequence_number from refresh_tokens where kind = 'older') > 0,
  'the database issues a positive causal sequence'
);
select ok(
  (select sequence_number from refresh_tokens where kind = 'newer') >
    (select sequence_number from refresh_tokens where kind = 'older'),
  'a later begin call receives a newer causal sequence'
);
select results_eq(
  $$
    select persistence_result
    from public.server_persist_connect_status_if_current(
      'acct_ConnectRefreshSequence',
      (select sequence_number from refresh_tokens where kind = 'newer'),
      'restricted', 'restricted', 'restricted', 2, 1,
      'STRIPE_REQUIREMENTS_PAST_DUE'
    )
  $$,
  $$ values ('updated'::text) $$,
  'the newer restricted refresh persists first'
);
select results_eq(
  $$
    select persistence_result
    from public.server_persist_connect_status_if_current(
      'acct_ConnectRefreshSequence',
      (select sequence_number from refresh_tokens where kind = 'older'),
      'active', 'active', 'clear', 0, 0, null
    )
  $$,
  $$ values ('stale'::text) $$,
  'the older ready refresh is stale even within the same database timestamp'
);
select results_eq(
  $$
    select transfers_status, requirements_status, last_sync_sequence
    from public.organizer_stripe_accounts
    where stripe_account_id = 'acct_ConnectRefreshSequence'
  $$,
  $$
    select 'restricted'::text, 'restricted'::text,
      (select sequence_number from refresh_tokens where kind = 'newer')
  $$,
  'same-timestamp ordering preserves the newer restricted sequence'
);

reset role;
update public.organizer_stripe_accounts
set last_synced_at = '2199-01-01 00:00:00+00'
where stripe_account_id = 'acct_ConnectRefreshSequence';
set local role service_role;
insert into refresh_tokens values (
  'after-skew',
  public.server_begin_connect_refresh('acct_ConnectRefreshSequence')
);
select results_eq(
  $$
    select persistence_result
    from public.server_persist_connect_status_if_current(
      'acct_ConnectRefreshSequence',
      (select sequence_number from refresh_tokens where kind = 'after-skew'),
      'active', 'active', 'clear', 0, 0, null
    )
  $$,
  $$ values ('updated'::text) $$,
  'a future-skewed stored timestamp cannot block a newer causal sequence'
);
reset role;
select results_eq(
  $$
    select transfers_status, requirements_status, last_sync_sequence,
      last_synced_at < '2199-01-01 00:00:00+00'::timestamptz
    from public.organizer_stripe_accounts
    where stripe_account_id = 'acct_ConnectRefreshSequence'
  $$,
  $$
    select 'active'::text, 'clear'::text,
      (select sequence_number from refresh_tokens where kind = 'after-skew'),
      true
  $$,
  'database sequence ordering is independent of skewed application clocks'
);
select is(
  (
    select count(*)
    from private.connect_refresh_tokens
    where stripe_account_id = 'acct_ConnectRefreshSequence'
      and persistence_result is not null
  ),
  3::bigint,
  'each exact refresh token records one durable CAS result'
);

select * from finish(true);
rollback;
