create extension if not exists btree_gist with schema extensions;

create table public.organizer_stripe_accounts (
  organizer_id uuid not null references public.organizers(id) on delete restrict,
  livemode boolean not null default false,
  stripe_account_id text not null,
  dashboard text not null default 'express',
  fees_collector text not null default 'application',
  losses_collector text not null default 'application',
  country_code text not null default 'US',
  currency text not null default 'usd',
  transfers_status text not null default 'inactive',
  payouts_status text not null default 'inactive',
  requirements_status text not null default 'not_started',
  requirements_currently_due_count integer not null default 0,
  requirements_past_due_count integer not null default 0,
  last_status_code text,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organizer_id, livemode),
  constraint organizer_stripe_accounts_stripe_account_id_key unique (stripe_account_id),
  constraint organizer_stripe_accounts_test_mode_check check (not livemode),
  constraint organizer_stripe_accounts_stripe_id_check check (
    stripe_account_id = btrim(stripe_account_id)
    and stripe_account_id = lower(stripe_account_id)
    and stripe_account_id ~ '^acct_[a-z0-9]+$'
  ),
  constraint organizer_stripe_accounts_dashboard_check check (dashboard = 'express'),
  constraint organizer_stripe_accounts_fees_collector_check check (fees_collector = 'application'),
  constraint organizer_stripe_accounts_losses_collector_check check (losses_collector = 'application'),
  constraint organizer_stripe_accounts_country_code_check check (country_code = 'US'),
  constraint organizer_stripe_accounts_currency_check check (currency = 'usd'),
  constraint organizer_stripe_accounts_transfers_status_check check (
    transfers_status in ('inactive', 'pending', 'active', 'restricted')
  ),
  constraint organizer_stripe_accounts_payouts_status_check check (
    payouts_status in ('inactive', 'pending', 'active', 'restricted')
  ),
  constraint organizer_stripe_accounts_requirements_status_check check (
    requirements_status in ('not_started', 'pending', 'action_required', 'restricted', 'clear')
  ),
  constraint organizer_stripe_accounts_due_counts_check check (
    requirements_currently_due_count >= 0 and requirements_past_due_count >= 0
  ),
  constraint organizer_stripe_accounts_last_status_code_check check (
    last_status_code is null
    or (last_status_code = btrim(last_status_code) and char_length(last_status_code) between 1 and 255)
  )
);

create table public.platform_fee_rules (
  id uuid primary key default gen_random_uuid(),
  livemode boolean not null default false,
  currency text not null,
  platform_percent_bps integer not null,
  platform_fixed_minor bigint not null,
  processing_fee_treatment text not null,
  processing_estimate_percent_bps integer,
  processing_estimate_fixed_minor bigint,
  effective_from timestamptz not null,
  effective_until timestamptz,
  created_at timestamptz not null default now(),
  constraint platform_fee_rules_test_mode_check check (not livemode),
  constraint platform_fee_rules_currency_check check (currency = 'usd'),
  constraint platform_fee_rules_percent_check check (platform_percent_bps between 0 and 10000),
  constraint platform_fee_rules_fixed_check check (platform_fixed_minor >= 0),
  constraint platform_fee_rules_processing_treatment_check check (
    processing_fee_treatment in ('stripe_fee_estimate', 'platform_fee_only')
  ),
  constraint platform_fee_rules_processing_estimate_check check (
    (
      processing_fee_treatment = 'platform_fee_only'
      and processing_estimate_percent_bps is null
      and processing_estimate_fixed_minor is null
    ) or (
      processing_fee_treatment = 'stripe_fee_estimate'
      and processing_estimate_percent_bps between 0 and 10000
      and processing_estimate_fixed_minor >= 0
    )
  ),
  constraint platform_fee_rules_effective_window_check check (
    effective_until is null or effective_until > effective_from
  ),
  constraint platform_fee_rules_effective_range_excl exclude using gist (
    livemode with =,
    currency with =,
    tstzrange(effective_from, coalesce(effective_until, 'infinity'::timestamptz), '[)') with &&
  )
);

create unique index platform_fee_rules_one_active_mode_currency_idx
on public.platform_fee_rules (livemode, currency)
where effective_until is null;

create table public.ticket_tiers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  name text not null,
  description text,
  unit_amount_minor bigint not null,
  currency text not null default 'usd',
  quantity_total integer not null,
  status text not null default 'draft',
  sort_order smallint not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_tiers_event_sort_order_key unique (event_id, sort_order),
  constraint ticket_tiers_name_check check (
    name = btrim(name) and char_length(name) between 1 and 80
  ),
  constraint ticket_tiers_description_check check (
    description is null or char_length(description) <= 240
  ),
  constraint ticket_tiers_unit_amount_check check (
    unit_amount_minor between 1 and 99999999
  ),
  constraint ticket_tiers_currency_check check (currency = 'usd'),
  constraint ticket_tiers_quantity_check check (quantity_total > 0),
  constraint ticket_tiers_status_check check (status in ('draft', 'active', 'archived')),
  constraint ticket_tiers_sort_order_check check (sort_order between 1 and 3),
  constraint ticket_tiers_version_check check (version >= 1)
);

create table public.stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  livemode boolean not null default false,
  stripe_object_id text,
  api_version text,
  stripe_created_at timestamptz not null,
  payload_sha256 text not null,
  processing_status text not null default 'processing',
  delivery_attempt_count integer not null default 1,
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_code text,
  constraint stripe_webhook_events_test_mode_check check (not livemode),
  constraint stripe_webhook_events_event_id_check check (
    stripe_event_id = btrim(stripe_event_id)
    and stripe_event_id = lower(stripe_event_id)
    and stripe_event_id ~ '^evt_[a-z0-9]+$'
  ),
  constraint stripe_webhook_events_event_type_check check (
    event_type = btrim(event_type)
    and event_type = lower(event_type)
    and char_length(event_type) between 3 and 160
  ),
  constraint stripe_webhook_events_object_id_check check (
    stripe_object_id is null
    or (
      stripe_object_id = btrim(stripe_object_id)
      and stripe_object_id = lower(stripe_object_id)
      and stripe_object_id ~ '^[a-z][a-z0-9_]*$'
    )
  ),
  constraint stripe_webhook_events_api_version_check check (
    api_version is null
    or (
      api_version = btrim(api_version)
      and api_version = lower(api_version)
      and char_length(api_version) between 10 and 64
    )
  ),
  constraint stripe_webhook_events_digest_check check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  constraint stripe_webhook_events_processing_status_check check (
    processing_status in ('processing', 'processed', 'failed')
  ),
  constraint stripe_webhook_events_attempt_count_check check (delivery_attempt_count >= 1),
  constraint stripe_webhook_events_receipt_time_check check (last_received_at >= first_received_at),
  constraint stripe_webhook_events_error_code_check check (
    error_code is null
    or (error_code = btrim(error_code) and char_length(error_code) between 1 and 255)
  )
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null,
  event_id uuid not null references public.events(id) on delete restrict,
  organizer_id uuid not null references public.organizers(id) on delete restrict,
  livemode boolean not null default false,
  status text not null default 'creating_checkout',
  checkout_expires_at timestamptz,
  reservation_expires_at timestamptz,
  paid_at timestamptz,
  failed_at timestamptz,
  expired_at timestamptz,
  refunded_at timestamptz,
  buyer_name text not null,
  buyer_email text not null,
  client_request_id uuid not null,
  confirmation_token_hash text not null,
  quantity integer not null,
  currency text not null,
  subtotal_minor bigint not null,
  tax_amount_minor bigint not null default 0,
  total_minor bigint not null,
  platform_product_fee_minor bigint not null,
  stripe_fee_estimate_minor bigint not null default 0,
  application_fee_amount_minor bigint not null,
  expected_organizer_proceeds_minor bigint not null,
  actual_stripe_fee_minor bigint,
  actual_organizer_proceeds_minor bigint,
  fee_rule_id uuid not null references public.platform_fee_rules(id) on delete restrict,
  platform_percent_bps integer not null,
  platform_fixed_minor bigint not null,
  processing_fee_treatment text not null,
  processing_estimate_percent_bps integer,
  processing_estimate_fixed_minor bigint,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  stripe_transfer_id text,
  stripe_application_fee_id text,
  stripe_balance_transaction_id text,
  stripe_customer_id text,
  last_stripe_event_id text references public.stripe_webhook_events(stripe_event_id) on delete restrict,
  reconciliation_status text not null default 'pending',
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_order_number_key unique (order_number),
  constraint orders_client_request_key unique (organizer_id, event_id, client_request_id),
  constraint orders_confirmation_token_hash_key unique (confirmation_token_hash),
  constraint orders_stripe_checkout_session_id_key unique (stripe_checkout_session_id),
  constraint orders_stripe_payment_intent_id_key unique (stripe_payment_intent_id),
  constraint orders_stripe_charge_id_key unique (stripe_charge_id),
  constraint orders_stripe_transfer_id_key unique (stripe_transfer_id),
  constraint orders_stripe_application_fee_id_key unique (stripe_application_fee_id),
  constraint orders_stripe_balance_transaction_id_key unique (stripe_balance_transaction_id),
  constraint orders_stripe_customer_id_key unique (stripe_customer_id),
  constraint orders_order_number_check check (
    order_number = btrim(order_number) and char_length(order_number) between 1 and 64
  ),
  constraint orders_test_mode_check check (not livemode),
  constraint orders_status_check check (
    status in (
      'creating_checkout', 'checkout_open', 'payment_processing', 'paid', 'expired',
      'payment_failed', 'cancelled', 'partially_refunded', 'refunded', 'requires_review'
    )
  ),
  constraint orders_expiry_check check (
    (checkout_expires_at is null or checkout_expires_at > created_at)
    and (reservation_expires_at is null or reservation_expires_at > created_at)
  ),
  constraint orders_buyer_name_check check (
    buyer_name = btrim(buyer_name) and char_length(buyer_name) between 1 and 120
  ),
  constraint orders_buyer_email_check check (
    buyer_email = btrim(buyer_email)
    and buyer_email = lower(buyer_email)
    and char_length(buyer_email) between 3 and 320
    and buyer_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
  ),
  constraint orders_confirmation_token_hash_check check (
    confirmation_token_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint orders_quantity_check check (quantity > 0),
  constraint orders_currency_check check (currency = 'usd'),
  constraint orders_money_nonnegative_check check (
    subtotal_minor > 0
    and tax_amount_minor >= 0
    and total_minor > 0
    and platform_product_fee_minor >= 0
    and stripe_fee_estimate_minor >= 0
    and application_fee_amount_minor >= 0
    and expected_organizer_proceeds_minor >= 0
    and (actual_stripe_fee_minor is null or actual_stripe_fee_minor >= 0)
    and (actual_organizer_proceeds_minor is null or actual_organizer_proceeds_minor >= 0)
  ),
  constraint orders_tax_disabled_check check (tax_amount_minor = 0),
  constraint orders_total_check check (total_minor = subtotal_minor + tax_amount_minor),
  constraint orders_fee_snapshot_check check (
    platform_percent_bps between 0 and 10000
    and platform_fixed_minor >= 0
    and processing_fee_treatment in ('stripe_fee_estimate', 'platform_fee_only')
    and (
      (
        processing_fee_treatment = 'platform_fee_only'
        and processing_estimate_percent_bps is null
        and processing_estimate_fixed_minor is null
      ) or (
        processing_fee_treatment = 'stripe_fee_estimate'
        and processing_estimate_percent_bps between 0 and 10000
        and processing_estimate_fixed_minor >= 0
      )
    )
  ),
  constraint orders_platform_product_fee_check check (
    platform_product_fee_minor =
      floor((subtotal_minor * platform_percent_bps)::numeric / 10000)::bigint
      + (platform_fixed_minor * quantity)
  ),
  constraint orders_stripe_fee_estimate_check check (
    (
      processing_fee_treatment = 'platform_fee_only'
      and stripe_fee_estimate_minor = 0
    ) or (
      processing_fee_treatment = 'stripe_fee_estimate'
      and stripe_fee_estimate_minor =
        floor((subtotal_minor * processing_estimate_percent_bps)::numeric / 10000)::bigint
        + (processing_estimate_fixed_minor * quantity)
    )
  ),
  constraint orders_application_fee_check check (
    application_fee_amount_minor = platform_product_fee_minor + stripe_fee_estimate_minor
    and application_fee_amount_minor < subtotal_minor
  ),
  constraint orders_expected_proceeds_check check (
    expected_organizer_proceeds_minor = subtotal_minor - application_fee_amount_minor
  ),
  constraint orders_checkout_session_id_check check (
    stripe_checkout_session_id is null
    or (
      stripe_checkout_session_id = btrim(stripe_checkout_session_id)
      and stripe_checkout_session_id = lower(stripe_checkout_session_id)
      and stripe_checkout_session_id ~ '^cs_test_[a-z0-9]+$'
    )
  ),
  constraint orders_payment_intent_id_check check (
    stripe_payment_intent_id is null
    or (
      stripe_payment_intent_id = btrim(stripe_payment_intent_id)
      and stripe_payment_intent_id = lower(stripe_payment_intent_id)
      and stripe_payment_intent_id ~ '^pi_[a-z0-9]+$'
    )
  ),
  constraint orders_charge_id_check check (
    stripe_charge_id is null
    or (
      stripe_charge_id = btrim(stripe_charge_id)
      and stripe_charge_id = lower(stripe_charge_id)
      and stripe_charge_id ~ '^ch_[a-z0-9]+$'
    )
  ),
  constraint orders_transfer_id_check check (
    stripe_transfer_id is null
    or (
      stripe_transfer_id = btrim(stripe_transfer_id)
      and stripe_transfer_id = lower(stripe_transfer_id)
      and stripe_transfer_id ~ '^tr_[a-z0-9]+$'
    )
  ),
  constraint orders_application_fee_id_check check (
    stripe_application_fee_id is null
    or (
      stripe_application_fee_id = btrim(stripe_application_fee_id)
      and stripe_application_fee_id = lower(stripe_application_fee_id)
      and stripe_application_fee_id ~ '^fee_[a-z0-9]+$'
    )
  ),
  constraint orders_balance_transaction_id_check check (
    stripe_balance_transaction_id is null
    or (
      stripe_balance_transaction_id = btrim(stripe_balance_transaction_id)
      and stripe_balance_transaction_id = lower(stripe_balance_transaction_id)
      and stripe_balance_transaction_id ~ '^txn_[a-z0-9]+$'
    )
  ),
  constraint orders_customer_id_check check (
    stripe_customer_id is null
    or (
      stripe_customer_id = btrim(stripe_customer_id)
      and stripe_customer_id = lower(stripe_customer_id)
      and stripe_customer_id ~ '^cus_[a-z0-9]+$'
    )
  ),
  constraint orders_reconciliation_status_check check (
    reconciliation_status in ('pending', 'reconciled', 'mismatch', 'requires_review')
  ),
  constraint orders_failure_code_check check (
    failure_code is null
    or (failure_code = btrim(failure_code) and char_length(failure_code) between 1 and 255)
  )
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  ticket_tier_id uuid not null references public.ticket_tiers(id) on delete restrict,
  tier_version integer not null,
  tier_name text not null,
  tier_description text,
  unit_amount_minor bigint not null,
  quantity integer not null,
  subtotal_minor bigint not null,
  currency text not null,
  created_at timestamptz not null default now(),
  constraint order_items_order_id_key unique (order_id),
  constraint order_items_order_id_fkey foreign key (order_id)
    references public.orders(id) on delete restrict,
  constraint order_items_tier_version_check check (tier_version >= 1),
  constraint order_items_tier_name_check check (
    tier_name = btrim(tier_name) and char_length(tier_name) between 1 and 80
  ),
  constraint order_items_tier_description_check check (
    tier_description is null or char_length(tier_description) <= 240
  ),
  constraint order_items_unit_amount_check check (unit_amount_minor between 1 and 99999999),
  constraint order_items_quantity_check check (quantity > 0),
  constraint order_items_subtotal_check check (
    subtotal_minor = unit_amount_minor * quantity and subtotal_minor > 0
  ),
  constraint order_items_currency_check check (currency = 'usd')
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  event_id uuid not null references public.events(id) on delete restrict,
  organizer_id uuid not null references public.organizers(id) on delete restrict,
  ticket_tier_id uuid not null references public.ticket_tiers(id) on delete restrict,
  unit_sequence integer not null,
  status text not null default 'valid',
  issued_at timestamptz not null default now(),
  refunded_at timestamptz,
  cancelled_at timestamptz,
  constraint tickets_order_item_unit_sequence_key unique (order_item_id, unit_sequence),
  constraint tickets_unit_sequence_check check (unit_sequence >= 1),
  constraint tickets_status_check check (status in ('valid', 'refunded', 'cancelled')),
  constraint tickets_status_timestamp_check check (
    (status <> 'refunded' or refunded_at is not null)
    and (status <> 'cancelled' or cancelled_at is not null)
  )
);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  stripe_refund_id text not null,
  order_id uuid not null references public.orders(id) on delete restrict,
  amount_minor bigint not null,
  currency text not null,
  status text not null,
  reason text,
  reverse_transfer boolean not null,
  refund_application_fee boolean not null,
  stripe_event_id text not null references public.stripe_webhook_events(stripe_event_id) on delete restrict,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refunds_stripe_refund_id_key unique (stripe_refund_id),
  constraint refunds_stripe_refund_id_check check (
    stripe_refund_id = btrim(stripe_refund_id)
    and stripe_refund_id = lower(stripe_refund_id)
    and stripe_refund_id ~ '^re_[a-z0-9]+$'
  ),
  constraint refunds_amount_check check (amount_minor > 0),
  constraint refunds_currency_check check (currency = 'usd'),
  constraint refunds_status_check check (
    status in ('pending', 'requires_action', 'succeeded', 'failed', 'cancelled')
  ),
  constraint refunds_reason_check check (
    reason is null or (reason = btrim(reason) and char_length(reason) between 1 and 255)
  )
);

create trigger organizer_stripe_accounts_set_updated_at
before update on public.organizer_stripe_accounts
for each row execute function public.set_updated_at();

create trigger ticket_tiers_set_updated_at
before update on public.ticket_tiers
for each row execute function public.set_updated_at();

create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

create trigger refunds_set_updated_at
before update on public.refunds
for each row execute function public.set_updated_at();

create index ticket_tiers_event_status_sort_order_idx
on public.ticket_tiers (event_id, status, sort_order);

create index ticket_tiers_active_inventory_idx
on public.ticket_tiers (event_id, id, quantity_total)
where status = 'active';

create index orders_organizer_event_status_idx
on public.orders (organizer_id, event_id, status);

create index orders_reservation_expires_at_idx
on public.orders (reservation_expires_at)
where status in ('checkout_open', 'payment_processing');

create index orders_buyer_email_idx on public.orders (buyer_email);
create index order_items_ticket_tier_id_idx on public.order_items (ticket_tier_id);
create index tickets_order_id_idx on public.tickets (order_id);
create index tickets_event_status_idx on public.tickets (event_id, status);

create index stripe_webhook_events_processing_idx
on public.stripe_webhook_events (processing_status, last_received_at);

create index refunds_order_id_idx on public.refunds (order_id);

insert into public.platform_fee_rules (
  id,
  livemode,
  currency,
  platform_percent_bps,
  platform_fixed_minor,
  processing_fee_treatment,
  processing_estimate_percent_bps,
  processing_estimate_fixed_minor,
  effective_from,
  effective_until
)
values (
  '00000000-0000-0000-0000-000000000500',
  false,
  'usd',
  500,
  50,
  'platform_fee_only',
  null,
  null,
  '2026-08-25 00:00:00+00'::timestamptz,
  null
);
