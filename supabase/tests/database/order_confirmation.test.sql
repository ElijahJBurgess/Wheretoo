begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(15);

select has_function('private', 'lookup_checkout_integrity_confirmation', array['text'],
  'a private bearer-safe order confirmation projection exists');
select has_function('public', 'server_lookup_checkout_integrity_confirmation', array['text'],
  'a service-only order confirmation boundary exists');
select hasnt_function(
  'public', 'server_lookup_order_confirmation', array['text'],
  'the obsolete singular confirmation boundary is removed'
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
  'the service boundary returns only the approved minimum fields'
);

select results_eq(
  $$
    select array[
      pg_catalog.has_function_privilege('anon', 'public.server_lookup_checkout_integrity_confirmation(text)', 'EXECUTE'),
      pg_catalog.has_function_privilege('authenticated', 'public.server_lookup_checkout_integrity_confirmation(text)', 'EXECUTE'),
      pg_catalog.has_function_privilege('service_role', 'public.server_lookup_checkout_integrity_confirmation(text)', 'EXECUTE')
    ]
  $$,
  $$ values (array[false, false, true]) $$,
  'only service_role can execute the confirmation projection'
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
      and procedures.proname = 'lookup_checkout_integrity_confirmation'
      and privileges.grantee <> procedures.proowner
  ),
  0::bigint,
  'the private projection has no non-owner execution privilege'
);

insert into auth.users (id, email)
values ('16000000-0000-4000-8000-000000000001', 'confirmation-owner@example.invalid');

insert into public.organizers (id, display_name)
values ('16000000-0000-4000-8000-000000000001', 'Confirmation Owner');

insert into public.events (
  id, organizer_id, status, moderation_status, title, description, category,
  starts_at, ends_at, venue_name, address_line1, city, region, postal_code,
  country_code, mapbox_feature_id, latitude, longitude, admission_type, published_at
)
values (
  '26000000-0000-4000-8000-000000000001',
  '16000000-0000-4000-8000-000000000001',
  'published', 'clear', 'Confirmation Event', 'A confirmation projection fixture.',
  'community', '2026-10-01 02:00:00+00', '2026-10-01 05:00:00+00',
  'Confirmation Venue', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
  'mapbox.confirmation', 37.7936, -122.3958, 'paid', now()
);

insert into public.ticket_tiers (
  id, event_id, name, unit_amount_minor, currency, quantity_total, status, sort_order
)
values (
  '36000000-0000-4000-8000-000000000001',
  '26000000-0000-4000-8000-000000000001',
  'General admission', 2500, 'usd', 10, 'active', 1
);

insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, transfers_status, payouts_status,
  requirements_status, last_synced_at
)
values (
  '16000000-0000-4000-8000-000000000001', 'acct_confirmationfixture',
  'active', 'active', 'clear', now()
);

insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present,
  explicit_adult_content, gambling_present, weapons_present, high_risk_activity
)
values (
  '26000000-0000-4000-8000-000000000001', 'all_ages',
  false, false, false, false, false, false
);

select set_config(
  'request.jwt.claim.sub', '16000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select public.accept_current_event_policies('26000000-0000-4000-8000-000000000001');
select public.publish_event('26000000-0000-4000-8000-000000000001');
reset role;

update private.checkout_runtime_control
set checkout_creation_enabled = true
where singleton;

set local role service_role;

create temporary table confirmation_reservation on commit drop as
select * from public.server_reserve_checkout(
  '26000000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object('tier_id', '36000000-0000-4000-8000-000000000001'::uuid, 'quantity', 1)),
  'Private Buyer', 'private-buyer@example.invalid',
  '46000000-0000-4000-8000-000000000001',
  repeat('a', 64)
);

select is(
  (select count(*) from public.server_lookup_checkout_integrity_confirmation(repeat('b', 64))),
  0::bigint,
  'an unknown valid hash returns the same empty projection'
);

select results_eq(
  $$
    select event_title, event_starts_at, event_ends_at, event_timezone,
      event_venue_name, items, confirmation_status
    from public.server_lookup_checkout_integrity_confirmation(repeat('a', 64))
  $$,
  $$ values (
    'Confirmation Event'::text,
    '2026-10-01 02:00:00+00'::timestamptz,
    '2026-10-01 05:00:00+00'::timestamptz,
    'America/Los_Angeles'::text,
    'Confirmation Venue'::text,
    '[{"tier_name":"General admission","quantity":1,"unit_amount_minor":2500,"subtotal_minor":2500,"currency":"usd"}]'::jsonb,
    'processing'::text
  ) $$,
  'the bearer returns current persisted processing truth and approved event/tier fields'
);

select is(
  (
    select count(*)
    from information_schema.parameters
    where specific_schema = 'public'
      and specific_name like 'server_lookup_checkout_integrity_confirmation_%'
      and parameter_mode = 'OUT'
      and parameter_name in (
        'buyer_name', 'buyer_email', 'order_id', 'event_id', 'ticket_id',
        'application_fee_amount_minor', 'stripe_destination_account_id',
        'stripe_checkout_session_id', 'stripe_payment_intent_id', 'failure_code'
      )
  ),
  0::bigint,
  'the projection cannot disclose customer, identifier, fee, Stripe, or failure internals'
);

create or replace function pg_temp.confirmation_status_after_update(p_status text)
returns text language plpgsql as $$
declare projected text;
begin
  update public.orders set status = p_status
  where id = (select order_id from confirmation_reservation);
  select confirmation_status into projected
  from public.server_lookup_checkout_integrity_confirmation(repeat('a', 64));
  return projected;
end;
$$;

select results_eq(
  $$
    select pg_temp.confirmation_status_after_update(status)
    from unnest(array[
      'creating_checkout', 'checkout_open', 'payment_processing', 'paid',
      'payment_failed', 'expired', 'cancelled', 'partially_refunded',
      'refunded', 'requires_review'
    ]) as statuses(status)
  $$,
  $$ values
    ('processing'::text), ('processing'), ('processing'), ('paid'),
    ('payment_failed'), ('expired'), ('cancelled'), ('requires_review'),
    ('refunded'), ('requires_review')
  $$,
  'every persisted status maps through the canonical projection without hiding review'
);

update public.orders set status = 'paid'
where id = (select order_id from confirmation_reservation);

select results_eq(
  $$ select confirmation_status from public.server_lookup_checkout_integrity_confirmation(repeat('a', 64)) $$,
  $$ values ('paid'::text) $$,
  'confirmation reads paid only after paid is persisted'
);

update public.orders set status = 'refunded'
where id = (select order_id from confirmation_reservation);

select results_eq(
  $$ select confirmation_status from public.server_lookup_checkout_integrity_confirmation(repeat('a', 64)) $$,
  $$ values ('refunded'::text) $$,
  'confirmation reads refunded truth from the database'
);

select is(
  (
    select count(*)
    from public.orders
    where id = (select order_id from confirmation_reservation)
      and status = 'refunded'
  ),
  1::bigint,
  'confirmation lookup is read-only and never changes persisted order state'
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
  'the rollback-only single-item cart confirmation suite restores checkout creation to disabled'
);

select * from finish();
rollback;
