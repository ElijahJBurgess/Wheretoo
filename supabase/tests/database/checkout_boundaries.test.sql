begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(22);

select has_function('private', 'checkout_expiry_from', array['timestamp with time zone'],
  'a deterministic Checkout expiry policy helper exists');

select is(
  private.checkout_expiry_from('2026-08-26 12:00:00+00'),
  '2026-08-26 12:39:00+00'::timestamptz,
  'an exact minute receives the bounded thirty-nine-minute maximum'
);

select cmp_ok(
  private.checkout_expiry_from('2026-08-26 12:00:59.999999+00')
    - '2026-08-26 12:00:59.999999+00'::timestamptz
    - interval '30 minutes',
  '>=', interval '8 minutes',
  'the worst minute boundary covers one ambiguous call and one full retry envelope'
);

select has_column('public', 'orders', 'stripe_destination_account_id',
  'orders persist the immutable Checkout destination');
select has_column('public', 'orders', 'stripe_checkout_integration_identifier',
  'orders persist the deterministic integration identifier');
select has_column('public', 'orders', 'stripe_checkout_request_digest',
  'orders persist the canonical Stripe create request digest');

select col_not_null('public', 'orders', 'stripe_destination_account_id',
  'the immutable destination is required');
select col_not_null('public', 'orders', 'stripe_checkout_integration_identifier',
  'the deterministic integration identifier is required');
select col_not_null('public', 'orders', 'stripe_checkout_request_digest',
  'the canonical create digest is required');

select has_function('public', 'server_get_checkout_preflight', array['uuid', 'uuid'],
  'a narrow service preflight boundary exists');
select has_function('public', 'server_lookup_checkout_cancellation', array['text'],
  'a narrow bearer cancellation lookup exists');
select has_function('public', 'server_consume_checkout_rate_limit', array['text'],
  'an atomic database-backed anonymous rate bucket exists');

select results_eq(
  $$
    select array[
      pg_catalog.has_function_privilege('anon', function_name, 'EXECUTE'),
      pg_catalog.has_function_privilege('authenticated', function_name, 'EXECUTE'),
      pg_catalog.has_function_privilege('service_role', function_name, 'EXECUTE')
    ]
    from unnest(array[
      'public.server_consume_checkout_rate_limit(text)',
      'public.server_get_checkout_preflight(uuid,uuid)',
      'public.server_lookup_checkout_cancellation(text)'
    ]) as functions(function_name)
    order by function_name
  $$,
  $$ values
    (array[false, false, true]),
    (array[false, false, true]),
    (array[false, false, true])
  $$,
  'only service_role can execute all three checkout boundary RPCs'
);

select throws_ok(
  $$ select * from public.server_get_checkout_preflight(
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000001'
  ) $$,
  'P0001', 'EVENT_NOT_SELLABLE',
  'a missing event returns the stable event domain code before Connect'
);

set local role service_role;

select is(
  (select count(*) from public.server_lookup_checkout_cancellation(repeat('a', 64))),
  0::bigint,
  'an unknown bearer hash returns no order through the narrow lookup'
);

select throws_ok(
  $$ select * from public.server_lookup_checkout_cancellation('raw-bearer') $$,
  'P0001', 'CHECKOUT_INPUT_INVALID',
  'the lookup accepts only a server-derived SHA-256 bearer hash'
);

select results_eq(
  $$ select allowed from public.server_consume_checkout_rate_limit(repeat('1', 64)) $$,
  $$ values (true) $$,
  'the first hashed caller request is allowed'
);

select results_eq(
  $$
    select count(*)::bigint
    from generate_series(1, 9) as series(n)
    cross join lateral public.server_consume_checkout_rate_limit(
      repeat('1', 63) || substr('1', 1, (series.n * 0 + 1)::integer)
    )
    where allowed
  $$,
  $$ values (9::bigint) $$,
  'the database bucket atomically admits the remaining bounded requests'
);

select results_eq(
  $$ select allowed, retry_after_seconds > 0
     from public.server_consume_checkout_rate_limit(repeat('1', 64)) $$,
  $$ values (false, true) $$,
  'the eleventh request is denied with a bounded retry delay'
);

reset role;

select is(
  (
    select count(*)
    from information_schema.tables
    where table_schema = 'public'
      and table_name like '%checkout_rate%'
  ),
  0::bigint,
  'rate bucket storage is not exposed in the public schema'
);

select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'checkout_rate_limit_buckets'
      and column_name in ('ip', 'identity', 'raw_identity', 'client_identity')
  ),
  0::bigint,
  'private rate storage has no raw client identity column'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = procedures.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(procedures.proacl, pg_catalog.acldefault('f', procedures.proowner))
    ) as privileges
    where namespaces.nspname = 'private'
      and procedures.proname like '%checkout%'
      and privileges.grantee <> procedures.proowner
  ),
  0::bigint,
  'private checkout helpers have no non-owner execution privilege'
);

select * from finish();
rollback;
