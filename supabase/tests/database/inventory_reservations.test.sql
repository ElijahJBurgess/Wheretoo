begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(64);

select has_schema('private', 'private service function schema exists');

select results_eq(
  $$
    select (array_agg(pg_catalog.to_regprocedure(signature)::text order by signature)::text[])
      collate "C"
    from unnest(array[
      'private.attach_checkout_session(uuid,text,timestamp with time zone)',
      'private.cancel_checkout_reservation(uuid,text)',
      'private.expire_checkout_reservations(timestamp with time zone)',
      'private.reserve_checkout(uuid,uuid,text,text,uuid,text)'
    ]) as signatures(signature)
  $$,
  $$
    values ((array[
      'private.attach_checkout_session(uuid,text,timestamp with time zone)',
      'private.cancel_checkout_reservation(uuid,text)',
      'private.expire_checkout_reservations(timestamp with time zone)',
      'private.reserve_checkout(uuid,uuid,text,text,uuid,text)'
    ]::text[]) collate "C")
  $$,
  'the four private reservation functions have their exact signatures'
);

select results_eq(
  $$
    select (array_agg(pg_catalog.to_regprocedure(signature)::text order by signature)::text[])
      collate "C"
    from unnest(array[
      'public.server_attach_checkout_session(uuid,text,timestamp with time zone)',
      'public.server_cancel_checkout_reservation(uuid,text)',
      'public.server_expire_checkout_reservations(timestamp with time zone)',
      'public.server_reserve_checkout(uuid,uuid,text,text,uuid,text)'
    ]) as signatures(signature)
  $$,
  $$
    values ((array[
      'server_attach_checkout_session(uuid,text,timestamp with time zone)',
      'server_cancel_checkout_reservation(uuid,text)',
      'server_expire_checkout_reservations(timestamp with time zone)',
      'server_reserve_checkout(uuid,uuid,text,text,uuid,text)'
    ]::text[]) collate "C")
  $$,
  'the four public server wrappers have their exact PostgREST signatures'
);

select results_eq(
  $$
    select (array_agg(procedures.proname::text order by procedures.proname)::text[])
      collate "C"
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'private'
      and procedures.proname in (
        'attach_checkout_session', 'cancel_checkout_reservation',
        'expire_checkout_reservations', 'reserve_checkout'
      )
      and procedures.prosecdef
      and procedures.proconfig = array['search_path=""']
  $$,
  $$
    values ((array[
      'attach_checkout_session', 'cancel_checkout_reservation',
      'expire_checkout_reservations', 'reserve_checkout'
    ]::text[]) collate "C")
  $$,
  'all reservation functions are security definers with an empty search path'
);

select results_eq(
  $$
    select (array_agg(procedures.proname::text order by procedures.proname)::text[])
      collate "C"
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname in (
        'server_attach_checkout_session', 'server_cancel_checkout_reservation',
        'server_expire_checkout_reservations', 'server_reserve_checkout'
      )
      and procedures.prosecdef
      and procedures.proconfig = array['search_path=""']
  $$,
  $$
    values ((array[
      'server_attach_checkout_session', 'server_cancel_checkout_reservation',
      'server_expire_checkout_reservations', 'server_reserve_checkout'
    ]::text[]) collate "C")
  $$,
  'all public server wrappers are security definers with an empty search path'
);

select results_eq(
  $$
    select reserve_owner.rolname = helper_owner.rolname
    from pg_catalog.pg_proc as reserve_function
    join pg_catalog.pg_namespace as reserve_namespace
      on reserve_namespace.oid = reserve_function.pronamespace
    join pg_catalog.pg_roles as reserve_owner on reserve_owner.oid = reserve_function.proowner
    cross join pg_catalog.pg_proc as helper_function
    join pg_catalog.pg_namespace as helper_namespace
      on helper_namespace.oid = helper_function.pronamespace
    join pg_catalog.pg_roles as helper_owner on helper_owner.oid = helper_function.proowner
    where reserve_namespace.nspname = 'private'
      and reserve_function.proname = 'reserve_checkout'
      and helper_namespace.nspname = 'public'
      and helper_function.proname = 'lock_event_ticketing_operation'
  $$,
  $$ values (true) $$,
  'reserve checkout runs as the owner that alone can call the shared lock helper'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = procedures.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(procedures.proacl, pg_catalog.acldefault('f', procedures.proowner))
    ) as privileges
    where namespaces.nspname = 'private'
      and procedures.proname in (
        'attach_checkout_session', 'cancel_checkout_reservation',
        'expire_checkout_reservations', 'reserve_checkout'
      )
      and privileges.grantee = 0
      and privileges.privilege_type = 'EXECUTE'
  $$,
  $$ values (0::bigint) $$,
  'PUBLIC has no implicit execution on reservation functions'
);

select results_eq(
  $$
    select array[
      pg_catalog.has_schema_privilege('anon', 'private', 'USAGE'),
      pg_catalog.has_function_privilege('anon', function_name, 'EXECUTE'),
      pg_catalog.has_schema_privilege('authenticated', 'private', 'USAGE'),
      pg_catalog.has_function_privilege('authenticated', function_name, 'EXECUTE')
    ]
    from unnest(array[
      'private.attach_checkout_session(uuid,text,timestamp with time zone)',
      'private.cancel_checkout_reservation(uuid,text)',
      'private.expire_checkout_reservations(timestamp with time zone)',
      'private.reserve_checkout(uuid,uuid,text,text,uuid,text)'
    ]) as functions(function_name)
    order by function_name
  $$,
  $$ values
    (array[false, false, false, false]),
    (array[false, false, false, false]),
    (array[false, false, false, false]),
    (array[false, false, false, false])
  $$,
  'all four private functions are inaccessible to both browser roles'
);

select results_eq(
  $$
    select array[
      pg_catalog.has_function_privilege('anon', function_name, 'EXECUTE'),
      pg_catalog.has_function_privilege('authenticated', function_name, 'EXECUTE')
    ]
    from unnest(array[
      'public.server_attach_checkout_session(uuid,text,timestamp with time zone)',
      'public.server_cancel_checkout_reservation(uuid,text)',
      'public.server_expire_checkout_reservations(timestamp with time zone)',
      'public.server_reserve_checkout(uuid,uuid,text,text,uuid,text)'
    ]) as functions(function_name)
    order by function_name
  $$,
  $$ values
    (array[false, false]),
    (array[false, false]),
    (array[false, false]),
    (array[false, false])
  $$,
  'all four public server wrappers are inaccessible to both browser roles'
);

select results_eq(
  $$
    select array[
      pg_catalog.has_function_privilege(
        'service_role', 'public.lock_event_ticketing_operation(uuid)', 'EXECUTE'
      ),
      pg_catalog.has_function_privilege(
        'service_role', 'public.activate_paid_sales_locked(uuid,boolean)', 'EXECUTE'
      )
    ]
  $$,
  $$ values (array[false, false]) $$,
  'the service role can reach owner-only ticketing helpers only through security definers'
);

select results_eq(
  $$
    select array[
      pg_catalog.has_schema_privilege('service_role', 'private', 'USAGE'),
      pg_catalog.has_function_privilege('service_role', private_name, 'EXECUTE'),
      pg_catalog.has_function_privilege('service_role', wrapper_name, 'EXECUTE')
    ]
    from (values
      (
        'private.attach_checkout_session(uuid,text,timestamp with time zone)',
        'public.server_attach_checkout_session(uuid,text,timestamp with time zone)'
      ),
      (
        'private.cancel_checkout_reservation(uuid,text)',
        'public.server_cancel_checkout_reservation(uuid,text)'
      ),
      (
        'private.expire_checkout_reservations(timestamp with time zone)',
        'public.server_expire_checkout_reservations(timestamp with time zone)'
      ),
      (
        'private.reserve_checkout(uuid,uuid,text,text,uuid,text)',
        'public.server_reserve_checkout(uuid,uuid,text,text,uuid,text)'
      )
    ) as functions(private_name, wrapper_name)
    order by private_name
  $$,
  $$ values
    (array[false, false, true]),
    (array[false, false, true]),
    (array[false, false, true]),
    (array[false, false, true])
  $$,
  'the service role receives only the four narrow public wrappers'
);

select results_eq(
  $$
    select (array_agg(
      procedures.proname || ':' || grantees.rolname || ':' || privileges.privilege_type
      order by procedures.proname
    )::text[]) collate "C"
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = procedures.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(procedures.proacl, pg_catalog.acldefault('f', procedures.proowner))
    ) as privileges
    join pg_catalog.pg_roles as grantees on grantees.oid = privileges.grantee
    where namespaces.nspname = 'public'
      and procedures.proname in (
        'server_attach_checkout_session', 'server_cancel_checkout_reservation',
        'server_expire_checkout_reservations', 'server_reserve_checkout'
      )
      and privileges.grantee <> procedures.proowner
  $$,
  $$
    values ((array[
      'server_attach_checkout_session:service_role:EXECUTE',
      'server_cancel_checkout_reservation:service_role:EXECUTE',
      'server_expire_checkout_reservations:service_role:EXECUTE',
      'server_reserve_checkout:service_role:EXECUTE'
    ]::text[]) collate "C")
  $$,
  'the wrappers have exactly one non-owner privilege: service-role execution'
);

select results_eq(
  $$
    select (array_agg(parameter_name || ':' || data_type order by ordinal_position)::text[])
      collate "C"
    from information_schema.parameters
    where specific_schema = 'private'
      and specific_name like 'reserve_checkout_%'
      and parameter_mode = 'OUT'
  $$,
  $$
    values ((array[
      'order_id:uuid', 'organizer_id:uuid', 'subtotal_minor:bigint', 'currency:text',
      'application_fee_amount_minor:bigint', 'stripe_account_id:text',
      'checkout_expires_at:timestamp with time zone', 'existing_checkout_session_id:text'
    ]::text[]) collate "C")
  $$,
  'reserve checkout returns only the exact service projection'
);

select results_eq(
  $$
    select (array_agg(parameter_name || ':' || data_type order by ordinal_position)::text[])
      collate "C"
    from information_schema.parameters
    where specific_schema = 'public'
      and specific_name like 'server_reserve_checkout_%'
      and parameter_mode = 'OUT'
  $$,
  $$
    values ((array[
      'order_id:uuid', 'organizer_id:uuid', 'subtotal_minor:bigint', 'currency:text',
      'application_fee_amount_minor:bigint', 'stripe_account_id:text',
      'checkout_expires_at:timestamp with time zone', 'existing_checkout_session_id:text'
    ]::text[]) collate "C")
  $$,
  'server reserve wrapper returns only the exact service projection'
);

select ok(
  pg_catalog.obj_description(
    'public.server_reserve_checkout(uuid,uuid,text,text,uuid,text)'::regprocedure,
    'pg_proc'
  ) like '%SHA-256 bytes of p_client_request_id::text%'
  and pg_catalog.obj_description(
    'public.server_reserve_checkout(uuid,uuid,text,text,uuid,text)'::regprocedure,
    'pg_proc'
  ) like '%SHA-256 of those bytes%',
  'the server wrapper documents deterministic stateless confirmation-token derivation'
);

select results_eq(
  $$
    select indexdef
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'orders'
      and indexname = 'orders_checkout_reservation_expiry_idx'
  $$,
  $$
    values (
      'CREATE INDEX orders_checkout_reservation_expiry_idx ON public.orders USING btree (reservation_expires_at) WHERE (status = ANY (ARRAY[''creating_checkout''::text, ''checkout_open''::text]))'::text
    )
  $$,
  'unfinished Checkout expiry has an exact matching partial index'
);

create or replace function pg_temp.checkout_reservation_row_count(
  p_event_id uuid,
  p_tier_id uuid,
  p_name text,
  p_email text,
  p_client_request_id uuid,
  p_confirmation_token_hash text
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_count bigint;
begin
  select count(*) into v_count
  from public.server_reserve_checkout(
    p_event_id,
    p_tier_id,
    p_name,
    p_email,
    p_client_request_id,
    p_confirmation_token_hash
  );
  return v_count;
exception
  when others then
    return -1;
end;
$$;

insert into auth.users (id, email)
values ('15000000-0000-0000-0000-000000000001', 'inventory-owner@example.invalid');

insert into public.organizers (id, display_name)
values ('15000000-0000-0000-0000-000000000001', 'Inventory Owner');

insert into public.events (
  id, organizer_id, status, moderation_status, title, description, category,
  starts_at, ends_at, venue_name, address_line1, city, region, postal_code,
  country_code, mapbox_feature_id, latitude, longitude, admission_type, published_at
)
values
  (
    '25000000-0000-0000-0000-000000000001',
    '15000000-0000-0000-0000-000000000001',
    'published', 'clear', 'Reservation Event',
    'A published paid event used to verify atomic checkout reservation behavior.',
    'community', now() + interval '2 days', now() + interval '2 days 2 hours',
    'Reservation Venue', '1 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.inventory-reservation', 37.7936, -122.3958, 'paid', now()
  ),
  (
    '25000000-0000-0000-0000-000000000002',
    '15000000-0000-0000-0000-000000000001',
    'published', 'clear', 'Other Reservation Event',
    'A second paid event used to reject a mismatched ticket tier relationship.',
    'community', now() + interval '3 days', now() + interval '3 days 2 hours',
    'Other Venue', '2 Market Street', 'San Francisco', 'CA', '94105', 'US',
    'mapbox.other-inventory-reservation', 37.7936, -122.3958, 'paid', now()
  );

insert into public.ticket_tiers (
  id, event_id, name, description, unit_amount_minor, currency,
  quantity_total, status, sort_order, version
)
values
  (
    '35000000-0000-4000-8000-000000000001',
    '25000000-0000-0000-0000-000000000001',
    'General Admission', 'One general admission ticket', 2000, 'usd', 10, 'active', 1, 3
  ),
  (
    '35000000-0000-4000-8000-000000000002',
    '25000000-0000-0000-0000-000000000001',
    'Final Ticket', null, 3000, 'usd', 1, 'active', 2, 1
  ),
  (
    '35000000-0000-4000-8000-000000000003',
    '25000000-0000-0000-0000-000000000002',
    'Other Event Tier', null, 2500, 'usd', 5, 'active', 1, 1
  );

insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, transfers_status, payouts_status,
  requirements_status, requirements_currently_due_count,
  requirements_past_due_count, last_synced_at
)
values (
  '15000000-0000-0000-0000-000000000001', 'acct_inventoryreservation',
  'active', 'active', 'clear', 0, 0, now()
);

set local role service_role;
create temporary table first_reservation on commit drop as
select *
from public.server_reserve_checkout(
  '25000000-0000-0000-0000-000000000001',
  '35000000-0000-4000-8000-000000000001',
  '  Ada Lovelace  ',
  '  ADA@Example.COM  ',
  '45000000-0000-4000-8000-000000000001',
  encode(
    digest(
      digest('45000000-0000-4000-8000-000000000001', 'sha256'),
      'sha256'
    ),
    'hex'
  )
);
reset role;

select results_eq(
  $$
    select organizer_id, subtotal_minor, currency, application_fee_amount_minor,
      stripe_account_id, existing_checkout_session_id
    from first_reservation
  $$,
  $$
    values (
      '15000000-0000-0000-0000-000000000001'::uuid,
      2000::bigint, 'usd'::text, 150::bigint,
      'acct_inventoryreservation'::text, null::text
    )
  $$,
  'reservation derives organizer, price, currency, exact 500 bps plus 50 fee, and destination'
);

select ok(
  (select checkout_expires_at between statement_timestamp() + interval '29 minutes'
    and statement_timestamp() + interval '31 minutes' from first_reservation),
  'reservation returns the server-defined thirty-minute Checkout expiry'
);

select results_eq(
  $$
    select buyer_name, buyer_email, confirmation_token_hash, quantity,
      subtotal_minor, platform_product_fee_minor, application_fee_amount_minor,
      expected_organizer_proceeds_minor, status
    from public.orders
    where id = (select order_id from first_reservation)
  $$,
  $$
    values (
      'Ada Lovelace'::text, 'ada@example.com'::text,
      'b321dfdbf92ca891ecb298f843a7da3ec9d03895d44689ea4b20912e2f7a870d'::text,
      1, 2000::bigint, 150::bigint, 150::bigint, 1850::bigint,
      'creating_checkout'::text
    )
  $$,
  'reservation normalizes guest data, stores only the token hash, fixes quantity at one, and snapshots fees'
);

select is(
  (
    select confirmation_token_hash
    from public.orders
    where id = (select order_id from first_reservation)
  ),
  encode(
    digest(
      digest('45000000-0000-4000-8000-000000000001', 'sha256'),
      'sha256'
    ),
    'hex'
  ),
  'the same request UUID deterministically reproduces its confirmation token hash without state'
);

select results_eq(
  $$
    select tier_version, tier_name, tier_description, unit_amount_minor,
      quantity, subtotal_minor, currency
    from public.order_items
    where order_id = (select order_id from first_reservation)
  $$,
  $$
    values (
      3, 'General Admission'::text, 'One general admission ticket'::text,
      2000::bigint, 1, 2000::bigint, 'usd'::text
    )
  $$,
  'the order item snapshots the selected persisted tier at quantity one'
);

select is(
  (
    select count(*)
    from public.orders
    where buyer_name like '%clear-confirmation-token%'
      or buyer_email like '%clear-confirmation-token%'
      or confirmation_token_hash like '%clear-confirmation-token%'
  ),
  0::bigint,
  'no clear confirmation token is stored in PostgreSQL'
);

create temporary table retried_reservation on commit drop as
select *
from public.server_reserve_checkout(
  '25000000-0000-0000-0000-000000000001',
  '35000000-0000-4000-8000-000000000001',
  'Ada Lovelace',
  'ada@example.com',
  '45000000-0000-4000-8000-000000000001',
  encode(
    digest(
      digest('45000000-0000-4000-8000-000000000001', 'sha256'),
      'sha256'
    ),
    'hex'
  )
);

select results_eq(
  $$ select order_id, application_fee_amount_minor from retried_reservation $$,
  $$ select order_id, application_fee_amount_minor from first_reservation $$,
  'retrying the same client request returns the same order and fee snapshot'
);

select throws_ok(
  $$
    select * from public.server_reserve_checkout(
      '25000000-0000-0000-0000-000000000001',
      '35000000-0000-4000-8000-000000000001',
      'Ada Lovelace', 'ada@example.com',
      '45000000-0000-4000-8000-000000000001',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )
  $$,
  'P0001', 'CHECKOUT_ALREADY_EXISTS',
  'a malicious same-request retry with a mismatched token hash is rejected'
);

select results_eq(
  $$
    select
      (
        select count(*)::bigint
        from public.orders
        where client_request_id = '45000000-0000-4000-8000-000000000001'
      ),
      (
        select count(*)::bigint
        from public.order_items
        where order_id = (select order_id from first_reservation)
      )
  $$,
  $$ values (1::bigint, 1::bigint) $$,
  'a request retry creates exactly one order and one order item'
);

select results_eq(
  $$
    select platform_product_fee_minor, application_fee_amount_minor
    from public.orders
    where id = (select order_id from first_reservation)
  $$,
  $$ values (150::bigint, 150::bigint) $$,
  'the fixed fifty-cent fee is not added again on retry'
);

update public.events
set moderation_status = 'blocked'
where id = '25000000-0000-0000-0000-000000000001';

select throws_ok(
  $$
    select * from public.server_reserve_checkout(
      '25000000-0000-0000-0000-000000000001',
      '35000000-0000-4000-8000-000000000001',
      'Blocked Buyer', 'blocked@example.com',
      '45000000-0000-4000-8000-000000000002',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    )
  $$,
  'P0001', 'EVENT_NOT_SELLABLE',
  'checkout revalidates current public event and moderation state'
);

update public.events
set moderation_status = 'clear'
where id = '25000000-0000-0000-0000-000000000001';

select throws_ok(
  $$
    select * from public.server_reserve_checkout(
      '25000000-0000-0000-0000-000000000001',
      '35000000-0000-4000-8000-000000000003',
      'Wrong Tier', 'wrong-tier@example.com',
      '45000000-0000-4000-8000-000000000003',
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    )
  $$,
  'P0001', 'TIER_NOT_FOUND',
  'checkout rejects a tier that does not belong to the event'
);

update public.ticket_tiers
set status = 'archived'
where id = '35000000-0000-4000-8000-000000000001';

select throws_ok(
  $$
    select * from public.server_reserve_checkout(
      '25000000-0000-0000-0000-000000000001',
      '35000000-0000-4000-8000-000000000001',
      'Archived Tier', 'archived@example.com',
      '45000000-0000-4000-8000-000000000004',
      'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    )
  $$,
  'P0001', 'TIER_NOT_ACTIVE',
  'checkout revalidates that the selected tier remains active'
);

update public.ticket_tiers
set status = 'active'
where id = '35000000-0000-4000-8000-000000000001';

update public.organizer_stripe_accounts
set last_synced_at = now() - interval '6 minutes'
where organizer_id = '15000000-0000-0000-0000-000000000001';

select throws_ok(
  $$
    select * from public.server_reserve_checkout(
      '25000000-0000-0000-0000-000000000001',
      '35000000-0000-4000-8000-000000000001',
      'Stale Connect', 'stale-connect@example.com',
      '45000000-0000-4000-8000-000000000005',
      'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    )
  $$,
  'P0001', 'CONNECT_NOT_READY',
  'checkout blocks a stale Connect capability projection'
);

update public.organizer_stripe_accounts
set last_synced_at = now(), requirements_status = 'action_required',
  requirements_currently_due_count = 1
where organizer_id = '15000000-0000-0000-0000-000000000001';

select throws_ok(
  $$
    select * from public.server_reserve_checkout(
      '25000000-0000-0000-0000-000000000001',
      '35000000-0000-4000-8000-000000000001',
      'Connect Due', 'connect-due@example.com',
      '45000000-0000-4000-8000-000000000006',
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    )
  $$,
  'P0001', 'CONNECT_ACTION_REQUIRED',
  'checkout blocks currently due Connect requirements'
);

update public.organizer_stripe_accounts
set requirements_status = 'clear', requirements_currently_due_count = 0
where organizer_id = '15000000-0000-0000-0000-000000000001';

update public.platform_fee_rules
set effective_until = now() - interval '1 second'
where id = '00000000-0000-0000-0000-000000000500';

select throws_ok(
  $$
    select * from public.server_reserve_checkout(
      '25000000-0000-0000-0000-000000000001',
      '35000000-0000-4000-8000-000000000001',
      'No Fee', 'no-fee@example.com',
      '45000000-0000-4000-8000-000000000007',
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    )
  $$,
  'P0001', 'FEE_RULE_NOT_CONFIGURED',
  'checkout requires a current server-side fee rule'
);

update public.platform_fee_rules
set effective_until = null
where id = '00000000-0000-0000-0000-000000000500';

select throws_ok(
  $$
    select * from public.server_reserve_checkout(
      '25000000-0000-0000-0000-000000000001',
      '35000000-0000-4000-8000-000000000001',
      ' ', 'valid@example.com',
      '45000000-0000-4000-8000-000000000008',
      '1123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    )
  $$,
  'P0001', 'CHECKOUT_INPUT_INVALID',
  'checkout rejects an empty normalized buyer name'
);

select throws_ok(
  $$
    select * from public.server_reserve_checkout(
      '25000000-0000-0000-0000-000000000001',
      '35000000-0000-4000-8000-000000000001',
      'Valid Buyer', 'not-an-email',
      '45000000-0000-4000-8000-000000000009',
      '2123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    )
  $$,
  'P0001', 'CHECKOUT_INPUT_INVALID',
  'checkout rejects an invalid normalized email'
);

select throws_ok(
  $$
    select * from public.server_reserve_checkout(
      '25000000-0000-0000-0000-000000000001',
      '35000000-0000-4000-8000-000000000001',
      'Valid Buyer', 'valid@example.com',
      '45000000-0000-4000-8000-000000000010', 'clear-confirmation-token'
    )
  $$,
  'P0001', 'CHECKOUT_INPUT_INVALID',
  'checkout accepts only a SHA-256 confirmation token hash'
);

create temporary table stale_final_reservation on commit drop as
select *
from public.server_reserve_checkout(
  '25000000-0000-0000-0000-000000000001',
  '35000000-0000-4000-8000-000000000002',
  'Stale Final Buyer', 'stale-final@example.com',
  '45000000-0000-4000-8000-000000000011',
  '3123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
);

create temporary table stale_tier_reservation on commit drop as
select *
from public.server_reserve_checkout(
  '25000000-0000-0000-0000-000000000001',
  '35000000-0000-4000-8000-000000000001',
  'Stale Tier Buyer', 'stale-tier@example.com',
  '45000000-0000-4000-8000-000000000018',
  'a123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
);

create temporary table stale_connect_reservation on commit drop as
select *
from public.server_reserve_checkout(
  '25000000-0000-0000-0000-000000000001',
  '35000000-0000-4000-8000-000000000001',
  'Stale Connect Retry', 'stale-connect-retry@example.com',
  '45000000-0000-4000-8000-000000000019',
  'b123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
);

create temporary table restricted_connect_reservation on commit drop as
select *
from public.server_reserve_checkout(
  '25000000-0000-0000-0000-000000000001',
  '35000000-0000-4000-8000-000000000001',
  'Restricted Connect Retry', 'restricted-connect-retry@example.com',
  '45000000-0000-4000-8000-000000000020',
  'c123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
);

create temporary table stale_fee_reservation on commit drop as
select *
from public.server_reserve_checkout(
  '25000000-0000-0000-0000-000000000001',
  '35000000-0000-4000-8000-000000000001',
  'Stale Fee Retry', 'stale-fee-retry@example.com',
  '45000000-0000-4000-8000-000000000021',
  'd123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
);

update public.orders
set created_at = now() - interval '2 hours',
  checkout_expires_at = now() - interval '1 hour',
  reservation_expires_at = now() - interval '30 minutes'
where id in (
  select order_id from stale_final_reservation
  union all select order_id from stale_tier_reservation
  union all select order_id from stale_connect_reservation
  union all select order_id from restricted_connect_reservation
  union all select order_id from stale_fee_reservation
);

update public.events
set starts_at = now() - interval '1 hour'
where id = '25000000-0000-0000-0000-000000000001';

select is(
  pg_temp.checkout_reservation_row_count(
    '25000000-0000-0000-0000-000000000001',
    '35000000-0000-4000-8000-000000000002',
    'Stale Final Buyer', 'stale-final@example.com',
    '45000000-0000-4000-8000-000000000011',
    '3123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  ),
  0::bigint,
  'a stale same-request retry bypasses an event that has already started'
);

select results_eq(
  $$
    select status, expired_at is not null, failure_code
    from public.orders
    where id = (select order_id from stale_final_reservation)
  $$,
  $$ values ('expired'::text, true, 'CHECKOUT_EXPIRED'::text) $$,
  'the invalid-event retry atomically persists the reservation expiry'
);

select is(
  pg_temp.checkout_reservation_row_count(
    '25000000-0000-0000-0000-000000000001',
    '35000000-0000-4000-8000-000000000002',
    'Stale Final Buyer', 'stale-final@example.com',
    '45000000-0000-4000-8000-000000000011',
    '3123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  ),
  0::bigint,
  'an expired same-request retry bypasses the invalid event state'
);

update public.events
set starts_at = now() + interval '2 days',
  ends_at = now() + interval '2 days 2 hours'
where id = '25000000-0000-0000-0000-000000000001';

update public.ticket_tiers
set status = 'archived'
where id = '35000000-0000-4000-8000-000000000001';

select is(
  pg_temp.checkout_reservation_row_count(
    '25000000-0000-0000-0000-000000000001',
    '35000000-0000-4000-8000-000000000001',
    'Stale Tier Buyer', 'stale-tier@example.com',
    '45000000-0000-4000-8000-000000000018',
    'a123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  ),
  0::bigint,
  'a stale same-request retry bypasses an archived selected tier'
);

select results_eq(
  $$
    select status, expired_at is not null, failure_code
    from public.orders
    where id = (select order_id from stale_tier_reservation)
  $$,
  $$ values ('expired'::text, true, 'CHECKOUT_EXPIRED'::text) $$,
  'the archived-tier retry atomically persists the reservation expiry'
);

select is(
  pg_temp.checkout_reservation_row_count(
    '25000000-0000-0000-0000-000000000001',
    '35000000-0000-4000-8000-000000000001',
    'Stale Tier Buyer', 'stale-tier@example.com',
    '45000000-0000-4000-8000-000000000018',
    'a123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  ),
  0::bigint,
  'an expired same-request retry bypasses the archived tier state'
);

update public.ticket_tiers
set status = 'active'
where id = '35000000-0000-4000-8000-000000000001';

update public.organizer_stripe_accounts
set last_synced_at = now() - interval '6 minutes'
where organizer_id = '15000000-0000-0000-0000-000000000001';

select is(
  pg_temp.checkout_reservation_row_count(
    '25000000-0000-0000-0000-000000000001',
    '35000000-0000-4000-8000-000000000001',
    'Stale Connect Retry', 'stale-connect-retry@example.com',
    '45000000-0000-4000-8000-000000000019',
    'b123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  ),
  0::bigint,
  'a stale same-request retry bypasses a stale Connect projection'
);

select results_eq(
  $$
    select status, expired_at is not null, failure_code
    from public.orders
    where id = (select order_id from stale_connect_reservation)
  $$,
  $$ values ('expired'::text, true, 'CHECKOUT_EXPIRED'::text) $$,
  'the stale-Connect retry atomically persists the reservation expiry'
);

select is(
  pg_temp.checkout_reservation_row_count(
    '25000000-0000-0000-0000-000000000001',
    '35000000-0000-4000-8000-000000000001',
    'Stale Connect Retry', 'stale-connect-retry@example.com',
    '45000000-0000-4000-8000-000000000019',
    'b123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  ),
  0::bigint,
  'an expired same-request retry bypasses stale Connect state'
);

update public.organizer_stripe_accounts
set last_synced_at = now(), transfers_status = 'restricted'
where organizer_id = '15000000-0000-0000-0000-000000000001';

select is(
  pg_temp.checkout_reservation_row_count(
    '25000000-0000-0000-0000-000000000001',
    '35000000-0000-4000-8000-000000000001',
    'Restricted Connect Retry', 'restricted-connect-retry@example.com',
    '45000000-0000-4000-8000-000000000020',
    'c123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  ),
  0::bigint,
  'a stale same-request retry bypasses restricted Connect capabilities'
);

select results_eq(
  $$
    select status, expired_at is not null, failure_code
    from public.orders
    where id = (select order_id from restricted_connect_reservation)
  $$,
  $$ values ('expired'::text, true, 'CHECKOUT_EXPIRED'::text) $$,
  'the restricted-Connect retry atomically persists the reservation expiry'
);

select is(
  pg_temp.checkout_reservation_row_count(
    '25000000-0000-0000-0000-000000000001',
    '35000000-0000-4000-8000-000000000001',
    'Restricted Connect Retry', 'restricted-connect-retry@example.com',
    '45000000-0000-4000-8000-000000000020',
    'c123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  ),
  0::bigint,
  'an expired same-request retry bypasses restricted Connect state'
);

update public.organizer_stripe_accounts
set transfers_status = 'active'
where organizer_id = '15000000-0000-0000-0000-000000000001';

update public.platform_fee_rules
set effective_until = now() - interval '1 second'
where id = '00000000-0000-0000-0000-000000000500';

select is(
  pg_temp.checkout_reservation_row_count(
    '25000000-0000-0000-0000-000000000001',
    '35000000-0000-4000-8000-000000000001',
    'Stale Fee Retry', 'stale-fee-retry@example.com',
    '45000000-0000-4000-8000-000000000021',
    'd123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  ),
  0::bigint,
  'a stale same-request retry bypasses a changed fee window'
);

select results_eq(
  $$
    select status, expired_at is not null, failure_code
    from public.orders
    where id = (select order_id from stale_fee_reservation)
  $$,
  $$ values ('expired'::text, true, 'CHECKOUT_EXPIRED'::text) $$,
  'the changed-fee retry atomically persists the reservation expiry'
);

select is(
  pg_temp.checkout_reservation_row_count(
    '25000000-0000-0000-0000-000000000001',
    '35000000-0000-4000-8000-000000000001',
    'Stale Fee Retry', 'stale-fee-retry@example.com',
    '45000000-0000-4000-8000-000000000021',
    'd123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  ),
  0::bigint,
  'an expired same-request retry bypasses changed fee configuration'
);

update public.platform_fee_rules
set effective_until = null
where id = '00000000-0000-0000-0000-000000000500';

create temporary table replacement_final_reservation on commit drop as
select *
from public.server_reserve_checkout(
  '25000000-0000-0000-0000-000000000001',
  '35000000-0000-4000-8000-000000000002',
  'Replacement Final Buyer', 'replacement-final@example.com',
  '45000000-0000-4000-8000-000000000012',
  '4123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
);

select isnt(
  (select order_id from stale_final_reservation),
  (select order_id from replacement_final_reservation),
  'an expired reservation releases the final inventory unit to a new request'
);

update public.orders
set status = 'payment_processing'
where id = (select order_id from replacement_final_reservation);

select throws_ok(
  $$
    select * from public.server_reserve_checkout(
      '25000000-0000-0000-0000-000000000001',
      '35000000-0000-4000-8000-000000000002',
      'Sold Out Buyer', 'sold-out@example.com',
      '45000000-0000-4000-8000-000000000013',
      '5123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    )
  $$,
  'P0001', 'TIER_SOLD_OUT',
  'payment-processing quantity keeps the capacity-one tier sold out after reservation expiry'
);

update public.orders
set status = 'paid', paid_at = now()
where id = (select order_id from replacement_final_reservation);

select throws_ok(
  $$
    select * from public.server_reserve_checkout(
      '25000000-0000-0000-0000-000000000001',
      '35000000-0000-4000-8000-000000000002',
      'Paid Sold Out Buyer', 'paid-sold-out@example.com',
      '45000000-0000-4000-8000-000000000022',
      'e123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    )
  $$,
  'P0001', 'TIER_SOLD_OUT',
  'paid quantity independently keeps the capacity-one tier sold out'
);

select results_eq(
  $$
    select sum(items.quantity)::bigint
    from public.order_items as items
    join public.orders as orders on orders.id = items.order_id
    where items.ticket_tier_id = '35000000-0000-4000-8000-000000000002'
      and (
        orders.status in ('paid', 'payment_processing')
        or (
          orders.status in ('creating_checkout', 'checkout_open')
          and orders.reservation_expires_at > now()
        )
      )
  $$,
  $$ values (1::bigint) $$,
  'exactly one final-tier inventory unit remains committed'
);

create temporary table attached_reservation on commit drop as
select *
from public.server_reserve_checkout(
  '25000000-0000-0000-0000-000000000001',
  '35000000-0000-4000-8000-000000000001',
  'Attached Buyer', 'attached@example.com',
  '45000000-0000-4000-8000-000000000014',
  '6123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
);

select public.server_attach_checkout_session(
  (select order_id from attached_reservation),
  'cs_test_inventoryattachment',
  statement_timestamp() + interval '30 minutes'
);

select results_eq(
  $$
    select id, status, stripe_checkout_session_id,
      reservation_expires_at >= checkout_expires_at + interval '5 minutes'
    from public.orders
    where id = (select order_id from attached_reservation)
  $$,
  $$
    select order_id, 'checkout_open'::text, 'cs_test_inventoryattachment'::text, true
    from attached_reservation
  $$,
  'Checkout attachment advances creating to open once and preserves expiry grace'
);

select results_eq(
  $$
    select public.server_attach_checkout_session(
      (select order_id from attached_reservation),
      'cs_test_inventoryattachment',
      checkout_expires_at
    ), stripe_checkout_session_id
    from public.orders
    where id = (select order_id from attached_reservation)
  $$,
  $$
    select order_id, 'cs_test_inventoryattachment'::text
    from attached_reservation
  $$,
  'reattaching the identical Checkout Session is idempotent'
);

select throws_ok(
  $$
    select public.server_attach_checkout_session(
      (select order_id from attached_reservation),
      'cs_test_differentattachment',
      statement_timestamp() + interval '30 minutes'
    )
  $$,
  'P0001', 'CHECKOUT_ALREADY_EXISTS',
  'a second distinct Checkout Session cannot attach to one order'
);

create temporary table cancelled_reservation on commit drop as
select *
from public.server_reserve_checkout(
  '25000000-0000-0000-0000-000000000001',
  '35000000-0000-4000-8000-000000000001',
  'Cancelled Buyer', 'cancelled@example.com',
  '45000000-0000-4000-8000-000000000015',
  '7123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
);

select public.server_cancel_checkout_reservation(
  (select order_id from cancelled_reservation), 'CHECKOUT_CREATION_FAILED'
);

select results_eq(
  $$
    select id, status, failure_code, failed_at is not null
    from public.orders
    where id = (select order_id from cancelled_reservation)
  $$,
  $$
    select order_id, 'cancelled'::text, 'CHECKOUT_CREATION_FAILED'::text, true
    from cancelled_reservation
  $$,
  'explicit cancellation releases an unfinished reservation with its stable reason'
);

select results_eq(
  $$
    select public.server_cancel_checkout_reservation(
      (select order_id from cancelled_reservation), 'DIFFERENT_REASON'
    ), status, failure_code
    from public.orders
    where id = (select order_id from cancelled_reservation)
  $$,
  $$
    select order_id, 'cancelled'::text, 'CHECKOUT_CREATION_FAILED'::text
    from cancelled_reservation
  $$,
  'repeated cancellation is idempotent and does not rewrite terminal history'
);

update public.orders
set status = 'paid', paid_at = now(), failed_at = null, failure_code = null
where id = (select order_id from cancelled_reservation);

select results_eq(
  $$
    select public.server_cancel_checkout_reservation(
      (select order_id from cancelled_reservation), 'MUST_NOT_DOWNGRADE_PAID'
    ), status
    from public.orders
    where id = (select order_id from cancelled_reservation)
  $$,
  $$ select order_id, 'paid'::text from cancelled_reservation $$,
  'cancellation cannot downgrade a paid order'
);

create temporary table expiring_reservation on commit drop as
select *
from public.server_reserve_checkout(
  '25000000-0000-0000-0000-000000000001',
  '35000000-0000-4000-8000-000000000001',
  'Expiring Buyer', 'expiring@example.com',
  '45000000-0000-4000-8000-000000000016',
  '8123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
);

update public.orders
set created_at = now() - interval '2 hours',
  checkout_expires_at = now() - interval '1 hour',
  reservation_expires_at = now() - interval '30 minutes'
where id = (select order_id from expiring_reservation);

select is(
  public.server_expire_checkout_reservations(statement_timestamp()),
  1,
  'scheduled expiry advances exactly the stale unfinished reservation'
);

select results_eq(
  $$
    select status, expired_at is not null, failure_code
    from public.orders where id = (select order_id from expiring_reservation)
  $$,
  $$ values ('expired'::text, true, 'CHECKOUT_EXPIRED'::text) $$,
  'scheduled expiry records one monotonic expired state'
);

select is(
  public.server_expire_checkout_reservations(statement_timestamp()),
  0,
  'repeated scheduled expiry is idempotent'
);

create temporary table processing_reservation on commit drop as
select *
from public.server_reserve_checkout(
  '25000000-0000-0000-0000-000000000001',
  '35000000-0000-4000-8000-000000000001',
  'Processing Buyer', 'processing@example.com',
  '45000000-0000-4000-8000-000000000017',
  '9123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
);

update public.orders
set status = 'payment_processing', created_at = now() - interval '2 hours',
  checkout_expires_at = now() - interval '1 hour',
  reservation_expires_at = now() - interval '30 minutes'
where id = (select order_id from processing_reservation);

select results_eq(
  $$
    select public.server_expire_checkout_reservations(statement_timestamp()), status
    from public.orders where id = (select order_id from processing_reservation)
  $$,
  $$ values (0, 'payment_processing'::text) $$,
  'expiry cannot release payment-processing inventory'
);

select * from finish();
rollback;
