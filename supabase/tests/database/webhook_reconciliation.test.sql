begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(15);

select has_function(
  'public', 'server_finalize_webhook_receipt', array['text', 'text', 'text'],
  'webhook receipt finalization has a narrow service wrapper'
);
select has_function(
  'public', 'server_get_webhook_order_snapshot', array['uuid', 'text'],
  'webhook order snapshot has a narrow service wrapper'
);

select function_privs_are(
  'public', 'server_finalize_webhook_receipt', array['text', 'text', 'text'],
  'service_role', array['EXECUTE'],
  'service role can finalize a webhook receipt'
);
select function_privs_are(
  'public', 'server_get_webhook_order_snapshot', array['uuid', 'text'],
  'service_role', array['EXECUTE'],
  'service role can read only the webhook order snapshot'
);

select function_privs_are(
  'public', 'server_finalize_webhook_receipt', array['text', 'text', 'text'],
  'anon', array[]::text[],
  'anonymous callers cannot finalize receipts'
);
select function_privs_are(
  'public', 'server_finalize_webhook_receipt', array['text', 'text', 'text'],
  'authenticated', array[]::text[],
  'authenticated callers cannot finalize receipts'
);
select function_privs_are(
  'public', 'server_get_webhook_order_snapshot', array['uuid', 'text'],
  'anon', array[]::text[],
  'anonymous callers cannot inspect webhook order snapshots'
);
select function_privs_are(
  'public', 'server_get_webhook_order_snapshot', array['uuid', 'text'],
  'authenticated', array[]::text[],
  'authenticated callers cannot inspect webhook order snapshots'
);

set local role service_role;

select * from public.server_record_webhook_receipt(
  'evt_Task14Finalization', 'customer.created', false,
  'cus_Task14Unknown', '2026-07-29.dahlia',
  '2026-08-26 02:00:00+00', repeat('a', 64)
);

select is(
  public.server_finalize_webhook_receipt(
    'evt_Task14Finalization', 'processed', 'IGNORED_EVENT_TYPE'
  ),
  'evt_Task14Finalization'::text,
  'permanent or ignored events finalize durably'
);
select results_eq(
  $$
    select processing_status, error_code, processed_at is not null
    from public.stripe_webhook_events
    where stripe_event_id = 'evt_Task14Finalization'
  $$,
  $$ values ('processed'::text, 'IGNORED_EVENT_TYPE'::text, true) $$,
  'processed finalization stores only a bounded safe code'
);

select * from public.server_record_webhook_receipt(
  'evt_Task14Transient', 'checkout.session.completed', false,
  'cs_test_Task14Transient', '2026-07-29.dahlia',
  '2026-08-26 02:01:00+00', repeat('b', 64)
);

select is(
  public.server_finalize_webhook_receipt(
    'evt_Task14Transient', 'failed', 'TRANSIENT_PROCESSING_FAILURE'
  ),
  'evt_Task14Transient'::text,
  'a transient failure is durably marked retryable'
);
select results_eq(
  $$
    select processing_status, error_code, processed_at is null
    from public.stripe_webhook_events
    where stripe_event_id = 'evt_Task14Transient'
  $$,
  $$ values ('failed'::text, 'TRANSIENT_PROCESSING_FAILURE'::text, true) $$,
  'transient finalization does not claim successful processing'
);
select results_eq(
  $$
    select should_process, processing_status, delivery_attempt_count
    from public.server_record_webhook_receipt(
      'evt_Task14Transient', 'checkout.session.completed', false,
      'cs_test_Task14Transient', '2026-07-29.dahlia',
      '2026-08-26 02:01:00+00', repeat('b', 64)
    )
  $$,
  $$ values (true, 'processing'::text, 2) $$,
  'a later delivery retries a transient failed receipt'
);

select throws_ok(
  $$ select public.server_finalize_webhook_receipt(
    'evt_Task14Transient', 'processed', 'contains unsafe spaces'
  ) $$,
  'P0001', 'WEBHOOK_FINALIZATION_INVALID',
  'receipt finalization accepts only bounded machine-safe codes'
);

select is_empty(
  $$
    select * from public.server_get_webhook_order_snapshot(
      '11111111-2222-4333-8444-555555555555',
      'cs_test_Task14Missing'
    )
  $$,
  'an unknown order/session pair exposes no snapshot'
);

select * from finish();
rollback;
