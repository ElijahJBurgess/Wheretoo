alter function private.prepare_whole_order_refund(uuid, text)
  rename to prepare_whole_order_refund_v10450;

create function private.prepare_whole_order_refund(
  p_order_id uuid,
  p_reason text
)
returns table (
  order_id uuid,
  payment_intent_id text,
  charge_id text,
  transfer_id text,
  application_fee_id text,
  currency text,
  total_minor bigint,
  application_fee_amount_minor bigint,
  reason text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform * from private.lock_payment_order(p_order_id);

  if exists (
    select 1 from public.refunds as refunds
    where refunds.order_id = p_order_id
      and refunds.status in ('pending', 'requires_action')
  ) then
    raise exception using errcode = 'P0001', message = 'REFUND_NOT_AVAILABLE';
  end if;

  return query
  select * from private.prepare_whole_order_refund_v10450(
    p_order_id, p_reason
  );
end;
$$;

create or replace function public.server_prepare_whole_order_refund(
  p_order_id uuid,
  p_reason text
)
returns table (
  order_id uuid,
  payment_intent_id text,
  charge_id text,
  transfer_id text,
  application_fee_id text,
  currency text,
  total_minor bigint,
  application_fee_amount_minor bigint,
  reason text
)
language sql
security definer
set search_path = ''
as $$
  select * from private.prepare_whole_order_refund(p_order_id, p_reason);
$$;

alter function private.apply_verified_refund(
  text, uuid, text, text, text, text, text, bigint, text, text, text,
  boolean, boolean, bigint, bigint, boolean, text
) rename to apply_verified_refund_v10450;

create function private.apply_verified_refund(
  p_stripe_event_id text,
  p_order_id uuid,
  p_stripe_refund_id text,
  p_payment_intent_id text,
  p_charge_id text,
  p_transfer_reversal_id text,
  p_application_fee_refund_id text,
  p_amount_minor bigint,
  p_currency text,
  p_status text,
  p_reason text,
  p_reverse_transfer boolean,
  p_refund_application_fee boolean,
  p_transfer_reversal_amount_minor bigint,
  p_application_fee_refund_amount_minor bigint,
  p_policy_verified boolean,
  p_policy_failure_code text
)
returns table (order_id uuid, order_status text, ticket_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_refund public.refunds;
  v_status text := case
    when p_status = 'canceled' then 'cancelled' else p_status
  end;
begin
  perform * from private.lock_payment_order(p_order_id);
  select orders.* into v_order
  from public.orders as orders where orders.id = p_order_id;
  select refunds.* into v_refund
  from public.refunds as refunds
  where refunds.stripe_refund_id = p_stripe_refund_id
  for update;

  if found
    and v_refund.status = 'succeeded'
    and not v_refund.policy_verified
    and v_refund.policy_failure_code = 'REFUND_POLICY_MISMATCH'
    and v_status = 'succeeded'
    and (
      v_refund.stripe_transfer_reversal_id
        is distinct from p_transfer_reversal_id
      or v_refund.stripe_application_fee_refund_id
        is distinct from p_application_fee_refund_id
      or v_refund.transfer_reversal_amount_minor
        is distinct from p_transfer_reversal_amount_minor
      or v_refund.application_fee_refund_amount_minor
        is distinct from p_application_fee_refund_amount_minor
      or v_refund.policy_verified is distinct from p_policy_verified
      or v_refund.policy_failure_code is distinct from p_policy_failure_code
    ) then
    if v_order.id is null
      or v_refund.order_id is distinct from p_order_id
      or v_refund.stripe_payment_intent_id
        is distinct from p_payment_intent_id
      or v_refund.stripe_charge_id is distinct from p_charge_id
      or v_refund.amount_minor is distinct from p_amount_minor
      or v_refund.currency is distinct from p_currency
      or v_refund.reverse_transfer is distinct from p_reverse_transfer
      or v_refund.refund_application_fee
        is distinct from p_refund_application_fee
      or p_amount_minor is distinct from v_order.total_minor
      or p_reverse_transfer is distinct from true
      or p_refund_application_fee is distinct from true
      or p_transfer_reversal_id is null
      or p_application_fee_refund_id is null
      or (
        v_refund.stripe_transfer_reversal_id is not null
        and v_refund.stripe_transfer_reversal_id
          is distinct from p_transfer_reversal_id
      )
      or (
        v_refund.stripe_application_fee_refund_id is not null
        and v_refund.stripe_application_fee_refund_id
          is distinct from p_application_fee_refund_id
      )
      or p_transfer_reversal_amount_minor is distinct from v_order.total_minor
      or p_application_fee_refund_amount_minor
        is distinct from v_order.application_fee_amount_minor
      or p_transfer_reversal_amount_minor
        < v_refund.transfer_reversal_amount_minor
      or p_application_fee_refund_amount_minor
        < v_refund.application_fee_refund_amount_minor
      or p_policy_verified is distinct from true
      or p_policy_failure_code is not null then
      raise exception using
        errcode = 'P0001', message = 'REFUND_SNAPSHOT_MISMATCH';
    end if;

    update public.refunds as refunds
    set stripe_transfer_reversal_id = p_transfer_reversal_id,
        stripe_application_fee_refund_id = p_application_fee_refund_id,
        transfer_reversal_amount_minor = p_transfer_reversal_amount_minor,
        application_fee_refund_amount_minor =
          p_application_fee_refund_amount_minor,
        policy_verified = true,
        policy_failure_code = null
    where refunds.id = v_refund.id;
  end if;

  return query
  select * from private.apply_verified_refund_v10450(
    p_stripe_event_id, p_order_id, p_stripe_refund_id,
    p_payment_intent_id, p_charge_id, p_transfer_reversal_id,
    p_application_fee_refund_id, p_amount_minor, p_currency, p_status,
    p_reason, p_reverse_transfer, p_refund_application_fee,
    p_transfer_reversal_amount_minor,
    p_application_fee_refund_amount_minor,
    p_policy_verified, p_policy_failure_code
  );
end;
$$;

create or replace function public.server_apply_verified_refund(
  p_stripe_event_id text,
  p_order_id uuid,
  p_stripe_refund_id text,
  p_payment_intent_id text,
  p_charge_id text,
  p_transfer_reversal_id text,
  p_application_fee_refund_id text,
  p_amount_minor bigint,
  p_currency text,
  p_status text,
  p_reason text,
  p_reverse_transfer boolean,
  p_refund_application_fee boolean,
  p_transfer_reversal_amount_minor bigint,
  p_application_fee_refund_amount_minor bigint,
  p_policy_verified boolean,
  p_policy_failure_code text
)
returns table (order_id uuid, order_status text, ticket_status text)
language sql
security definer
set search_path = ''
as $$
  select * from private.apply_verified_refund(
    p_stripe_event_id, p_order_id, p_stripe_refund_id,
    p_payment_intent_id, p_charge_id, p_transfer_reversal_id,
    p_application_fee_refund_id, p_amount_minor, p_currency, p_status,
    p_reason, p_reverse_transfer, p_refund_application_fee,
    p_transfer_reversal_amount_minor,
    p_application_fee_refund_amount_minor,
    p_policy_verified, p_policy_failure_code
  );
$$;

revoke all on function private.prepare_whole_order_refund_v10450(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.prepare_whole_order_refund(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.apply_verified_refund_v10450(
  text, uuid, text, text, text, text, text, bigint, text, text, text,
  boolean, boolean, bigint, bigint, boolean, text
) from public, anon, authenticated, service_role;
revoke all on function private.apply_verified_refund(
  text, uuid, text, text, text, text, text, bigint, text, text, text,
  boolean, boolean, bigint, bigint, boolean, text
) from public, anon, authenticated, service_role;

comment on function private.prepare_whole_order_refund_v10450(uuid, text) is
  'Task 8 implementation detail; call the unresolved-refund guard.';
comment on function private.apply_verified_refund_v10450(
  text, uuid, text, text, text, text, text, bigint, text, text, text,
  boolean, boolean, bigint, bigint, boolean, text
) is 'Task 8 implementation detail; succeeded mismatch recovery uses the guarded wrapper.';
