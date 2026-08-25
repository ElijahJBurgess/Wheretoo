begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(23);

select results_eq(
  $$
    select array_agg(relations.relname::text order by relations.relname)
    from pg_catalog.pg_class as relations
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = relations.relnamespace
    where namespaces.nspname = 'public'
      and relations.relname in (
        'organizer_stripe_accounts', 'platform_fee_rules', 'ticket_tiers', 'orders',
        'order_items', 'tickets', 'stripe_webhook_events', 'refunds'
      )
      and relations.relrowsecurity
  $$,
  $$
    values ((array[
      'order_items', 'orders', 'organizer_stripe_accounts', 'platform_fee_rules',
      'refunds', 'stripe_webhook_events', 'ticket_tiers', 'tickets'
    ]::text[]) collate "C")
  $$,
  'all ticketing and financial tables have row-level security enabled'
);

select results_eq(
  $$
    select count(*)::bigint
    from (
      select roles.rolename, tables.tablename, privileges.privilege
      from unnest(array['anon', 'authenticated']) as roles(rolename)
      cross join unnest(array[
        'organizer_stripe_accounts', 'platform_fee_rules', 'ticket_tiers', 'orders',
        'order_items', 'tickets', 'stripe_webhook_events', 'refunds'
      ]) as tables(tablename)
      cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privileges(privilege)
      where pg_catalog.has_table_privilege(
        roles.rolename,
        pg_catalog.format('public.%I', tables.tablename),
        privileges.privilege
      )
    ) as browser_table_privileges
  $$,
  $$ values (0::bigint) $$,
  'anonymous and authenticated browser roles have no ticketing or financial table privileges'
);

select results_eq(
  $$
    select array_agg(procedures.proname::text order by procedures.proname)
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname in (
        'activate_paid_sales', 'get_public_event_ticketing',
        'list_owned_ticket_tiers', 'save_ticket_tiers'
      )
      and procedures.prosecdef
      and procedures.proconfig = array['search_path=""']
  $$,
  $$
    values ((array[
      'activate_paid_sales', 'get_public_event_ticketing',
      'list_owned_ticket_tiers', 'save_ticket_tiers'
    ]::text[]) collate "C")
  $$,
  'all four browser RPCs are security definers with an empty search path'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = procedures.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(procedures.proacl, pg_catalog.acldefault('f', procedures.proowner))
    ) as privileges
    where namespaces.nspname = 'public'
      and procedures.proname in (
        'activate_paid_sales', 'get_public_event_ticketing',
        'list_owned_ticket_tiers', 'save_ticket_tiers'
      )
      and privileges.grantee = 0
      and privileges.privilege_type = 'EXECUTE'
  $$,
  $$ values (0::bigint) $$,
  'PUBLIC has no implicit execution on the four browser RPCs'
);

select results_eq(
  $$ select pg_catalog.has_function_privilege('anon', 'public.list_owned_ticket_tiers(uuid)', 'EXECUTE') $$,
  $$ values (false) $$,
  'anonymous cannot list owned ticket tiers'
);

select results_eq(
  $$ select pg_catalog.has_function_privilege('anon', 'public.save_ticket_tiers(uuid,jsonb)', 'EXECUTE') $$,
  $$ values (false) $$,
  'anonymous cannot save owned ticket tiers'
);

select results_eq(
  $$ select pg_catalog.has_function_privilege('authenticated', 'public.list_owned_ticket_tiers(uuid)', 'EXECUTE') $$,
  $$ values (true) $$,
  'authenticated organizers can execute the owned tier list RPC'
);

select results_eq(
  $$ select pg_catalog.has_function_privilege('authenticated', 'public.save_ticket_tiers(uuid,jsonb)', 'EXECUTE') $$,
  $$ values (true) $$,
  'authenticated organizers can execute the owned tier save RPC'
);

select results_eq(
  $$ select pg_catalog.has_function_privilege('authenticated', 'public.get_public_event_ticketing(uuid)', 'EXECUTE') $$,
  $$ values (true) $$,
  'authenticated consumers can execute the safe public projection RPC'
);

select results_eq(
  $$ select pg_catalog.has_function_privilege('anon', 'public.get_public_event_ticketing(uuid)', 'EXECUTE') $$,
  $$ values (true) $$,
  'anonymous consumers can execute the safe public projection RPC'
);

insert into auth.users (id, email)
values
  ('11000000-0000-0000-0000-000000000001', 'ticket-owner-a@example.invalid'),
  ('11000000-0000-0000-0000-000000000002', 'ticket-owner-b@example.invalid');

insert into public.organizers (id, display_name)
values
  ('11000000-0000-0000-0000-000000000001', 'Ticket Owner A'),
  ('11000000-0000-0000-0000-000000000002', 'Ticket Owner B');

insert into public.events (id, organizer_id, title)
values
  (
    '21000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001',
    'Owned Tier Event A'
  ),
  (
    '21000000-0000-0000-0000-000000000002',
    '11000000-0000-0000-0000-000000000002',
    'Owned Tier Event B'
  );

insert into public.organizer_stripe_accounts (
  organizer_id,
  stripe_account_id,
  transfers_status,
  payouts_status,
  requirements_status,
  last_synced_at
)
values
  (
    '11000000-0000-0000-0000-000000000001',
    'acct_ticketownera',
    'active',
    'active',
    'clear',
    now()
  ),
  (
    '11000000-0000-0000-0000-000000000002',
    'acct_ticketownerb',
    'active',
    'active',
    'clear',
    now()
  );

select set_config('request.jwt.claim.sub', '', true);
set local role anon;

select throws_ok(
  $$ select * from public.list_owned_ticket_tiers('21000000-0000-0000-0000-000000000001') $$,
  '42501',
  'permission denied for function list_owned_ticket_tiers',
  'anonymous execution of the owned tier list is denied'
);

select throws_ok(
  $$
    select *
    from public.save_ticket_tiers(
      '21000000-0000-0000-0000-000000000001',
      '[{"name":"General Admission","unit_amount_minor":2000,"currency":"usd","quantity_total":10,"sort_order":1}]'::jsonb
    )
  $$,
  '42501',
  'permission denied for function save_ticket_tiers',
  'anonymous execution of the owned tier save is denied'
);

reset role;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok(
  $$ select * from public.list_owned_ticket_tiers('21000000-0000-0000-0000-000000000001') $$,
  'P0001',
  'EVENT_NOT_FOUND',
  'Organizer B cannot inspect Organizer A ticket tiers'
);

select throws_ok(
  $$
    select *
    from public.save_ticket_tiers(
      '21000000-0000-0000-0000-000000000001',
      '[{"name":"Compromised","unit_amount_minor":1,"currency":"usd","quantity_total":1,"sort_order":1}]'::jsonb
    )
  $$,
  'P0001',
  'EVENT_NOT_FOUND',
  'Organizer B cannot mutate Organizer A ticket tiers'
);

select throws_ok(
  $$ select stripe_account_id from public.organizer_stripe_accounts $$,
  '42501',
  'permission denied for table organizer_stripe_accounts',
  'an organizer cannot inspect any Connect account identifiers directly'
);

reset role;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$
    select *
    from public.save_ticket_tiers(
      '21000000-0000-0000-0000-000000000001',
      '[
        {"name":"General Admission","description":"Entry to the event","unit_amount_minor":2000,"currency":"usd","quantity_total":10,"sort_order":1},
        {"name":"Supporter","description":null,"unit_amount_minor":3500,"currency":"usd","quantity_total":5,"sort_order":2}
      ]'::jsonb
    )
  $$,
  'Organizer A can save one to three tiers on its event'
);

select results_eq(
  $$
    select name, description, unit_amount_minor, currency, quantity_total, status, sort_order, version
    from public.list_owned_ticket_tiers('21000000-0000-0000-0000-000000000001')
    order by sort_order
  $$,
  $$
    values
      ('General Admission'::text, 'Entry to the event'::text, 2000::bigint, 'usd'::text, 10, 'draft'::text, 1::smallint, 1),
      ('Supporter'::text, null::text, 3500::bigint, 'usd'::text, 5, 'draft'::text, 2::smallint, 1)
  $$,
  'the owned list returns the exact current organizer tier rows'
);

select lives_ok(
  $$
    select *
    from public.save_ticket_tiers(
      '21000000-0000-0000-0000-000000000001',
      jsonb_build_array(
        jsonb_build_object(
          'id', (
            select id
            from public.list_owned_ticket_tiers('21000000-0000-0000-0000-000000000001')
            where sort_order = 1
          ),
          'name', 'General Admission',
          'description', 'Updated entry details',
          'unit_amount_minor', 2200,
          'currency', 'usd',
          'quantity_total', 12,
          'sort_order', 1
        )
      )
    )
  $$,
  'saving a replacement set updates retained tiers and archives omitted tiers'
);

select results_eq(
  $$
    select name, description, unit_amount_minor, quantity_total, status, sort_order, version
    from public.list_owned_ticket_tiers('21000000-0000-0000-0000-000000000001')
  $$,
  $$
    values (
      'General Admission'::text,
      'Updated entry details'::text,
      2200::bigint,
      12,
      'draft'::text,
      1::smallint,
      2
    )
  $$,
  'the owned list excludes archived history and increments material tier versions'
);

select throws_ok(
  $$ select id from public.ticket_tiers $$,
  '42501',
  'permission denied for table ticket_tiers',
  'authenticated organizers cannot bypass owned tier reads with direct table access'
);

select throws_ok(
  $$ update public.ticket_tiers set unit_amount_minor = 1 $$,
  '42501',
  'permission denied for table ticket_tiers',
  'authenticated organizers cannot bypass tier validation with direct table mutation'
);

select throws_ok(
  $$
    select *
    from public.save_ticket_tiers(
      '21000000-0000-0000-0000-000000000001',
      '[
        {"name":"One","unit_amount_minor":100,"currency":"usd","quantity_total":1,"sort_order":1},
        {"name":"Two","unit_amount_minor":200,"currency":"usd","quantity_total":1,"sort_order":2},
        {"name":"Three","unit_amount_minor":300,"currency":"usd","quantity_total":1,"sort_order":3},
        {"name":"Four","unit_amount_minor":400,"currency":"usd","quantity_total":1,"sort_order":4}
      ]'::jsonb
    )
  $$,
  'P0001',
  'TIER_LIMIT_EXCEEDED',
  'the database rejects more than three organizer-defined tiers'
);

reset role;

select results_eq(
  $$
    select name, status
    from public.ticket_tiers
    where event_id = '21000000-0000-0000-0000-000000000001'
    order by sort_order
  $$,
  $$
    values
      ('General Admission'::text, 'draft'::text),
      ('Supporter'::text, 'archived'::text)
  $$,
  'the replacement save retains archived history without exposing it through the owned list'
);

select * from finish();
rollback;
