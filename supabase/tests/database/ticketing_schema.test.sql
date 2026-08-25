begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(61);

select has_table('public', 'organizer_stripe_accounts', 'organizer Stripe accounts table exists');
select has_table('public', 'platform_fee_rules', 'platform fee rules table exists');
select has_table('public', 'ticket_tiers', 'ticket tiers table exists');
select has_table('public', 'orders', 'orders table exists');
select has_table('public', 'order_items', 'order items table exists');
select has_table('public', 'tickets', 'tickets table exists');
select has_table('public', 'stripe_webhook_events', 'Stripe webhook events table exists');
select has_table('public', 'refunds', 'refunds table exists');

select columns_are(
  'public',
  'organizer_stripe_accounts',
  array[
    'organizer_id', 'livemode', 'stripe_account_id', 'dashboard', 'fees_collector',
    'losses_collector', 'country_code', 'currency', 'transfers_status', 'payouts_status',
    'requirements_status', 'requirements_currently_due_count', 'requirements_past_due_count',
    'last_status_code', 'last_synced_at', 'created_at', 'updated_at'
  ],
  'organizer Stripe account columns are exact'
);

select columns_are(
  'public',
  'platform_fee_rules',
  array[
    'id', 'livemode', 'currency', 'platform_percent_bps', 'platform_fixed_minor',
    'processing_fee_treatment', 'processing_estimate_percent_bps',
    'processing_estimate_fixed_minor', 'effective_from', 'effective_until', 'created_at'
  ],
  'platform fee rule columns are exact'
);

select columns_are(
  'public',
  'ticket_tiers',
  array[
    'id', 'event_id', 'name', 'description', 'unit_amount_minor', 'currency',
    'quantity_total', 'status', 'sort_order', 'version', 'created_at', 'updated_at'
  ],
  'ticket tier columns are exact'
);

select columns_are(
  'public',
  'orders',
  array[
    'id', 'order_number', 'event_id', 'organizer_id', 'livemode', 'status',
    'checkout_expires_at', 'reservation_expires_at', 'paid_at', 'failed_at', 'expired_at',
    'refunded_at', 'buyer_name', 'buyer_email', 'client_request_id',
    'confirmation_token_hash', 'quantity', 'currency', 'subtotal_minor', 'tax_amount_minor',
    'total_minor', 'platform_product_fee_minor', 'stripe_fee_estimate_minor',
    'application_fee_amount_minor', 'expected_organizer_proceeds_minor',
    'actual_stripe_fee_minor', 'actual_organizer_proceeds_minor', 'fee_rule_id',
    'platform_percent_bps', 'platform_fixed_minor', 'processing_fee_treatment',
    'processing_estimate_percent_bps', 'processing_estimate_fixed_minor',
    'stripe_checkout_session_id', 'stripe_payment_intent_id', 'stripe_charge_id',
    'stripe_transfer_id', 'stripe_application_fee_id', 'stripe_balance_transaction_id',
    'stripe_customer_id', 'last_stripe_event_id', 'reconciliation_status', 'failure_code',
    'created_at', 'updated_at'
  ],
  'order columns are exact'
);

select columns_are(
  'public',
  'order_items',
  array[
    'id', 'order_id', 'ticket_tier_id', 'tier_version', 'tier_name',
    'tier_description', 'unit_amount_minor', 'quantity', 'subtotal_minor', 'currency',
    'created_at'
  ],
  'order item columns are exact'
);

select columns_are(
  'public',
  'tickets',
  array[
    'id', 'order_id', 'order_item_id', 'event_id', 'organizer_id', 'ticket_tier_id',
    'unit_sequence', 'status', 'issued_at', 'refunded_at', 'cancelled_at'
  ],
  'ticket columns are exact'
);

select columns_are(
  'public',
  'stripe_webhook_events',
  array[
    'stripe_event_id', 'event_type', 'livemode', 'stripe_object_id', 'api_version',
    'stripe_created_at', 'payload_sha256', 'processing_status', 'delivery_attempt_count',
    'first_received_at', 'last_received_at', 'processed_at', 'error_code'
  ],
  'Stripe webhook event columns are exact'
);

select columns_are(
  'public',
  'refunds',
  array[
    'id', 'stripe_refund_id', 'order_id', 'amount_minor', 'currency', 'status', 'reason',
    'reverse_transfer', 'refund_application_fee', 'stripe_event_id', 'processed_at',
    'created_at', 'updated_at'
  ],
  'refund columns are exact'
);

select results_eq(
  $$
    select array_agg(column_name || ':' || data_type order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'organizer_stripe_accounts'
  $$,
  $$
    values ((array[
      'organizer_id:uuid', 'livemode:boolean', 'stripe_account_id:text', 'dashboard:text',
      'fees_collector:text', 'losses_collector:text', 'country_code:text', 'currency:text',
      'transfers_status:text', 'payouts_status:text', 'requirements_status:text',
      'requirements_currently_due_count:integer', 'requirements_past_due_count:integer',
      'last_status_code:text', 'last_synced_at:timestamp with time zone',
      'created_at:timestamp with time zone', 'updated_at:timestamp with time zone'
    ]::text[]) collate "C")
  $$,
  'organizer Stripe account column types are exact'
);

select results_eq(
  $$
    select array_agg(column_name || ':' || data_type order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'platform_fee_rules'
  $$,
  $$
    values ((array[
      'id:uuid', 'livemode:boolean', 'currency:text', 'platform_percent_bps:integer',
      'platform_fixed_minor:bigint', 'processing_fee_treatment:text',
      'processing_estimate_percent_bps:integer', 'processing_estimate_fixed_minor:bigint',
      'effective_from:timestamp with time zone', 'effective_until:timestamp with time zone',
      'created_at:timestamp with time zone'
    ]::text[]) collate "C")
  $$,
  'platform fee rule column types are exact'
);

select results_eq(
  $$
    select array_agg(column_name || ':' || data_type order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'ticket_tiers'
  $$,
  $$
    values ((array[
      'id:uuid', 'event_id:uuid', 'name:text', 'description:text', 'unit_amount_minor:bigint',
      'currency:text', 'quantity_total:integer', 'status:text', 'sort_order:smallint',
      'version:integer', 'created_at:timestamp with time zone', 'updated_at:timestamp with time zone'
    ]::text[]) collate "C")
  $$,
  'ticket tier column types are exact'
);

select results_eq(
  $$
    select array_agg(column_name || ':' || data_type order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'
  $$,
  $$
    values ((array[
      'id:uuid', 'order_number:text', 'event_id:uuid', 'organizer_id:uuid', 'livemode:boolean',
      'status:text', 'checkout_expires_at:timestamp with time zone',
      'reservation_expires_at:timestamp with time zone', 'paid_at:timestamp with time zone',
      'failed_at:timestamp with time zone', 'expired_at:timestamp with time zone',
      'refunded_at:timestamp with time zone', 'buyer_name:text', 'buyer_email:text',
      'client_request_id:uuid', 'confirmation_token_hash:text', 'quantity:integer',
      'currency:text', 'subtotal_minor:bigint', 'tax_amount_minor:bigint', 'total_minor:bigint',
      'platform_product_fee_minor:bigint', 'stripe_fee_estimate_minor:bigint',
      'application_fee_amount_minor:bigint', 'expected_organizer_proceeds_minor:bigint',
      'actual_stripe_fee_minor:bigint', 'actual_organizer_proceeds_minor:bigint',
      'fee_rule_id:uuid', 'platform_percent_bps:integer', 'platform_fixed_minor:bigint',
      'processing_fee_treatment:text', 'processing_estimate_percent_bps:integer',
      'processing_estimate_fixed_minor:bigint', 'stripe_checkout_session_id:text',
      'stripe_payment_intent_id:text', 'stripe_charge_id:text', 'stripe_transfer_id:text',
      'stripe_application_fee_id:text', 'stripe_balance_transaction_id:text',
      'stripe_customer_id:text', 'last_stripe_event_id:text', 'reconciliation_status:text',
      'failure_code:text', 'created_at:timestamp with time zone', 'updated_at:timestamp with time zone'
    ]::text[]) collate "C")
  $$,
  'order column types are exact and all money uses bigint'
);

select results_eq(
  $$
    select array_agg(column_name || ':' || data_type order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'order_items'
  $$,
  $$
    values ((array[
      'id:uuid', 'order_id:uuid', 'ticket_tier_id:uuid', 'tier_version:integer',
      'tier_name:text', 'tier_description:text', 'unit_amount_minor:bigint', 'quantity:integer',
      'subtotal_minor:bigint', 'currency:text', 'created_at:timestamp with time zone'
    ]::text[]) collate "C")
  $$,
  'order item column types are exact and all money uses bigint'
);

select results_eq(
  $$
    select array_agg(column_name || ':' || data_type order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'tickets'
  $$,
  $$
    values ((array[
      'id:uuid', 'order_id:uuid', 'order_item_id:uuid', 'event_id:uuid', 'organizer_id:uuid',
      'ticket_tier_id:uuid', 'unit_sequence:integer', 'status:text',
      'issued_at:timestamp with time zone', 'refunded_at:timestamp with time zone',
      'cancelled_at:timestamp with time zone'
    ]::text[]) collate "C")
  $$,
  'ticket column types are exact'
);

select results_eq(
  $$
    select array_agg(column_name || ':' || data_type order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'stripe_webhook_events'
  $$,
  $$
    values ((array[
      'stripe_event_id:text', 'event_type:text', 'livemode:boolean', 'stripe_object_id:text',
      'api_version:text', 'stripe_created_at:timestamp with time zone', 'payload_sha256:text',
      'processing_status:text', 'delivery_attempt_count:integer',
      'first_received_at:timestamp with time zone', 'last_received_at:timestamp with time zone',
      'processed_at:timestamp with time zone', 'error_code:text'
    ]::text[]) collate "C")
  $$,
  'Stripe webhook event column types are exact'
);

select results_eq(
  $$
    select array_agg(column_name || ':' || data_type order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'refunds'
  $$,
  $$
    values ((array[
      'id:uuid', 'stripe_refund_id:text', 'order_id:uuid', 'amount_minor:bigint',
      'currency:text', 'status:text', 'reason:text', 'reverse_transfer:boolean',
      'refund_application_fee:boolean', 'stripe_event_id:text',
      'processed_at:timestamp with time zone', 'created_at:timestamp with time zone',
      'updated_at:timestamp with time zone'
    ]::text[]) collate "C")
  $$,
  'refund column types are exact and refund money uses bigint'
);

select has_pk('public', 'organizer_stripe_accounts', 'organizer Stripe accounts have a primary key');
select col_is_pk('public', 'platform_fee_rules', 'id', 'fee rule id is the primary key');
select col_is_pk('public', 'ticket_tiers', 'id', 'ticket tier id is the primary key');
select col_is_pk('public', 'orders', 'id', 'order id is the primary key');
select col_is_pk('public', 'order_items', 'id', 'order item id is the primary key');
select col_is_pk('public', 'tickets', 'id', 'ticket id is the primary key');
select col_is_pk('public', 'stripe_webhook_events', 'stripe_event_id', 'Stripe event id deduplicates delivery');
select col_is_pk('public', 'refunds', 'id', 'refund id is the primary key');

select results_eq(
  $$
    select array_agg(att.attname order by key_columns.ordinality)
    from pg_catalog.pg_constraint as constraints
    cross join lateral unnest(constraints.conkey) with ordinality as key_columns(attnum, ordinality)
    join pg_catalog.pg_class as relations on relations.oid = constraints.conrelid
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = relations.relnamespace
    join pg_catalog.pg_attribute as att
      on att.attrelid = relations.oid and att.attnum = key_columns.attnum
    where namespaces.nspname = 'public'
      and relations.relname = 'organizer_stripe_accounts'
      and constraints.contype = 'p'
  $$,
  $$ values ((array['organizer_id', 'livemode']::name[]) collate "C") $$,
  'organizer and mode form the Connect primary key'
);

select results_eq(
  $$
    select array_agg(
      relations.relname || '.' || att.attname || '->' || referenced_relations.relname || '.' || referenced_att.attname
      order by relations.relname, att.attname
    )
    from pg_catalog.pg_constraint as constraints
    join pg_catalog.pg_class as relations on relations.oid = constraints.conrelid
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = relations.relnamespace
    join pg_catalog.pg_class as referenced_relations on referenced_relations.oid = constraints.confrelid
    cross join lateral unnest(constraints.conkey, constraints.confkey) as keys(attnum, referenced_attnum)
    join pg_catalog.pg_attribute as att
      on att.attrelid = relations.oid and att.attnum = keys.attnum
    join pg_catalog.pg_attribute as referenced_att
      on referenced_att.attrelid = referenced_relations.oid
      and referenced_att.attnum = keys.referenced_attnum
    where namespaces.nspname = 'public'
      and relations.relname in (
        'organizer_stripe_accounts', 'ticket_tiers', 'orders', 'order_items', 'tickets', 'refunds'
      )
  $$,
  $$
    values ((array[
      'order_items.order_id->orders.id',
      'order_items.ticket_tier_id->ticket_tiers.id',
      'orders.event_id->events.id',
      'orders.fee_rule_id->platform_fee_rules.id',
      'orders.last_stripe_event_id->stripe_webhook_events.stripe_event_id',
      'orders.organizer_id->organizers.id',
      'organizer_stripe_accounts.organizer_id->organizers.id',
      'refunds.order_id->orders.id',
      'refunds.stripe_event_id->stripe_webhook_events.stripe_event_id',
      'ticket_tiers.event_id->events.id',
      'tickets.event_id->events.id',
      'tickets.order_id->orders.id',
      'tickets.order_item_id->order_items.id',
      'tickets.organizer_id->organizers.id',
      'tickets.ticket_tier_id->ticket_tiers.id'
    ]::text[]) collate "C")
  $$,
  'financial foreign keys are exact'
);

select has_check('public', 'organizer_stripe_accounts', 'Connect projections have stable checks');
select has_check('public', 'platform_fee_rules', 'fee rules have stable checks');
select has_check('public', 'ticket_tiers', 'ticket tiers have stable checks');
select has_check('public', 'orders', 'orders have stable checks');
select has_check('public', 'order_items', 'order items have stable checks');
select has_check('public', 'tickets', 'tickets have stable checks');
select has_check('public', 'stripe_webhook_events', 'webhook receipts have stable checks');
select has_check('public', 'refunds', 'refunds have stable checks');

select has_trigger('public', 'organizer_stripe_accounts', 'organizer_stripe_accounts_set_updated_at', 'Connect projection updates timestamps');
select has_trigger('public', 'ticket_tiers', 'ticket_tiers_set_updated_at', 'ticket tiers update timestamps');
select has_trigger('public', 'orders', 'orders_set_updated_at', 'orders update timestamps');
select has_trigger('public', 'refunds', 'refunds_set_updated_at', 'refunds update timestamps');

select has_index('public', 'ticket_tiers', 'ticket_tiers_event_status_sort_order_idx', 'event tier read index exists');
select has_index('public', 'ticket_tiers', 'ticket_tiers_active_inventory_idx', 'active tier inventory index exists');
select has_index('public', 'orders', 'orders_organizer_event_status_idx', 'organizer event order index exists');
select has_index('public', 'orders', 'orders_reservation_expires_at_idx', 'reservation expiry index exists');
select has_index('public', 'orders', 'orders_buyer_email_idx', 'normalized buyer email index exists');
select has_index('public', 'order_items', 'order_items_ticket_tier_id_idx', 'tier order-item index exists');
select has_index('public', 'tickets', 'tickets_order_id_idx', 'order ticket index exists');
select has_index('public', 'tickets', 'tickets_event_status_idx', 'event ticket status index exists');
select has_index('public', 'stripe_webhook_events', 'stripe_webhook_events_processing_idx', 'webhook processing index exists');
select has_index('public', 'refunds', 'refunds_order_id_idx', 'order refund index exists');

select results_eq(
  $$
    select array_agg(constraints.conname::text order by constraints.conname)
    from pg_catalog.pg_constraint as constraints
    join pg_catalog.pg_class as relations on relations.oid = constraints.conrelid
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = relations.relnamespace
    where namespaces.nspname = 'public'
      and constraints.contype = 'u'
      and relations.relname in (
        'organizer_stripe_accounts', 'ticket_tiers', 'orders', 'order_items', 'tickets', 'refunds'
      )
  $$,
  $$
    values ((array[
      'order_items_order_id_key',
      'orders_client_request_key',
      'orders_confirmation_token_hash_key',
      'orders_order_number_key',
      'orders_stripe_application_fee_id_key',
      'orders_stripe_balance_transaction_id_key',
      'orders_stripe_charge_id_key',
      'orders_stripe_checkout_session_id_key',
      'orders_stripe_customer_id_key',
      'orders_stripe_payment_intent_id_key',
      'orders_stripe_transfer_id_key',
      'organizer_stripe_accounts_stripe_account_id_key',
      'refunds_stripe_refund_id_key',
      'ticket_tiers_event_sort_order_key',
      'tickets_order_item_unit_sequence_key'
    ]::text[]) collate "C")
  $$,
  'Stripe IDs and Day 2 domain keys are uniquely constrained'
);

select results_eq(
  $$
    select
      count(*)::bigint,
      min(platform_percent_bps),
      min(platform_fixed_minor),
      min(processing_fee_treatment),
      bool_and(not livemode),
      min(currency)
    from public.platform_fee_rules
    where effective_from <= now()
      and (effective_until is null or effective_until > now())
  $$,
  $$ values (1::bigint, 500::integer, 50::bigint, 'platform_fee_only'::text, true, 'usd'::text) $$,
  'exactly one active test USD rule is locked to 500 bps plus 50 minor units per ticket'
);

select is_empty(
  $$ select id from public.platform_fee_rules where livemode $$,
  'no live fee rule exists'
);

select throws_ok(
  $$
    insert into public.platform_fee_rules (
      livemode, currency, platform_percent_bps, platform_fixed_minor,
      processing_fee_treatment, effective_from
    ) values (true, 'usd', 500, 50, 'platform_fee_only', now() + interval '10 years')
  $$,
  '23514',
  null,
  'live fee rules are rejected'
);

select throws_ok(
  $$
    insert into public.platform_fee_rules (
      livemode, currency, platform_percent_bps, platform_fixed_minor,
      processing_fee_treatment, effective_from
    ) values (false, 'USD', 500, 50, 'platform_fee_only', now() + interval '20 years')
  $$,
  '23514',
  null,
  'fee rule currency must be normalized lowercase USD'
);

select * from finish();
rollback;
