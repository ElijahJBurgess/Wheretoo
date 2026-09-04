begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_function(
  'public', 'server_lookup_checkout_integrity_confirmation', array['text'],
  'checkout integrity confirmation has a token-scoped service boundary'
);

select results_eq(
  $$
    select (array_agg(parameter_name || ':' || data_type order by ordinal_position)::text[])
      collate "C"
    from information_schema.parameters
    where specific_schema = 'public'
      and specific_name like 'server_lookup_checkout_integrity_confirmation_%'
      and parameter_mode = 'OUT'
  $$,
  $$ values ((array[
    'event_title:text', 'event_starts_at:timestamp with time zone',
    'event_ends_at:timestamp with time zone', 'event_timezone:text',
    'event_venue_name:text', 'items:jsonb', 'order_number:text',
    'confirmation_status:text', 'quantity:integer', 'currency:text',
    'subtotal_minor:bigint', 'tax_amount_minor:bigint', 'total_minor:bigint'
  ]::text[]) collate "C") $$,
  'the service boundary returns exactly the approved safe confirmation columns'
);

select results_eq(
  $$
    select array[
      pg_catalog.has_function_privilege(
        'anon', 'public.server_lookup_checkout_integrity_confirmation(text)', 'EXECUTE'
      ),
      pg_catalog.has_function_privilege(
        'authenticated', 'public.server_lookup_checkout_integrity_confirmation(text)', 'EXECUTE'
      ),
      pg_catalog.has_function_privilege(
        'service_role', 'public.server_lookup_checkout_integrity_confirmation(text)', 'EXECUTE'
      )
    ]
  $$,
  $$ values (array[false, false, true]) $$,
  'only service_role can execute the multi-item confirmation projection'
);

insert into auth.users (id, email)
values ('c9100000-0000-4000-8000-000000000001', 'task9-owner@example.invalid');

insert into public.organizers (id, display_name)
values ('c9100000-0000-4000-8000-000000000001', 'Task 9 Confirmation');

insert into public.events (
  id, organizer_id, status, moderation_status, title, description, category,
  starts_at, ends_at, venue_name, address_line1, city, region, postal_code,
  country_code, mapbox_feature_id, latitude, longitude, admission_type, published_at
) values (
  'c9200000-0000-4000-8000-000000000001',
  'c9100000-0000-4000-8000-000000000001',
  'published', 'clear', 'Task 9 Night Market',
  'Rollback-only multi-item confirmation verification.', 'community',
  '2026-10-01 02:00:00+00', '2026-10-01 05:00:00+00',
  'Civic Center Plaza', '9 Market Street', 'San Francisco', 'CA', '94105', 'US',
  'mapbox.task9-confirmation', 37.7936, -122.3958, 'paid', now()
);

insert into public.ticket_tiers (
  id, event_id, name, unit_amount_minor, currency, quantity_total, status, sort_order
) values
  (
    'c9300000-0000-4000-8000-000000000001',
    'c9200000-0000-4000-8000-000000000001',
    'General admission', 2500, 'usd', 20, 'active', 1
  ),
  (
    'c9300000-0000-4000-8000-000000000002',
    'c9200000-0000-4000-8000-000000000001',
    'VIP', 5000, 'usd', 10, 'active', 2
  );

insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, transfers_status, payouts_status,
  requirements_status, requirements_currently_due_count,
  requirements_past_due_count, last_synced_at
) values (
  'c9100000-0000-4000-8000-000000000001', 'acct_task9confirmation',
  'active', 'active', 'clear', 0, 0, now()
);

insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present,
  explicit_adult_content, gambling_present, weapons_present, high_risk_activity
) values (
  'c9200000-0000-4000-8000-000000000001', 'all_ages',
  false, false, false, false, false, false
);

select set_config(
  'request.jwt.claim.sub', 'c9100000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select public.accept_current_event_policies('c9200000-0000-4000-8000-000000000001');
select public.publish_event('c9200000-0000-4000-8000-000000000001');
reset role;

update private.checkout_runtime_control
set checkout_creation_enabled = true
where singleton;

set local role service_role;
create temporary table confirmation_order on commit drop as
select reservation.order_id
from public.server_reserve_checkout(
  'c9200000-0000-4000-8000-000000000001',
  '[{"tier_id":"c9300000-0000-4000-8000-000000000002","quantity":1},{"tier_id":"c9300000-0000-4000-8000-000000000001","quantity":2}]'::jsonb,
  'Synthetic Buyer', 'task9-buyer@example.invalid',
  'c9400000-0000-4000-8000-000000000001', repeat('9', 64)
) as reservation;

select is(
  (select count(*) from public.server_lookup_checkout_integrity_confirmation(repeat('8', 64))),
  0::bigint,
  'an unknown valid bearer hash returns the same empty projection'
);

select results_eq(
  $$
    select event_title, event_starts_at, event_ends_at, event_timezone,
      event_venue_name, items, confirmation_status, quantity, currency,
      subtotal_minor, tax_amount_minor, total_minor
    from public.server_lookup_checkout_integrity_confirmation(repeat('9', 64))
  $$,
  $$ values (
    'Task 9 Night Market'::text,
    '2026-10-01 02:00:00+00'::timestamptz,
    '2026-10-01 05:00:00+00'::timestamptz,
    'America/Los_Angeles'::text,
    'Civic Center Plaza'::text,
    '[
      {"tier_name":"General admission","quantity":2,"unit_amount_minor":2500,"subtotal_minor":5000,"currency":"usd"},
      {"tier_name":"VIP","quantity":1,"unit_amount_minor":5000,"subtotal_minor":5000,"currency":"usd"}
    ]'::jsonb,
    'processing'::text, 3::integer, 'usd'::text,
    10000::bigint, 0::bigint, 10000::bigint
  ) $$,
  'confirmation returns stable sorted item snapshots and authoritative aggregate totals'
);

reset role;
update public.ticket_tiers
set name = case id
    when 'c9300000-0000-4000-8000-000000000001' then 'Renamed general'
    else 'Renamed VIP'
  end,
  unit_amount_minor = unit_amount_minor + 777
where event_id = 'c9200000-0000-4000-8000-000000000001';
update public.ticket_tiers
set sort_order = 3
where id = 'c9300000-0000-4000-8000-000000000001';
update public.ticket_tiers
set sort_order = 1
where id = 'c9300000-0000-4000-8000-000000000002';
update public.ticket_tiers
set sort_order = 2
where id = 'c9300000-0000-4000-8000-000000000001';
set local role service_role;

select results_eq(
  $$
    select items, subtotal_minor, total_minor
    from public.server_lookup_checkout_integrity_confirmation(repeat('9', 64))
  $$,
  $$ values (
    '[
      {"tier_name":"General admission","quantity":2,"unit_amount_minor":2500,"subtotal_minor":5000,"currency":"usd"},
      {"tier_name":"VIP","quantity":1,"unit_amount_minor":5000,"subtotal_minor":5000,"currency":"usd"}
    ]'::jsonb,
    10000::bigint, 10000::bigint
  ) $$,
  'later tier edits cannot rewrite confirmation labels, prices, sorting, or totals'
);

select is(
  position('c9100000-0000-4000-8000-000000000001' in row_to_json(confirmation)::text),
  0,
  'serialized confirmation does not disclose organizer identity'
)
from public.server_lookup_checkout_integrity_confirmation(repeat('9', 64)) as confirmation;

select is(
  position('task9-buyer@example.invalid' in row_to_json(confirmation)::text),
  0,
  'serialized confirmation does not disclose buyer data'
)
from public.server_lookup_checkout_integrity_confirmation(repeat('9', 64)) as confirmation;

select is(
  row_to_json(confirmation)::text ~
    '(stripe|reconciliation|failure|ticket_id|order_item_id|unit_sequence|credential|token)',
  false,
  'serialized confirmation has no Stripe, reconciliation, failure, ticket, or credential field'
)
from public.server_lookup_checkout_integrity_confirmation(repeat('9', 64)) as confirmation;

select is(
  row_to_json(confirmation)::text ~
    '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
  false,
  'serialized confirmation does not disclose UUID-shaped internal identity'
)
from public.server_lookup_checkout_integrity_confirmation(repeat('9', 64)) as confirmation;

update public.orders set status = 'checkout_open'
where id = (select order_id from confirmation_order);
select results_eq(
  $$ select confirmation_status from public.server_lookup_checkout_integrity_confirmation(repeat('9', 64)) $$,
  $$ values ('processing'::text) $$,
  'checkout-open orders remain processing'
);

update public.orders set status = 'payment_processing'
where id = (select order_id from confirmation_order);
select results_eq(
  $$ select confirmation_status from public.server_lookup_checkout_integrity_confirmation(repeat('9', 64)) $$,
  $$ values ('processing'::text) $$,
  'payment-processing orders remain processing'
);

update public.orders set status = 'paid'
where id = (select order_id from confirmation_order);
select results_eq(
  $$ select confirmation_status from public.server_lookup_checkout_integrity_confirmation(repeat('9', 64)) $$,
  $$ values ('paid'::text) $$,
  'paid orders are presented as paid'
);

update public.orders set status = 'payment_failed'
where id = (select order_id from confirmation_order);
select results_eq(
  $$ select confirmation_status from public.server_lookup_checkout_integrity_confirmation(repeat('9', 64)) $$,
  $$ values ('payment_failed'::text) $$,
  'payment failures remain distinct'
);

update public.orders set status = 'cancelled'
where id = (select order_id from confirmation_order);
select results_eq(
  $$ select confirmation_status from public.server_lookup_checkout_integrity_confirmation(repeat('9', 64)) $$,
  $$ values ('cancelled'::text) $$,
  'cancelled orders remain distinct from expiry'
);

update public.orders set status = 'expired'
where id = (select order_id from confirmation_order);
select results_eq(
  $$ select confirmation_status from public.server_lookup_checkout_integrity_confirmation(repeat('9', 64)) $$,
  $$ values ('expired'::text) $$,
  'expired orders are presented as expired'
);

update public.orders set status = 'refunded'
where id = (select order_id from confirmation_order);
select results_eq(
  $$ select confirmation_status from public.server_lookup_checkout_integrity_confirmation(repeat('9', 64)) $$,
  $$ values ('refunded'::text) $$,
  'fully refunded orders are presented as refunded'
);

update public.orders set status = 'requires_review'
where id = (select order_id from confirmation_order);
select results_eq(
  $$ select confirmation_status from public.server_lookup_checkout_integrity_confirmation(repeat('9', 64)) $$,
  $$ values ('requires_review'::text) $$,
  'review-held orders retain their recoverable review state'
);

update public.orders set status = 'partially_refunded'
where id = (select order_id from confirmation_order);
select results_eq(
  $$ select confirmation_status from public.server_lookup_checkout_integrity_confirmation(repeat('9', 64)) $$,
  $$ values ('requires_review'::text) $$,
  'legacy partial refunds fail closed to review'
);

select throws_ok(
  $$ select * from public.server_lookup_checkout_integrity_confirmation('raw-clear-bearer') $$,
  'P0001', 'ORDER_NOT_FOUND',
  'the service projection rejects non-hash input with the safe not-found code'
);

reset role;
update private.checkout_runtime_control
set checkout_creation_enabled = false
where singleton;

select is(
  (select checkout_creation_enabled from private.checkout_runtime_control where singleton),
  false,
  'the rollback-only suite restores checkout creation to disabled'
);

select * from finish();
rollback;
