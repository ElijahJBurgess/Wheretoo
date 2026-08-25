alter table public.orders
drop constraint orders_stripe_customer_id_key;

alter table public.platform_fee_rules
drop constraint platform_fee_rules_processing_estimate_check,
add constraint platform_fee_rules_processing_estimate_check check (
  (
    processing_fee_treatment = 'platform_fee_only'
    and processing_estimate_percent_bps is null
    and processing_estimate_fixed_minor is null
  ) or (
    processing_fee_treatment = 'stripe_fee_estimate'
    and processing_estimate_percent_bps is not null
    and processing_estimate_percent_bps between 0 and 10000
    and processing_estimate_fixed_minor is not null
    and processing_estimate_fixed_minor >= 0
  )
);

alter table public.orders
drop constraint orders_fee_snapshot_check,
add constraint orders_fee_snapshot_check check (
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
      and processing_estimate_percent_bps is not null
      and processing_estimate_percent_bps between 0 and 10000
      and processing_estimate_fixed_minor is not null
      and processing_estimate_fixed_minor >= 0
    )
  )
),
drop constraint orders_total_check,
add constraint orders_total_check check (
  total_minor::numeric = subtotal_minor::numeric + tax_amount_minor::numeric
),
drop constraint orders_platform_product_fee_check,
add constraint orders_platform_product_fee_check check (
  platform_product_fee_minor::numeric =
    floor(subtotal_minor::numeric * platform_percent_bps::numeric / 10000::numeric)
    + platform_fixed_minor::numeric * quantity::numeric
),
drop constraint orders_stripe_fee_estimate_check,
add constraint orders_stripe_fee_estimate_check check (
  (
    processing_fee_treatment = 'platform_fee_only'
    and stripe_fee_estimate_minor = 0
  ) or (
    processing_fee_treatment = 'stripe_fee_estimate'
    and stripe_fee_estimate_minor::numeric =
      floor(
        subtotal_minor::numeric * processing_estimate_percent_bps::numeric / 10000::numeric
      )
      + processing_estimate_fixed_minor::numeric * quantity::numeric
  )
),
drop constraint orders_application_fee_check,
add constraint orders_application_fee_check check (
  application_fee_amount_minor::numeric =
    platform_product_fee_minor::numeric + stripe_fee_estimate_minor::numeric
  and application_fee_amount_minor < subtotal_minor
),
drop constraint orders_expected_proceeds_check,
add constraint orders_expected_proceeds_check check (
  expected_organizer_proceeds_minor::numeric =
    subtotal_minor::numeric - application_fee_amount_minor::numeric
);

alter table public.order_items
drop constraint order_items_subtotal_check,
add constraint order_items_subtotal_check check (
  subtotal_minor::numeric = unit_amount_minor::numeric * quantity::numeric
  and subtotal_minor > 0
);

alter table public.tickets
drop constraint tickets_status_timestamp_check,
add constraint tickets_status_timestamp_check check (
  (
    status = 'valid'
    and refunded_at is null
    and cancelled_at is null
  ) or (
    status = 'refunded'
    and refunded_at is not null
    and cancelled_at is null
  ) or (
    status = 'cancelled'
    and refunded_at is null
    and cancelled_at is not null
  )
);
