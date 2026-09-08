-- Forward-only correction for the applied aggregate-money helper. The
-- persisted order invariant charges both fixed components per admission.
create or replace function private.calculate_checkout_money(
  p_subtotal_minor bigint,
  p_quantity integer,
  p_platform_percent_bps integer,
  p_platform_fixed_minor bigint,
  p_processing_fee_treatment text,
  p_processing_estimate_percent_bps integer,
  p_processing_estimate_fixed_minor bigint
)
returns table (
  subtotal_minor bigint,
  platform_product_fee_minor bigint,
  stripe_fee_estimate_minor bigint,
  application_fee_amount_minor bigint,
  expected_organizer_proceeds_minor bigint,
  total_minor bigint
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_bigint_max constant numeric := 9223372036854775807;
  v_platform_product_fee numeric;
  v_stripe_fee_estimate numeric;
  v_application_fee_amount numeric;
begin
  if p_subtotal_minor is null
    or p_subtotal_minor <= 0
    or p_quantity is null
    or p_quantity not between 1 and 10
    or p_platform_percent_bps is null
    or p_platform_percent_bps not between 0 and 10000
    or p_platform_fixed_minor is null
    or p_platform_fixed_minor < 0
    or p_processing_fee_treatment is null
    or p_processing_fee_treatment not in ('stripe_fee_estimate', 'platform_fee_only')
    or (
      p_processing_fee_treatment = 'stripe_fee_estimate'
      and (
        p_processing_estimate_percent_bps is null
        or p_processing_estimate_percent_bps not between 0 and 10000
        or p_processing_estimate_fixed_minor is null
        or p_processing_estimate_fixed_minor < 0
      )
    )
    or (
      p_processing_fee_treatment = 'platform_fee_only'
      and (
        p_processing_estimate_percent_bps is not null
        or p_processing_estimate_fixed_minor is not null
      )
    ) then
    raise exception using errcode = 'P0001', message = 'CHECKOUT_INPUT_INVALID';
  end if;

  v_platform_product_fee :=
    floor(p_subtotal_minor::numeric * p_platform_percent_bps::numeric / 10000::numeric)
    + p_platform_fixed_minor::numeric * p_quantity::numeric;
  v_stripe_fee_estimate := case
    when p_processing_fee_treatment = 'stripe_fee_estimate' then
      floor(
        p_subtotal_minor::numeric * p_processing_estimate_percent_bps::numeric
          / 10000::numeric
      ) + p_processing_estimate_fixed_minor::numeric * p_quantity::numeric
    else 0::numeric
  end;
  v_application_fee_amount := v_platform_product_fee + v_stripe_fee_estimate;

  if v_platform_product_fee > v_bigint_max
    or v_stripe_fee_estimate > v_bigint_max
    or v_application_fee_amount > v_bigint_max then
    raise exception using errcode = 'P0001', message = 'CHECKOUT_INPUT_INVALID';
  end if;

  return query select
    p_subtotal_minor,
    v_platform_product_fee::bigint,
    v_stripe_fee_estimate::bigint,
    v_application_fee_amount::bigint,
    (p_subtotal_minor::numeric - v_application_fee_amount)::bigint,
    p_subtotal_minor;
end;
$$;

revoke all on function private.calculate_checkout_money(
  bigint, integer, integer, bigint, text, integer, bigint
) from public, anon, authenticated, service_role;
