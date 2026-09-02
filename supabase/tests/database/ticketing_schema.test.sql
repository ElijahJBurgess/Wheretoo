begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(87);

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
    'last_status_code', 'last_synced_at', 'created_at', 'updated_at', 'last_sync_sequence'
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
    'created_at', 'updated_at', 'stripe_destination_account_id',
    'stripe_checkout_integration_identifier', 'stripe_checkout_request_digest'
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
    'created_at', 'updated_at', 'stripe_payment_intent_id', 'stripe_charge_id',
    'stripe_transfer_reversal_id', 'stripe_application_fee_refund_id'
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
      'created_at:timestamp with time zone', 'updated_at:timestamp with time zone',
      'last_sync_sequence:bigint'
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
      'failure_code:text', 'created_at:timestamp with time zone', 'updated_at:timestamp with time zone',
      'stripe_destination_account_id:text', 'stripe_checkout_integration_identifier:text',
      'stripe_checkout_request_digest:text'
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
      'updated_at:timestamp with time zone', 'stripe_payment_intent_id:text',
      'stripe_charge_id:text', 'stripe_transfer_reversal_id:text',
      'stripe_application_fee_refund_id:text'
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
      'order_items_order_id_ticket_tier_id_key',
      'orders_client_request_key',
      'orders_confirmation_token_hash_key',
      'orders_order_number_key',
      'orders_stripe_application_fee_id_key',
      'orders_stripe_balance_transaction_id_key',
      'orders_stripe_charge_id_key',
      'orders_stripe_checkout_session_id_key',
      'orders_stripe_payment_intent_id_key',
      'orders_stripe_transfer_id_key',
      'organizer_stripe_accounts_stripe_account_id_key',
      'refunds_application_fee_refund_id_key',
      'refunds_stripe_refund_id_key',
      'refunds_transfer_reversal_id_key',
      'ticket_tiers_event_sort_order_key',
      'tickets_order_item_unit_sequence_key'
    ]::text[]) collate "C")
  $$,
  'Stripe IDs and Day 2 domain keys are uniquely constrained'
);

select results_eq(
  $$
    select jsonb_agg(
      jsonb_build_array(
        relations.relname,
        constraints.conname,
        pg_catalog.pg_get_constraintdef(constraints.oid, true)
      )
      order by relations.relname, constraints.conname
    )
    from pg_catalog.pg_constraint as constraints
    join pg_catalog.pg_class as relations on relations.oid = constraints.conrelid
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = relations.relnamespace
    where namespaces.nspname = 'public'
      and constraints.conname in (
        'order_items_quantity_check',
        'order_items_subtotal_check',
        'orders_application_fee_check',
        'orders_currency_check',
        'orders_fee_snapshot_check',
        'orders_platform_product_fee_check',
        'orders_quantity_check',
        'orders_status_check',
        'orders_stripe_fee_estimate_check',
        'orders_test_mode_check',
        'orders_total_check',
        'organizer_stripe_accounts_payouts_status_check',
        'organizer_stripe_accounts_requirements_status_check',
        'organizer_stripe_accounts_transfers_status_check',
        'platform_fee_rules_currency_check',
        'platform_fee_rules_fixed_check',
        'platform_fee_rules_percent_check',
        'platform_fee_rules_processing_estimate_check',
        'platform_fee_rules_processing_treatment_check',
        'platform_fee_rules_test_mode_check',
        'refunds_status_check',
        'stripe_webhook_events_processing_status_check',
        'stripe_webhook_events_test_mode_check',
        'ticket_tiers_currency_check',
        'ticket_tiers_sort_order_check',
        'ticket_tiers_status_check',
        'ticket_tiers_unit_amount_check',
        'tickets_status_check',
        'tickets_status_timestamp_check'
      )
  $$,
  $$
    values ($json$[
      ["order_items", "order_items_quantity_check", "CHECK (quantity >= 1 AND quantity <= 10)"],
      ["order_items", "order_items_subtotal_check", "CHECK (subtotal_minor::numeric = (unit_amount_minor::numeric * quantity::numeric) AND subtotal_minor > 0)"],
      ["orders", "orders_application_fee_check", "CHECK (application_fee_amount_minor::numeric = (platform_product_fee_minor::numeric + stripe_fee_estimate_minor::numeric) AND application_fee_amount_minor < subtotal_minor)"],
      ["orders", "orders_currency_check", "CHECK (currency = 'usd'::text)"],
      ["orders", "orders_fee_snapshot_check", "CHECK (platform_percent_bps >= 0 AND platform_percent_bps <= 10000 AND platform_fixed_minor >= 0 AND (processing_fee_treatment = ANY (ARRAY['stripe_fee_estimate'::text, 'platform_fee_only'::text])) AND (processing_fee_treatment = 'platform_fee_only'::text AND processing_estimate_percent_bps IS NULL AND processing_estimate_fixed_minor IS NULL OR processing_fee_treatment = 'stripe_fee_estimate'::text AND processing_estimate_percent_bps IS NOT NULL AND processing_estimate_percent_bps >= 0 AND processing_estimate_percent_bps <= 10000 AND processing_estimate_fixed_minor IS NOT NULL AND processing_estimate_fixed_minor >= 0))"],
      ["orders", "orders_platform_product_fee_check", "CHECK (platform_product_fee_minor::numeric = (floor(subtotal_minor::numeric * platform_percent_bps::numeric / 10000::numeric) + platform_fixed_minor::numeric * quantity::numeric))"],
      ["orders", "orders_quantity_check", "CHECK (quantity >= 1 AND quantity <= 10)"],
      ["orders", "orders_status_check", "CHECK (status = ANY (ARRAY['creating_checkout'::text, 'checkout_open'::text, 'payment_processing'::text, 'paid'::text, 'expired'::text, 'payment_failed'::text, 'cancelled'::text, 'partially_refunded'::text, 'refunded'::text, 'requires_review'::text]))"],
      ["orders", "orders_stripe_fee_estimate_check", "CHECK (processing_fee_treatment = 'platform_fee_only'::text AND stripe_fee_estimate_minor = 0 OR processing_fee_treatment = 'stripe_fee_estimate'::text AND stripe_fee_estimate_minor::numeric = (floor(subtotal_minor::numeric * processing_estimate_percent_bps::numeric / 10000::numeric) + processing_estimate_fixed_minor::numeric * quantity::numeric))"],
      ["orders", "orders_test_mode_check", "CHECK (NOT livemode)"],
      ["orders", "orders_total_check", "CHECK (total_minor::numeric = (subtotal_minor::numeric + tax_amount_minor::numeric))"],
      ["organizer_stripe_accounts", "organizer_stripe_accounts_payouts_status_check", "CHECK (payouts_status = ANY (ARRAY['inactive'::text, 'pending'::text, 'active'::text, 'restricted'::text]))"],
      ["organizer_stripe_accounts", "organizer_stripe_accounts_requirements_status_check", "CHECK (requirements_status = ANY (ARRAY['not_started'::text, 'pending'::text, 'action_required'::text, 'restricted'::text, 'clear'::text]))"],
      ["organizer_stripe_accounts", "organizer_stripe_accounts_transfers_status_check", "CHECK (transfers_status = ANY (ARRAY['inactive'::text, 'pending'::text, 'active'::text, 'restricted'::text]))"],
      ["platform_fee_rules", "platform_fee_rules_currency_check", "CHECK (currency = 'usd'::text)"],
      ["platform_fee_rules", "platform_fee_rules_fixed_check", "CHECK (platform_fixed_minor >= 0)"],
      ["platform_fee_rules", "platform_fee_rules_percent_check", "CHECK (platform_percent_bps >= 0 AND platform_percent_bps <= 10000)"],
      ["platform_fee_rules", "platform_fee_rules_processing_estimate_check", "CHECK (processing_fee_treatment = 'platform_fee_only'::text AND processing_estimate_percent_bps IS NULL AND processing_estimate_fixed_minor IS NULL OR processing_fee_treatment = 'stripe_fee_estimate'::text AND processing_estimate_percent_bps IS NOT NULL AND processing_estimate_percent_bps >= 0 AND processing_estimate_percent_bps <= 10000 AND processing_estimate_fixed_minor IS NOT NULL AND processing_estimate_fixed_minor >= 0)"],
      ["platform_fee_rules", "platform_fee_rules_processing_treatment_check", "CHECK (processing_fee_treatment = ANY (ARRAY['stripe_fee_estimate'::text, 'platform_fee_only'::text]))"],
      ["platform_fee_rules", "platform_fee_rules_test_mode_check", "CHECK (NOT livemode)"],
      ["refunds", "refunds_status_check", "CHECK (status = ANY (ARRAY['pending'::text, 'requires_action'::text, 'succeeded'::text, 'failed'::text, 'canceled'::text, 'cancelled'::text]))"],
      ["stripe_webhook_events", "stripe_webhook_events_processing_status_check", "CHECK (processing_status = ANY (ARRAY['processing'::text, 'processed'::text, 'failed'::text]))"],
      ["stripe_webhook_events", "stripe_webhook_events_test_mode_check", "CHECK (NOT livemode)"],
      ["ticket_tiers", "ticket_tiers_currency_check", "CHECK (currency = 'usd'::text)"],
      ["ticket_tiers", "ticket_tiers_sort_order_check", "CHECK (sort_order >= 1 AND sort_order <= 3)"],
      ["ticket_tiers", "ticket_tiers_status_check", "CHECK (status = ANY (ARRAY['draft'::text, 'active'::text, 'archived'::text]))"],
      ["ticket_tiers", "ticket_tiers_unit_amount_check", "CHECK (unit_amount_minor >= 1 AND unit_amount_minor <= 99999999)"],
      ["tickets", "tickets_status_check", "CHECK (status = ANY (ARRAY['valid'::text, 'refunded'::text, 'cancelled'::text]))"],
      ["tickets", "tickets_status_timestamp_check", "CHECK (status = 'valid'::text AND refunded_at IS NULL AND cancelled_at IS NULL OR status = 'refunded'::text AND refunded_at IS NOT NULL AND cancelled_at IS NULL OR status = 'cancelled'::text AND refunded_at IS NULL AND cancelled_at IS NOT NULL)" ]
    ]$json$::jsonb)
  $$,
  'critical check constraints have exact definitions'
);

select results_eq(
  $$
    select jsonb_agg(jsonb_build_array(constraints.conname, constraints.confdeltype) order by constraints.conname)
    from pg_catalog.pg_constraint as constraints
    join pg_catalog.pg_class as relations on relations.oid = constraints.conrelid
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = relations.relnamespace
    where namespaces.nspname = 'public'
      and relations.relname in (
        'organizer_stripe_accounts', 'ticket_tiers', 'orders', 'order_items', 'tickets', 'refunds'
      )
      and constraints.contype = 'f'
  $$,
  $$
    values ($json$[
      ["order_items_order_id_fkey", "r"],
      ["order_items_ticket_tier_id_fkey", "r"],
      ["orders_event_id_fkey", "r"],
      ["orders_fee_rule_id_fkey", "r"],
      ["orders_last_stripe_event_id_fkey", "r"],
      ["orders_organizer_id_fkey", "r"],
      ["organizer_stripe_accounts_organizer_id_fkey", "r"],
      ["refunds_order_id_fkey", "r"],
      ["refunds_stripe_event_id_fkey", "r"],
      ["ticket_tiers_event_id_fkey", "r"],
      ["tickets_event_id_fkey", "r"],
      ["tickets_order_id_fkey", "r"],
      ["tickets_order_item_id_fkey", "r"],
      ["tickets_organizer_id_fkey", "r"],
      ["tickets_ticket_tier_id_fkey", "r"]
    ]$json$::jsonb)
  $$,
  'all financial foreign keys use ON DELETE RESTRICT'
);

select results_eq(
  $$
    select jsonb_agg(jsonb_build_array(indexes.relname, pg_catalog.pg_get_indexdef(indexes.oid)) order by indexes.relname)
    from pg_catalog.pg_class as indexes
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = indexes.relnamespace
    join pg_catalog.pg_index as index_meta on index_meta.indexrelid = indexes.oid
    where namespaces.nspname = 'public'
      and indexes.relname in (
        'platform_fee_rules_one_active_mode_currency_idx',
        'ticket_tiers_event_status_sort_order_idx',
        'ticket_tiers_active_inventory_idx',
        'orders_organizer_event_status_idx',
        'orders_reservation_expires_at_idx',
        'orders_buyer_email_idx',
        'order_items_ticket_tier_id_idx',
        'tickets_order_id_idx',
        'tickets_event_status_idx',
        'stripe_webhook_events_processing_idx',
        'refunds_order_id_idx'
      )
  $$,
  $$
    values ($json$[
      ["order_items_ticket_tier_id_idx", "CREATE INDEX order_items_ticket_tier_id_idx ON public.order_items USING btree (ticket_tier_id)"],
      ["orders_buyer_email_idx", "CREATE INDEX orders_buyer_email_idx ON public.orders USING btree (buyer_email)"],
      ["orders_organizer_event_status_idx", "CREATE INDEX orders_organizer_event_status_idx ON public.orders USING btree (organizer_id, event_id, status)"],
      ["orders_reservation_expires_at_idx", "CREATE INDEX orders_reservation_expires_at_idx ON public.orders USING btree (reservation_expires_at) WHERE (status = ANY (ARRAY['checkout_open'::text, 'payment_processing'::text]))"],
      ["platform_fee_rules_one_active_mode_currency_idx", "CREATE UNIQUE INDEX platform_fee_rules_one_active_mode_currency_idx ON public.platform_fee_rules USING btree (livemode, currency) WHERE (effective_until IS NULL)"],
      ["refunds_order_id_idx", "CREATE INDEX refunds_order_id_idx ON public.refunds USING btree (order_id)"],
      ["stripe_webhook_events_processing_idx", "CREATE INDEX stripe_webhook_events_processing_idx ON public.stripe_webhook_events USING btree (processing_status, last_received_at)"],
      ["ticket_tiers_active_inventory_idx", "CREATE INDEX ticket_tiers_active_inventory_idx ON public.ticket_tiers USING btree (event_id, id, quantity_total) WHERE (status = 'active'::text)"],
      ["ticket_tiers_event_status_sort_order_idx", "CREATE INDEX ticket_tiers_event_status_sort_order_idx ON public.ticket_tiers USING btree (event_id, status, sort_order)"],
      ["tickets_event_status_idx", "CREATE INDEX tickets_event_status_idx ON public.tickets USING btree (event_id, status)"],
      ["tickets_order_id_idx", "CREATE INDEX tickets_order_id_idx ON public.tickets USING btree (order_id)"]
    ]$json$::jsonb)
  $$,
  'operational indexes have exact columns and predicates'
);

select results_eq(
  $$
    select pg_catalog.pg_get_constraintdef(constraints.oid, true)
    from pg_catalog.pg_constraint as constraints
    join pg_catalog.pg_class as relations on relations.oid = constraints.conrelid
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = relations.relnamespace
    where namespaces.nspname = 'public'
      and relations.relname = 'platform_fee_rules'
      and constraints.conname = 'platform_fee_rules_effective_range_excl'
  $$,
  $$
    values (
      'EXCLUDE USING gist (livemode WITH =, currency WITH =, '
      || 'tstzrange(effective_from, COALESCE(effective_until, ''infinity''::timestamp with time zone), ''[)''::text) WITH &&)'
    )
  $$,
  'fee rule effective windows have the exact non-overlap exclusion'
);

select is_empty(
  $$
    select constraints.conname
    from pg_catalog.pg_constraint as constraints
    join pg_catalog.pg_class as relations on relations.oid = constraints.conrelid
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = relations.relnamespace
    where namespaces.nspname = 'public'
      and relations.relname = 'orders'
      and constraints.contype = 'u'
      and constraints.conkey = array[
        (select attnum from pg_catalog.pg_attribute where attrelid = relations.oid and attname = 'stripe_customer_id')
      ]::smallint[]
  $$,
  'Stripe customer IDs are reusable and are not uniquely constrained per order'
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

insert into auth.users (id, email)
values ('10000000-0000-0000-0000-000000000090', 'ticketing-schema-test@example.invalid');

insert into public.organizers (id, display_name)
values ('10000000-0000-0000-0000-000000000090', 'Ticketing Schema Test');

insert into public.events (id, organizer_id, title)
values (
  '20000000-0000-0000-0000-000000000090',
  '10000000-0000-0000-0000-000000000090',
  'Ticketing Schema Fixture'
);

insert into public.ticket_tiers (
  id, event_id, name, unit_amount_minor, quantity_total, status, sort_order
)
values (
  '30000000-0000-0000-0000-000000000090',
  '20000000-0000-0000-0000-000000000090',
  'General Admission',
  2000,
  10,
  'active',
  1
);

insert into public.stripe_webhook_events (
  stripe_event_id, event_type, stripe_created_at, payload_sha256
)
values (
  'evt_ticketingschemafixture',
  'checkout.session.completed',
  now(),
  repeat('a', 64)
);

insert into public.orders (
  id, order_number, event_id, organizer_id, buyer_name, buyer_email, client_request_id,
  confirmation_token_hash, quantity, currency, subtotal_minor, total_minor,
  platform_product_fee_minor, application_fee_amount_minor,
  expected_organizer_proceeds_minor, fee_rule_id, platform_percent_bps,
  platform_fixed_minor, processing_fee_treatment
)
values (
  '40000000-0000-0000-0000-000000000090',
  'WT-SCHEMA-090',
  '20000000-0000-0000-0000-000000000090',
  '10000000-0000-0000-0000-000000000090',
  'Schema Buyer',
  'schema-buyer@example.invalid',
  '60000000-0000-0000-0000-000000000090',
  repeat('b', 64),
  1,
  'usd',
  2000,
  2000,
  150,
  150,
  1850,
  '00000000-0000-0000-0000-000000000500',
  500,
  50,
  'platform_fee_only'
);

insert into public.order_items (
  id, order_id, ticket_tier_id, tier_version, tier_name, unit_amount_minor,
  quantity, subtotal_minor, currency
)
values (
  '50000000-0000-0000-0000-000000000090',
  '40000000-0000-0000-0000-000000000090',
  '30000000-0000-0000-0000-000000000090',
  1,
  'General Admission',
  2000,
  1,
  2000,
  'usd'
);

select throws_ok(
  $$
    insert into public.organizer_stripe_accounts (
      organizer_id, stripe_account_id, transfers_status
    ) values (
      '10000000-0000-0000-0000-000000000090', 'acct_invalidtransfers', 'unknown'
    )
  $$,
  '23514',
  null,
  'invalid Connect transfer lifecycle state is rejected'
);

select throws_ok(
  $$
    insert into public.organizer_stripe_accounts (
      organizer_id, stripe_account_id, requirements_status
    ) values (
      '10000000-0000-0000-0000-000000000090', 'acct_invalidrequirements', 'unknown'
    )
  $$,
  '23514',
  null,
  'invalid Connect requirements lifecycle state is rejected'
);

select throws_ok(
  $$
    insert into public.ticket_tiers (
      event_id, name, unit_amount_minor, quantity_total, status, sort_order
    ) values (
      '20000000-0000-0000-0000-000000000090', 'Invalid Tier', 2000, 10, 'unknown', 2
    )
  $$,
  '23514',
  null,
  'invalid ticket tier lifecycle state is rejected'
);

select throws_ok(
  $$
    update public.orders
    set status = 'unknown'
    where id = '40000000-0000-0000-0000-000000000090'
  $$,
  '23514',
  null,
  'invalid order lifecycle state is rejected'
);

select throws_ok(
  $$
    insert into public.tickets (
      order_id, order_item_id, event_id, organizer_id, ticket_tier_id, unit_sequence, status
    ) values (
      '40000000-0000-0000-0000-000000000090',
      '50000000-0000-0000-0000-000000000090',
      '20000000-0000-0000-0000-000000000090',
      '10000000-0000-0000-0000-000000000090',
      '30000000-0000-0000-0000-000000000090',
      1,
      'unknown'
    )
  $$,
  '23514',
  null,
  'invalid ticket lifecycle state is rejected'
);

select throws_ok(
  $$
    update public.stripe_webhook_events
    set processing_status = 'unknown'
    where stripe_event_id = 'evt_ticketingschemafixture'
  $$,
  '23514',
  null,
  'invalid webhook lifecycle state is rejected'
);

select throws_ok(
  $$
    insert into public.refunds (
      stripe_refund_id, order_id, amount_minor, currency, status,
      reverse_transfer, refund_application_fee, stripe_event_id
    ) values (
      're_invalidstatus',
      '40000000-0000-0000-0000-000000000090',
      100,
      'usd',
      'unknown',
      true,
      false,
      'evt_ticketingschemafixture'
    )
  $$,
  '23514',
  null,
  'invalid refund lifecycle state is rejected'
);

select throws_ok(
  $$
    insert into public.platform_fee_rules (
      livemode, currency, platform_percent_bps, platform_fixed_minor,
      processing_fee_treatment, effective_from, effective_until
    ) values (
      false,
      'usd',
      500,
      50,
      'platform_fee_only',
      '2026-08-25 00:00:01+00'::timestamptz,
      '2026-08-26 00:00:00+00'::timestamptz
    )
  $$,
  '23P01',
  null,
  'overlapping test fee windows are rejected'
);

select throws_ok(
  $$
    update public.orders
    set platform_product_fee_minor = 151,
        application_fee_amount_minor = 151,
        expected_organizer_proceeds_minor = 1849
    where id = '40000000-0000-0000-0000-000000000090'
  $$,
  '23514',
  null,
  'incorrect percentage plus fixed fee arithmetic is rejected'
);

select lives_ok(
  $$
    insert into public.orders (
      order_number, event_id, organizer_id, buyer_name, buyer_email, client_request_id,
      confirmation_token_hash, quantity, currency, subtotal_minor, total_minor,
      platform_product_fee_minor, application_fee_amount_minor,
      expected_organizer_proceeds_minor, fee_rule_id, platform_percent_bps,
      platform_fixed_minor, processing_fee_treatment
    ) values (
      'WT-BOUNDARY-090',
      '20000000-0000-0000-0000-000000000090',
      '10000000-0000-0000-0000-000000000090',
      'Boundary Buyer',
      'boundary-buyer@example.invalid',
      '60000000-0000-0000-0000-000000000091',
      repeat('c', 64),
      1,
      'usd',
      9223372036854775807,
      9223372036854775807,
      9222449699651090329,
      9222449699651090329,
      922337203685478,
      '00000000-0000-0000-0000-000000000500',
      9999,
      0,
      'platform_fee_only'
    )
  $$,
  'fee arithmetic accepts the bigint boundary without intermediate overflow'
);

select lives_ok(
  $$
    insert into public.orders (
      order_number, event_id, organizer_id, buyer_name, buyer_email, client_request_id,
      confirmation_token_hash, quantity, currency, subtotal_minor, total_minor,
      platform_product_fee_minor, application_fee_amount_minor,
      expected_organizer_proceeds_minor, fee_rule_id, platform_percent_bps,
      platform_fixed_minor, processing_fee_treatment, stripe_customer_id
    ) values
      (
        'WT-CUSTOMER-091',
        '20000000-0000-0000-0000-000000000090',
        '10000000-0000-0000-0000-000000000090',
        'Reusable Customer One',
        'reusable-one@example.invalid',
        '60000000-0000-0000-0000-000000000092',
        repeat('d', 64),
        1,
        'usd',
        2000,
        2000,
        150,
        150,
        1850,
        '00000000-0000-0000-0000-000000000500',
        500,
        50,
        'platform_fee_only',
        'cus_reusablecustomer'
      ),
      (
        'WT-CUSTOMER-092',
        '20000000-0000-0000-0000-000000000090',
        '10000000-0000-0000-0000-000000000090',
        'Reusable Customer Two',
        'reusable-two@example.invalid',
        '60000000-0000-0000-0000-000000000093',
        repeat('e', 64),
        1,
        'usd',
        2000,
        2000,
        150,
        150,
        1850,
        '00000000-0000-0000-0000-000000000500',
        500,
        50,
        'platform_fee_only',
        'cus_reusablecustomer'
      )
  $$,
  'one Stripe customer can be reused across multiple orders'
);

select throws_ok(
  $$
    insert into public.tickets (
      order_id, order_item_id, event_id, organizer_id, ticket_tier_id,
      unit_sequence, status, refunded_at
    ) values (
      '40000000-0000-0000-0000-000000000090',
      '50000000-0000-0000-0000-000000000090',
      '20000000-0000-0000-0000-000000000090',
      '10000000-0000-0000-0000-000000000090',
      '30000000-0000-0000-0000-000000000090',
      2,
      'valid',
      now()
    )
  $$,
  '23514',
  null,
  'valid tickets reject a refunded timestamp'
);

select throws_ok(
  $$
    insert into public.tickets (
      order_id, order_item_id, event_id, organizer_id, ticket_tier_id,
      unit_sequence, status, cancelled_at
    ) values (
      '40000000-0000-0000-0000-000000000090',
      '50000000-0000-0000-0000-000000000090',
      '20000000-0000-0000-0000-000000000090',
      '10000000-0000-0000-0000-000000000090',
      '30000000-0000-0000-0000-000000000090',
      3,
      'valid',
      now()
    )
  $$,
  '23514',
  null,
  'valid tickets reject a cancelled timestamp'
);

select throws_ok(
  $$
    insert into public.tickets (
      order_id, order_item_id, event_id, organizer_id, ticket_tier_id,
      unit_sequence, status, refunded_at, cancelled_at
    ) values (
      '40000000-0000-0000-0000-000000000090',
      '50000000-0000-0000-0000-000000000090',
      '20000000-0000-0000-0000-000000000090',
      '10000000-0000-0000-0000-000000000090',
      '30000000-0000-0000-0000-000000000090',
      4,
      'refunded',
      now(),
      now()
    )
  $$,
  '23514',
  null,
  'refunded tickets reject a cancelled timestamp'
);

select throws_ok(
  $$
    insert into public.tickets (
      order_id, order_item_id, event_id, organizer_id, ticket_tier_id,
      unit_sequence, status, refunded_at, cancelled_at
    ) values (
      '40000000-0000-0000-0000-000000000090',
      '50000000-0000-0000-0000-000000000090',
      '20000000-0000-0000-0000-000000000090',
      '10000000-0000-0000-0000-000000000090',
      '30000000-0000-0000-0000-000000000090',
      5,
      'cancelled',
      now(),
      now()
    )
  $$,
  '23514',
  null,
  'cancelled tickets reject a refunded timestamp'
);

select lives_ok(
  $$
    insert into public.tickets (
      order_id, order_item_id, event_id, organizer_id, ticket_tier_id,
      unit_sequence, status, refunded_at
    ) values (
      '40000000-0000-0000-0000-000000000090',
      '50000000-0000-0000-0000-000000000090',
      '20000000-0000-0000-0000-000000000090',
      '10000000-0000-0000-0000-000000000090',
      '30000000-0000-0000-0000-000000000090',
      6,
      'refunded',
      now()
    )
  $$,
  'refunded tickets require only a refunded timestamp'
);

select lives_ok(
  $$
    insert into public.tickets (
      order_id, order_item_id, event_id, organizer_id, ticket_tier_id,
      unit_sequence, status, cancelled_at
    ) values (
      '40000000-0000-0000-0000-000000000090',
      '50000000-0000-0000-0000-000000000090',
      '20000000-0000-0000-0000-000000000090',
      '10000000-0000-0000-0000-000000000090',
      '30000000-0000-0000-0000-000000000090',
      7,
      'cancelled',
      now()
    )
  $$,
  'cancelled tickets require only a cancelled timestamp'
);

select lives_ok(
  $$
    insert into public.organizer_stripe_accounts (
      organizer_id, stripe_account_id
    ) values (
      '10000000-0000-0000-0000-000000000090',
      'acct_1NG8Du2eZvKYlo2C'
    )
  $$,
  'mixed-case Stripe account IDs from Stripe object form are preserved'
);

select lives_ok(
  $$
    insert into public.stripe_webhook_events (
      stripe_event_id, event_type, stripe_object_id, stripe_created_at, payload_sha256
    ) values (
      'evt_1NG8Du2eZvKYlo2CUI79vXWy',
      'refund.updated',
      're_1Nispe2eZvKYlo2Cd31jOCgZ',
      '2026-08-25 17:00:00+00',
      repeat('f', 64)
    )
  $$,
  'mixed-case Stripe event and object IDs from Stripe fixtures are preserved'
);

select lives_ok(
  $$
    update public.orders
    set stripe_checkout_session_id = 'cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u',
        stripe_payment_intent_id = 'pi_1GszsK2eZvKYlo2CfhZyoZLp',
        stripe_charge_id = 'ch_1NirD82eZvKYlo2CIvbtLWuY',
        stripe_transfer_id = 'tr_1Nispe2eZvKYlo2CYezqFhEx',
        stripe_application_fee_id = 'fee_1Nispe2eZvKYlo2CYezqFhEx',
        stripe_balance_transaction_id = 'txn_1Nispe2eZvKYlo2CYezqFhEx',
        stripe_customer_id = 'cus_1NG8Du2eZvKYlo2CUI79vXWy'
    where id = '40000000-0000-0000-0000-000000000090'
  $$,
  'mixed-case Stripe payment identifiers are accepted without normalization'
);

select lives_ok(
  $$
    insert into public.refunds (
      stripe_refund_id, order_id, amount_minor, currency, status,
      reverse_transfer, refund_application_fee, stripe_event_id
    ) values (
      're_1Nispe2eZvKYlo2Cd31jOCgZ',
      '40000000-0000-0000-0000-000000000090',
      100,
      'usd',
      'succeeded',
      true,
      false,
      'evt_1NG8Du2eZvKYlo2CUI79vXWy'
    )
  $$,
  'mixed-case Stripe refund IDs are accepted without normalization'
);

select * from finish();
rollback;
