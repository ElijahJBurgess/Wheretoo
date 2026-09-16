-- Spec08: preflight tier cardinality is independent of order quantity and inventory.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users (id, email) values
  ('96000000-0000-4000-8000-000000000001', 'cart-reservation-owner@example.invalid'),
  ('96000000-0000-4000-8000-000000000002', 'other-cart-owner@example.invalid');
insert into public.organizers (id, display_name)
values
  ('96000000-0000-4000-8000-000000000001', 'Cart Reservation Owner'),
  ('96000000-0000-4000-8000-000000000002', 'Other Cart Owner');
insert into public.events (
  id, organizer_id, status, moderation_status, title, description, category,
  starts_at, ends_at, venue_name, address_line1, city, region, postal_code,
  country_code, mapbox_feature_id, latitude, longitude, admission_type, published_at
) values (
  '96100000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001',
  'published', 'clear', 'Cart Reservation Event',
  'A complete paid fixture for multi-tier checkout reservations.', 'community',
  now() + interval '2 days', now() + interval '2 days 2 hours',
  'Cart Hall', '1 Cart Street', 'San Francisco', 'CA', '94105', 'US',
  'mapbox.cart-reservation', 37.7936, -122.3958, 'paid', now()
), (
  '96100000-0000-4000-8000-000000000002',
  '96000000-0000-4000-8000-000000000002',
  'draft', 'clear', 'Other Organizer Event',
  'A second organizer fixture for cross-event cart rejection.', 'community',
  now() + interval '3 days', now() + interval '3 days 2 hours',
  'Other Hall', '2 Cart Street', 'San Francisco', 'CA', '94105', 'US',
  'mapbox.other-cart-reservation', 37.7937, -122.3959, 'paid', null
);
insert into public.ticket_tiers (
  id, event_id, name, unit_amount_minor, currency, quantity_total, status, sort_order
) values
  ('96200000-0000-4000-8000-000000000001', '96100000-0000-4000-8000-000000000001', 'General Admission', 1001, 'usd', 30, 'active', 1),
  ('96200000-0000-4000-8000-000000000002', '96100000-0000-4000-8000-000000000001', 'VIP', 999, 'usd', 30, 'active', 2),
  ('96200000-0000-4000-8000-000000000003', '96100000-0000-4000-8000-000000000001', 'Final', 2000, 'usd', 1, 'active', 3),
  ('96200000-0000-4000-8000-000000000004', '96100000-0000-4000-8000-000000000002', 'Other Organizer Tier', 1500, 'usd', 10, 'active', 1);
insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, transfers_status, payouts_status,
  requirements_status, requirements_currently_due_count,
  requirements_past_due_count, last_synced_at
) values (
  '96000000-0000-4000-8000-000000000001', 'acct_cartreservation',
  'active', 'active', 'clear', 0, 0, now()
);
insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present,
  explicit_adult_content, gambling_present, weapons_present, high_risk_activity
) values (
  '96100000-0000-4000-8000-000000000001', 'all_ages', false, false, false, false, false, false
);
select set_config(
  'request.jwt.claim.sub', '96000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select public.accept_current_event_policies('96100000-0000-4000-8000-000000000001');
select public.publish_event('96100000-0000-4000-8000-000000000001');
reset role;


update private.checkout_runtime_control set checkout_creation_enabled=true where singleton;
set local role service_role;
-- Each permitted cardinality reaches canonical tier lookup, rather than the shape guard.
select throws_ok(format(
  'select * from public.server_get_checkout_preflight(%L, %L::uuid[])',
  '96100000-0000-4000-8000-000000000001',
  array(select ('96200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(90,89+quantity) n)
), 'P0001', 'TIER_NOT_ACTIVE', 'permitted distinct tier count '||quantity||' reaches canonical tier validation')
from generate_series(1,10) quantity;
select throws_ok($$ select * from public.server_get_checkout_preflight(
  '96100000-0000-4000-8000-000000000001',
  array(select ('96200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(90,100) n)
) $$,'P0001','CHECKOUT_INPUT_INVALID','eleven distinct tiers fail shape validation');
select throws_ok($$ select * from public.server_get_checkout_preflight(
  '96100000-0000-4000-8000-000000000001',
  array['96200000-0000-4000-8000-000000000001'::uuid,'96200000-0000-4000-8000-000000000001'::uuid]
) $$,'P0001','CHECKOUT_INPUT_INVALID','duplicate tier rejection remains unchanged');
select lives_ok($$ select * from public.server_get_checkout_preflight(
  '96100000-0000-4000-8000-000000000001',array['96200000-0000-4000-8000-000000000003'::uuid]
) $$,'eligible tier passes preflight before reservation checks stock');
select throws_ok($$ select * from public.server_reserve_checkout(
  '96100000-0000-4000-8000-000000000001',
  '[{"tier_id":"96200000-0000-4000-8000-000000000003","quantity":2}]'::jsonb,
  'Fixture','fixture@example.invalid','96300000-0000-4000-8000-000000000090',repeat('a',64)
) $$,'P0001','TIER_SOLD_OUT','stock shortage remains reachable after successful preflight');
reset role;
update public.ticket_tiers set status='archived' where id='96200000-0000-4000-8000-000000000003';
set local role service_role;
select throws_ok($$ select * from public.server_get_checkout_preflight(
  '96100000-0000-4000-8000-000000000001',array['96200000-0000-4000-8000-000000000003'::uuid]
) $$,'P0001','TIER_NOT_ACTIVE','inactive existing tier reaches canonical preflight validation');
select throws_ok($$ select * from public.server_reserve_checkout(
  '96100000-0000-4000-8000-000000000001',
  '[{"tier_id":"96200000-0000-4000-8000-000000000003","quantity":1}]'::jsonb,
  'Fixture','fixture@example.invalid','96300000-0000-4000-8000-000000000094',repeat('e',64)
) $$,'P0001','TIER_NOT_ACTIVE','canonical reservation still rejects an inactive tier');
reset role;
update public.ticket_tiers set status='active' where id='96200000-0000-4000-8000-000000000003';
set local role service_role;
select throws_ok($$ select * from public.server_reserve_checkout(
  '96100000-0000-4000-8000-000000000001',
  '[{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":6},{"tier_id":"96200000-0000-4000-8000-000000000002","quantity":5}]'::jsonb,
  'Fixture','fixture@example.invalid','96300000-0000-4000-8000-000000000091',repeat('b',64)
) $$,'P0001','CHECKOUT_INPUT_INVALID','eleven total tickets across two valid tiers remain forbidden');
select throws_ok($$ select * from public.server_reserve_checkout(
  '96100000-0000-4000-8000-000000000001',
  '[{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":11}]'::jsonb,
  'Fixture','fixture@example.invalid','96300000-0000-4000-8000-000000000092',repeat('c',64)
) $$,'P0001','CHECKOUT_INPUT_INVALID','per-tier quantity ceiling remains ten');
select lives_ok($$ select * from public.server_reserve_checkout(
  '96100000-0000-4000-8000-000000000001',
  '[{"tier_id":"96200000-0000-4000-8000-000000000001","quantity":6},{"tier_id":"96200000-0000-4000-8000-000000000002","quantity":4}]'::jsonb,
  'Fixture','fixture@example.invalid','96300000-0000-4000-8000-000000000093',repeat('d',64)
) $$,'ten total tickets across two valid tiers remain permitted');
reset role;
select is((select count(*) from public.orders where event_id='96100000-0000-4000-8000-000000000001'),1::bigint,'failed shape and stock checks insert no extra orders');
select is((select count(*) from public.tickets where event_id='96100000-0000-4000-8000-000000000001'),0::bigint,'preflight and reservation issue no tickets');
select * from finish();
rollback;
