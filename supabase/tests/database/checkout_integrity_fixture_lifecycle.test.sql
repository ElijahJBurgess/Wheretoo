begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

insert into auth.users (id, email)
values (
  'aa130000-0000-4000-8000-000000000001',
  'checkout-integrity-fixture@example.invalid'
);

insert into public.organizers (id, display_name)
values (
  'aa130000-0000-4000-8000-000000000001',
  'Checkout Integrity Fixture'
);

insert into public.events (
  id, organizer_id, status, moderation_status, title, description, category,
  starts_at, ends_at, timezone, venue_name, address_line1, city, region,
  postal_code, country_code, mapbox_feature_id, latitude, longitude,
  admission_type, capacity
)
values (
  'aa130000-0000-4000-8000-000000000002',
  'aa130000-0000-4000-8000-000000000001',
  'draft', 'not_evaluated', 'Checkout Integrity Stable Fixture',
  'Rollback-only fixture proving authenticated eligibility and audit tombstoning.',
  'music', statement_timestamp() + interval '7 days',
  statement_timestamp() + interval '7 days 4 hours', 'America/Los_Angeles',
  'Fixture Hall', '1 Fixture Way', 'San Francisco', 'CA', '94105', 'US',
  'mapbox.checkout-integrity-stable-fixture', 37.7936, -122.3958,
  'paid', 10
);

insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, livemode, transfers_status, payouts_status,
  requirements_status, requirements_currently_due_count,
  requirements_past_due_count, last_synced_at
)
values (
  'aa130000-0000-4000-8000-000000000001',
  'acct_checkoutintegrityfixture', false, 'active', 'active', 'clear', 0, 0,
  statement_timestamp()
);

insert into public.ticket_tiers (
  id, event_id, name, description, unit_amount_minor, currency,
  quantity_total, status, sort_order
)
values
  (
    'aa130000-0000-4000-8000-000000000003',
    'aa130000-0000-4000-8000-000000000002',
    'Task 17 General Admission', null, 1500, 'usd', 10, 'draft', 1
  ),
  (
    'aa130000-0000-4000-8000-000000000004',
    'aa130000-0000-4000-8000-000000000002',
    'Task 17 VIP', null, 2500, 'usd', 10, 'draft', 2
  );

select set_config(
  'request.jwt.claim.sub',
  'aa130000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select lives_ok(
  $$
    select * from public.save_owned_event_requirements(
      'aa130000-0000-4000-8000-000000000002',
      '{"minimum_age":"all_ages","alcohol_present":false,"cannabis_present":false,"explicit_adult_content":false,"gambling_present":false,"weapons_present":false,"high_risk_activity":false}'::jsonb
    )
  $$,
  'the authenticated fixture owner records the real low-risk disclosure'
);

select lives_ok(
  $$
    select * from public.accept_current_event_policies(
      'aa130000-0000-4000-8000-000000000002'
    )
  $$,
  'the authenticated fixture owner accepts the configured development policies'
);

select lives_ok(
  $$ select public.publish_event('aa130000-0000-4000-8000-000000000002') $$,
  'the authenticated fixture owner publishes through the canonical boundary'
);

reset role;

set local role service_role;
select results_eq(
  $$
    select organizer_id, stripe_account_id
    from public.server_get_checkout_preflight(
      'aa130000-0000-4000-8000-000000000002',
      array[
        (select id from public.ticket_tiers where event_id = 'aa130000-0000-4000-8000-000000000002' and sort_order = 1),
        (select id from public.ticket_tiers where event_id = 'aa130000-0000-4000-8000-000000000002' and sort_order = 2)
      ]::uuid[]
    )
  $$,
  $$ values (
    'aa130000-0000-4000-8000-000000000001'::uuid,
    'acct_checkoutintegrityfixture'::text
  ) $$,
  'checkout preflight proves the exact event, tiers, organizer, and Connect binding'
);

reset role;
set local role anon;
select is(
  (
    select count(*)
    from public.get_public_event('aa130000-0000-4000-8000-000000000002')
  ),
  1::bigint,
  'the authenticated publication is publicly eligible before retirement'
);

reset role;
select set_config(
  'request.jwt.claim.sub',
  'aa130000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select lives_ok(
  $$
    select public.save_owned_event_revision(
      'aa130000-0000-4000-8000-000000000002',
      (
        select jsonb_build_object(
          'title', events.title,
          'description', events.description,
          'category', events.category,
          'starts_at', statement_timestamp() + interval '30 days',
          'ends_at', statement_timestamp() + interval '30 days 4 hours',
          'timezone', events.timezone,
          'venue_name', events.venue_name,
          'address_line1', events.address_line1,
          'address_line2', events.address_line2,
          'city', events.city,
          'region', events.region,
          'postal_code', events.postal_code,
          'country_code', events.country_code,
          'mapbox_feature_id', events.mapbox_feature_id,
          'latitude', events.latitude,
          'longitude', events.longitude,
          'admission_type', events.admission_type,
          'capacity', events.capacity
        )
        from public.events as events
        where events.id = 'aa130000-0000-4000-8000-000000000002'
      )
    )
  $$,
  'the authenticated owner tombstones the event with a valid future revision'
);

reset role;
set local role anon;
select is(
  (
    select count(*)
    from public.get_public_event('aa130000-0000-4000-8000-000000000002')
  ),
  0::bigint,
  'retirement removes the fixture from the public projection immediately'
);

reset role;
set local role service_role;
select throws_ok(
  $$
    select * from public.server_get_checkout_preflight(
      'aa130000-0000-4000-8000-000000000002',
      array[
        (select id from public.ticket_tiers where event_id = 'aa130000-0000-4000-8000-000000000002' and sort_order = 1),
        (select id from public.ticket_tiers where event_id = 'aa130000-0000-4000-8000-000000000002' and sort_order = 2)
      ]::uuid[]
    )
  $$,
  'P0001',
  'EVENT_NOT_SELLABLE',
  'revoked publication authorization blocks checkout before runtime rows are removed'
);

reset role;
select results_eq(
  $$
    select
      count(*)::bigint,
      count(*) filter (where eligibility_state = 'eligible')::bigint,
      count(*) filter (
        where eligibility_state = 'eligible' and ended_at is null
      )::bigint,
      count(*) filter (
        where eligibility_state = 'ineligible' and ended_at is null
      )::bigint
    from private.event_public_eligibility_intervals
    where event_id = 'aa130000-0000-4000-8000-000000000002'
  $$,
  $$ values (3::bigint, 1::bigint, 0::bigint, 1::bigint) $$,
  'retirement closes the eligible interval and retains the full immutable history'
);

select results_eq(
  $$
    select
      count(*) > 0,
      count(*) filter (where policy_acceptance_id is not null) > 0,
      (select count(*) > 0 from private.event_policy_acceptances where event_id = 'aa130000-0000-4000-8000-000000000002')
    from private.event_moderation_actions
    where event_id = 'aa130000-0000-4000-8000-000000000002'
  $$,
  $$ values (true, true, true) $$,
  'moderation actions and exact policy acceptance remain auditable'
);

select throws_ok(
  $$
    delete from private.event_public_eligibility_intervals
    where event_id = 'aa130000-0000-4000-8000-000000000002'
  $$,
  'P0001',
  'PUBLIC_ELIGIBILITY_INTERVAL_IMMUTABLE',
  'cleanup cannot weaken immutable eligibility history'
);

delete from public.organizer_stripe_accounts
where organizer_id = 'aa130000-0000-4000-8000-000000000001';
delete from public.ticket_tiers
where event_id = 'aa130000-0000-4000-8000-000000000002';
update auth.users
set banned_until = statement_timestamp() + interval '100 years'
where id = 'aa130000-0000-4000-8000-000000000001';

select results_eq(
  $$
    select
      (select count(*) from public.events where id = 'aa130000-0000-4000-8000-000000000002'),
      (select count(*) from public.organizers where id = 'aa130000-0000-4000-8000-000000000001'),
      (select count(*) from auth.users where id = 'aa130000-0000-4000-8000-000000000001' and banned_until > statement_timestamp()),
      (select count(*) from public.ticket_tiers where event_id = 'aa130000-0000-4000-8000-000000000002'),
      (select count(*) from public.organizer_stripe_accounts where organizer_id = 'aa130000-0000-4000-8000-000000000001'),
      (select count(*) from public.orders where event_id = 'aa130000-0000-4000-8000-000000000002'),
      (select count(*) from public.order_items where order_id in (select id from public.orders where event_id = 'aa130000-0000-4000-8000-000000000002')),
      (select count(*) from public.tickets where event_id = 'aa130000-0000-4000-8000-000000000002'),
      (select count(*) from public.refunds where order_id in (select id from public.orders where event_id = 'aa130000-0000-4000-8000-000000000002')),
      (select count(*) from public.get_public_event('aa130000-0000-4000-8000-000000000002')),
      (select count(*) from private.event_public_eligibility_intervals where event_id = 'aa130000-0000-4000-8000-000000000002' and eligibility_state = 'eligible' and ended_at is null)
  $$,
  $$ values (
    1::bigint, 1::bigint, 1::bigint, 0::bigint, 0::bigint, 0::bigint,
    0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint
  ) $$,
  'cleanup leaves only an inert reusable event/organizer/Auth shell and immutable audit history'
);

update auth.users
set banned_until = null
where id = 'aa130000-0000-4000-8000-000000000001';

insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, livemode, transfers_status, payouts_status,
  requirements_status, requirements_currently_due_count,
  requirements_past_due_count, last_synced_at
)
values (
  'aa130000-0000-4000-8000-000000000001',
  'acct_checkoutintegrityfixture', false, 'active', 'active', 'clear', 0, 0,
  statement_timestamp()
);

insert into public.ticket_tiers (
  id, event_id, name, description, unit_amount_minor, currency,
  quantity_total, status, sort_order
)
values
  (
    'aa130000-0000-4000-8000-000000000003',
    'aa130000-0000-4000-8000-000000000002',
    'Task 17 General Admission', null, 1500, 'usd', 10, 'draft', 1
  ),
  (
    'aa130000-0000-4000-8000-000000000004',
    'aa130000-0000-4000-8000-000000000002',
    'Task 17 VIP', null, 2500, 'usd', 10, 'draft', 2
  );

select set_config(
  'request.jwt.claim.sub',
  'aa130000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select lives_ok(
  $$
    select * from public.save_owned_event_requirements(
      'aa130000-0000-4000-8000-000000000002',
      '{"minimum_age":"all_ages","alcohol_present":false,"cannabis_present":false,"explicit_adult_content":false,"gambling_present":false,"weapons_present":false,"high_risk_activity":false}'::jsonb
    )
  $$,
  'the reusable fixture reasserts the canonical low-risk disclosure without a new revision'
);

select lives_ok(
  $$
    select * from public.accept_current_event_policies(
      'aa130000-0000-4000-8000-000000000002'
    )
  $$,
  'the reusable fixture confirms the current development policy pair'
);

select lives_ok(
  $$ select public.publish_event('aa130000-0000-4000-8000-000000000002') $$,
  'the reusable fixture republishes through the authenticated boundary'
);

reset role;
set local role service_role;
select results_eq(
  $$
    select organizer_id, stripe_account_id
    from public.server_get_checkout_preflight(
      'aa130000-0000-4000-8000-000000000002',
      array[
        'aa130000-0000-4000-8000-000000000003'::uuid,
        'aa130000-0000-4000-8000-000000000004'::uuid
      ]
    )
  $$,
  $$ values (
    'aa130000-0000-4000-8000-000000000001'::uuid,
    'acct_checkoutintegrityfixture'::text
  ) $$,
  'a second run proves the same stable fixture is sellable before Stripe work'
);

reset role;
select set_config(
  'request.jwt.claim.sub',
  'aa130000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;
select lives_ok(
  $$
    select public.save_owned_event_revision(
      'aa130000-0000-4000-8000-000000000002',
      (
        select jsonb_build_object(
          'title', events.title,
          'description', events.description,
          'category', events.category,
          'starts_at', statement_timestamp() + interval '60 days',
          'ends_at', statement_timestamp() + interval '60 days 4 hours',
          'timezone', events.timezone,
          'venue_name', events.venue_name,
          'address_line1', events.address_line1,
          'address_line2', events.address_line2,
          'city', events.city,
          'region', events.region,
          'postal_code', events.postal_code,
          'country_code', events.country_code,
          'mapbox_feature_id', events.mapbox_feature_id,
          'latitude', events.latitude,
          'longitude', events.longitude,
          'admission_type', events.admission_type,
          'capacity', events.capacity
        )
        from public.events as events
        where events.id = 'aa130000-0000-4000-8000-000000000002'
      )
    )
  $$,
  'the second run tombstones the same fixture through the authenticated boundary'
);

reset role;
delete from public.organizer_stripe_accounts
where organizer_id = 'aa130000-0000-4000-8000-000000000001';
delete from public.ticket_tiers
where event_id = 'aa130000-0000-4000-8000-000000000002';
update auth.users
set banned_until = statement_timestamp() + interval '100 years'
where id = 'aa130000-0000-4000-8000-000000000001';

select results_eq(
  $$
    select
      (select count(*) from public.events where id = 'aa130000-0000-4000-8000-000000000002'),
      (select count(*) from public.ticket_tiers where event_id = 'aa130000-0000-4000-8000-000000000002'),
      (select count(*) from public.organizer_stripe_accounts where organizer_id = 'aa130000-0000-4000-8000-000000000001'),
      (select count(*) from public.get_public_event('aa130000-0000-4000-8000-000000000002')),
      (select count(*) from private.event_public_eligibility_intervals where event_id = 'aa130000-0000-4000-8000-000000000002' and eligibility_state = 'eligible' and ended_at is null),
      (select count(*) >= 5 from private.event_public_eligibility_intervals where event_id = 'aa130000-0000-4000-8000-000000000002'),
      (select count(*) >= 5 from private.event_moderation_actions where event_id = 'aa130000-0000-4000-8000-000000000002')
  $$,
  $$ values (
    1::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, true, true
  ) $$,
  'a second cleanup restores the same inert shell and extends immutable audit history'
);

select * from finish();
rollback;
