begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

select has_extension(
  'pg_cron',
  'the linked database owns checkout-reservation expiry scheduling'
);

create function pg_temp.checkout_expiry_job_contract()
returns setof jsonb
language plpgsql
set search_path = ''
as $$
begin
  if pg_catalog.to_regclass('cron.job') is null then
    return;
  end if;

  return query execute $query$
    select pg_catalog.jsonb_build_object(
      'jobname', jobs.jobname,
      'schedule', jobs.schedule,
      'command', jobs.command,
      'database', jobs.database,
      'username', jobs.username,
      'active', jobs.active,
      'anon_schema_usage', pg_catalog.has_schema_privilege('anon', 'cron', 'USAGE'),
      'authenticated_schema_usage', pg_catalog.has_schema_privilege('authenticated', 'cron', 'USAGE'),
      'service_schema_usage', pg_catalog.has_schema_privilege('service_role', 'cron', 'USAGE'),
      'anon_job_select', pg_catalog.has_table_privilege('anon', 'cron.job', 'SELECT'),
      'authenticated_job_select', pg_catalog.has_table_privilege('authenticated', 'cron.job', 'SELECT'),
      'service_job_select', pg_catalog.has_table_privilege('service_role', 'cron.job', 'SELECT'),
      'anon_schedule_execute', pg_catalog.has_function_privilege('anon', 'cron.schedule(text,text,text)', 'EXECUTE'),
      'authenticated_schedule_execute', pg_catalog.has_function_privilege('authenticated', 'cron.schedule(text,text,text)', 'EXECUTE'),
      'service_schedule_execute', pg_catalog.has_function_privilege('service_role', 'cron.schedule(text,text,text)', 'EXECUTE')
    )
    from cron.job as jobs
    where jobs.jobname = 'whereto-expire-checkout-reservations'
  $query$;
end;
$$;

select results_eq(
  $$ select * from pg_temp.checkout_expiry_job_contract() $$,
  $$
    values (
      pg_catalog.jsonb_build_object(
        'jobname', 'whereto-expire-checkout-reservations',
        'schedule', '* * * * *',
        'command', 'select public.server_expire_checkout_reservations(clock_timestamp());',
        'database', current_database(),
        'username', current_user,
        'active', true,
        'anon_schema_usage', false,
        'authenticated_schema_usage', false,
        'service_schema_usage', false,
        'anon_job_select', true,
        'authenticated_job_select', true,
        'service_job_select', true,
        'anon_schedule_execute', true,
        'authenticated_schedule_execute', true,
        'service_schedule_execute', true
      )
    )
  $$,
  'one exact database-owned expiry job remains inaccessible to browser and service roles'
);

create temporary table expiry_fixture_clock on commit drop as
select pg_catalog.statement_timestamp() as as_of;
grant select on expiry_fixture_clock to service_role;

insert into auth.users (id, email) values
  ('97000000-0000-4000-8000-000000000001', 'expiry-fixture@example.invalid');
insert into public.organizers (id, display_name) values
  ('97000000-0000-4000-8000-000000000001', 'Expiry Fixture');
insert into public.events (
  id, organizer_id, status, moderation_status, title, description, category,
  starts_at, ends_at, venue_name, address_line1, city, region, postal_code,
  country_code, mapbox_feature_id, latitude, longitude, admission_type
) values (
  '97100000-0000-4000-8000-000000000001',
  '97000000-0000-4000-8000-000000000001',
  'draft', 'clear', 'Expiry Fixture Event',
  'Rollback-only fixture for reservation expiry.', 'community',
  (select as_of + interval '2 days' from expiry_fixture_clock),
  (select as_of + interval '2 days 2 hours' from expiry_fixture_clock),
  'Fixture Hall', '1 Fixture Way', 'San Francisco', 'CA', '94105', 'US',
  'mapbox.expiry-fixture', 37.7936, -122.3958, 'paid'
);
insert into public.ticket_tiers (
  id, event_id, name, unit_amount_minor, currency, quantity_total, status, sort_order
) values
  ('97200000-0000-4000-8000-000000000001', '97100000-0000-4000-8000-000000000001', 'Expiry First', 1000, 'usd', 5, 'active', 1),
  ('97200000-0000-4000-8000-000000000002', '97100000-0000-4000-8000-000000000001', 'Expiry Second', 1000, 'usd', 5, 'active', 2);
insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, transfers_status, payouts_status, requirements_status,
  requirements_currently_due_count, requirements_past_due_count, last_synced_at
) values (
  '97000000-0000-4000-8000-000000000001', 'acct_expiryfixture', 'active', 'active', 'clear',
  0, 0, (select as_of from expiry_fixture_clock)
);
insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present, explicit_adult_content,
  gambling_present, weapons_present, high_risk_activity
) values (
  '97100000-0000-4000-8000-000000000001', 'all_ages', false, false, false, false, false, false
);
select set_config(
  'request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select public.accept_current_event_policies('97100000-0000-4000-8000-000000000001');
select public.publish_event('97100000-0000-4000-8000-000000000001');
reset role;

alter table public.orders disable trigger orders_checkout_snapshot_update;

create function pg_temp.create_expiry_order(
  p_marker text,
  p_status text,
  p_first_quantity integer,
  p_second_quantity integer
)
returns uuid
language plpgsql
as $$
declare
  v_order_id uuid := pg_catalog.gen_random_uuid();
  v_as_of timestamptz;
  v_fee_rule_id uuid;
  v_quantity integer := p_first_quantity + p_second_quantity;
begin
  select as_of into v_as_of from pg_temp.expiry_fixture_clock;
  select fee_rules.id into v_fee_rule_id
  from public.platform_fee_rules as fee_rules
  where not fee_rules.livemode
    and fee_rules.currency = 'usd'
  order by fee_rules.effective_from desc
  limit 1;

  insert into public.orders (
    id, order_number, event_id, organizer_id, livemode, status,
    checkout_expires_at, reservation_expires_at, buyer_name, buyer_email,
    client_request_id, confirmation_token_hash, quantity, currency,
    subtotal_minor, tax_amount_minor, total_minor, platform_product_fee_minor,
    stripe_fee_estimate_minor, application_fee_amount_minor,
    expected_organizer_proceeds_minor, fee_rule_id, platform_percent_bps,
    platform_fixed_minor, processing_fee_treatment,
    processing_estimate_percent_bps, processing_estimate_fixed_minor,
    stripe_destination_account_id, stripe_checkout_integration_identifier,
    stripe_checkout_request_digest, created_at
  ) values (
    v_order_id, 'expiry-' || p_marker,
    '97100000-0000-4000-8000-000000000001',
    '97000000-0000-4000-8000-000000000001', false, p_status,
    v_as_of - interval '20 minutes', v_as_of - interval '10 minutes',
    'Fixture', p_marker || '@example.invalid', pg_catalog.gen_random_uuid(),
    pg_catalog.encode(extensions.digest(p_marker, 'sha256'), 'hex'), v_quantity, 'usd',
    v_quantity * 1000, 0, v_quantity * 1000, 0, 0, 0, v_quantity * 1000,
    v_fee_rule_id, 0, 0, 'platform_fee_only', null, null,
    'acct_expiryfixture', 'whereto_checkout_aaaaaaaa',
    repeat('a', 64), v_as_of - interval '30 minutes'
  );

  update public.orders
  set created_at = v_as_of - interval '30 minutes',
      checkout_expires_at = v_as_of - interval '20 minutes',
      reservation_expires_at = v_as_of - interval '10 minutes'
  where id = v_order_id;

  insert into public.order_items (
    order_id, ticket_tier_id, tier_version, tier_name, unit_amount_minor,
    quantity, subtotal_minor, currency
  )
  select v_order_id, tiers.id, tiers.version, tiers.name, tiers.unit_amount_minor,
    requested.quantity, tiers.unit_amount_minor * requested.quantity, tiers.currency
  from public.ticket_tiers as tiers
  join (values
    ('97200000-0000-4000-8000-000000000001'::uuid, p_first_quantity),
    ('97200000-0000-4000-8000-000000000002'::uuid, p_second_quantity)
  ) as requested(ticket_tier_id, quantity) on requested.ticket_tier_id = tiers.id
  where requested.quantity > 0
  order by tiers.id;

  return v_order_id;
end;
$$;

create temporary table lazy_expiry_order on commit drop as
select pg_temp.create_expiry_order('lazy-expiry', 'creating_checkout', 5, 5) as order_id;

select results_eq(
  $$
    select jsonb_agg(tiers.value ->> 'availability_status' order by tiers.value ->> 'id')
    from public.get_public_event_ticketing('97100000-0000-4000-8000-000000000001') as ticketing,
      lateral jsonb_array_elements(ticketing -> 'tiers') as tiers(value)
  $$,
  $$ values ('["available", "available"]'::jsonb) $$,
  'availability ignores an elapsed reservation before durable cleanup'
);

update private.checkout_runtime_control
set checkout_creation_enabled = true
where singleton;

set local role service_role;
create temporary table lazy_replacement_order on commit drop as
select order_id
from public.server_reserve_checkout(
  '97100000-0000-4000-8000-000000000001',
  '[{"tier_id":"97200000-0000-4000-8000-000000000001","quantity":5},{"tier_id":"97200000-0000-4000-8000-000000000002","quantity":5}]'::jsonb,
  'Fixture', 'replacement@example.invalid',
  '97300000-0000-4000-8000-000000000001', repeat('b', 64)
);
reset role;

select results_eq(
  $$
    select status, expired_at is not null, failure_code
    from public.orders where id = (select order_id from lazy_expiry_order)
  $$,
  $$ values ('expired'::text, true, 'CHECKOUT_EXPIRED'::text) $$,
  'lazy reservation expiry advances the eligible stale order before admitting replacement inventory'
);

update public.orders
set created_at = (select as_of - interval '30 minutes' from expiry_fixture_clock),
  reservation_expires_at = (select as_of - interval '10 minutes' from expiry_fixture_clock)
where id = (select order_id from lazy_replacement_order);

create temporary table explicit_multi_expiry_order on commit drop as
select pg_temp.create_expiry_order('explicit-multi', 'checkout_open', 3, 2) as order_id;

set local role service_role;
select is(
  public.server_expire_checkout_reservations((select as_of from expiry_fixture_clock)),
  2,
  'explicit cleanup advances every eligible stale order exactly once'
);
reset role;

select results_eq(
  $$
    select orders.status, orders.expired_at, orders.failure_code,
      array_agg(items.quantity order by items.ticket_tier_id)
    from public.orders as orders
    join public.order_items as items on items.order_id = orders.id
    where orders.id = (select order_id from explicit_multi_expiry_order)
    group by orders.status, orders.expired_at, orders.failure_code
  $$,
  $$
    select 'expired'::text, as_of, 'CHECKOUT_EXPIRED'::text, array[3, 2]::integer[]
    from expiry_fixture_clock
  $$,
  'multi-tier expiry advances its one order while releasing all held tier quantities together'
);

set local role service_role;
select is(
  public.server_expire_checkout_reservations((select as_of from expiry_fixture_clock)),
  0,
  'repeated explicit cleanup is idempotent'
);
reset role;

create temporary table protected_expiry_orders on commit drop as
select p_status as expected_status,
  pg_temp.create_expiry_order('protected-' || p_status, p_status, 1, 0) as order_id
from unnest(array[
  'payment_processing', 'paid', 'requires_review', 'partially_refunded', 'refunded'
]::text[]) as protected(p_status);

set local role service_role;
select is(
  public.server_expire_checkout_reservations((select as_of from expiry_fixture_clock)),
  0,
  'cleanup cannot advance expired protected payment and review states'
);
reset role;

select results_eq(
  $$
    select protected.expected_status, orders.status, orders.expired_at, orders.failure_code
    from protected_expiry_orders as protected
    join public.orders as orders on orders.id = protected.order_id
    order by protected.expected_status
  $$,
  $$
    values
      ('paid'::text, 'paid'::text, null::timestamptz, null::text),
      ('partially_refunded'::text, 'partially_refunded'::text, null::timestamptz, null::text),
      ('payment_processing'::text, 'payment_processing'::text, null::timestamptz, null::text),
      ('refunded'::text, 'refunded'::text, null::timestamptz, null::text),
      ('requires_review'::text, 'requires_review'::text, null::timestamptz, null::text)
  $$,
  'expired reservations in protected payment and review states remain untouched'
);

alter table public.orders enable trigger orders_checkout_snapshot_update;

select * from finish();
rollback;
