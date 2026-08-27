create or replace function private.mark_payment_requires_review(
  p_stripe_event_id text,
  p_order_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_charge_id text,
  p_transfer_id text,
  p_application_fee_id text,
  p_balance_transaction_id text,
  p_customer_id text,
  p_mode text,
  p_payment_status text,
  p_currency text,
  p_subtotal_minor bigint,
  p_total_minor bigint,
  p_application_fee_amount_minor bigint,
  p_destination_account_id text,
  p_failure_code text
)
returns table (order_id uuid, order_status text, ticket_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_receipt public.stripe_webhook_events;
  v_ticket_status text;
begin
  perform * from private.lock_payment_order(p_order_id);
  select orders.* into v_order
  from public.orders as orders where orders.id = p_order_id;
  select receipts.* into v_receipt
  from public.stripe_webhook_events as receipts
  where receipts.stripe_event_id = p_stripe_event_id
  for update;

  if not found
    or v_receipt.livemode
    or v_order.id is null
    or v_order.livemode
    or v_order.stripe_checkout_session_id is distinct from p_checkout_session_id
    or v_order.currency is distinct from p_currency
    or v_order.subtotal_minor is distinct from p_subtotal_minor
    or v_order.total_minor is distinct from p_total_minor
    or v_order.application_fee_amount_minor
      is distinct from p_application_fee_amount_minor
    or v_order.stripe_destination_account_id is distinct from p_destination_account_id
    or p_mode is distinct from 'payment'
    or p_payment_status is distinct from 'paid'
    or p_payment_intent_id is null
    or p_charge_id is null
    or p_transfer_id is null
    or p_application_fee_id is null
    or p_balance_transaction_id is null
    or p_failure_code is null
    or p_failure_code !~ '^[A-Z][A-Z0-9_]{0,254}$' then
    raise exception using errcode = 'P0001', message = 'PAYMENT_SNAPSHOT_MISMATCH';
  end if;

  if exists (
    select 1 from public.orders as orders
    where orders.id <> p_order_id
      and (
        orders.stripe_payment_intent_id = p_payment_intent_id
        or orders.stripe_charge_id = p_charge_id
        or orders.stripe_transfer_id = p_transfer_id
        or orders.stripe_application_fee_id = p_application_fee_id
        or orders.stripe_balance_transaction_id = p_balance_transaction_id
      )
  ) or (
    v_order.stripe_payment_intent_id is not null
    and v_order.stripe_payment_intent_id is distinct from p_payment_intent_id
  ) or (
    v_order.stripe_charge_id is not null
    and v_order.stripe_charge_id is distinct from p_charge_id
  ) or (
    v_order.stripe_transfer_id is not null
    and v_order.stripe_transfer_id is distinct from p_transfer_id
  ) or (
    v_order.stripe_application_fee_id is not null
    and v_order.stripe_application_fee_id is distinct from p_application_fee_id
  ) or (
    v_order.stripe_balance_transaction_id is not null
    and v_order.stripe_balance_transaction_id is distinct from p_balance_transaction_id
  ) or (
    v_order.stripe_customer_id is not null
    and v_order.stripe_customer_id is distinct from p_customer_id
  ) then
    raise exception using errcode = 'P0001', message = 'PAYMENT_SNAPSHOT_MISMATCH';
  end if;

  update public.orders as orders
  set stripe_payment_intent_id = coalesce(orders.stripe_payment_intent_id, p_payment_intent_id),
      stripe_charge_id = coalesce(orders.stripe_charge_id, p_charge_id),
      stripe_transfer_id = coalesce(orders.stripe_transfer_id, p_transfer_id),
      stripe_application_fee_id = coalesce(
        orders.stripe_application_fee_id, p_application_fee_id
      ),
      stripe_balance_transaction_id = coalesce(
        orders.stripe_balance_transaction_id, p_balance_transaction_id
      ),
      stripe_customer_id = coalesce(orders.stripe_customer_id, p_customer_id),
      paid_at = coalesce(orders.paid_at, statement_timestamp()),
      status = case
        when orders.status in ('partially_refunded', 'refunded') then orders.status
        else 'requires_review'
      end,
      reconciliation_status = 'requires_review',
      failure_code = p_failure_code,
      last_stripe_event_id = p_stripe_event_id
  where orders.id = p_order_id
  returning orders.* into v_order;

  update public.tickets as tickets
  set status = 'cancelled',
      cancelled_at = coalesce(tickets.cancelled_at, statement_timestamp()),
      refunded_at = null
  where tickets.order_id = p_order_id and tickets.status = 'valid';

  update public.stripe_webhook_events as receipts
  set processing_status = 'processed',
      processed_at = coalesce(receipts.processed_at, statement_timestamp()),
      error_code = p_failure_code
  where receipts.stripe_event_id = p_stripe_event_id;

  select tickets.status into v_ticket_status
  from public.tickets as tickets where tickets.order_id = p_order_id;
  return query select v_order.id, v_order.status, v_ticket_status;
end;
$$;

revoke all on function private.mark_payment_requires_review(
  text, uuid, text, text, text, text, text, text, text,
  text, text, text, bigint, bigint, bigint, text, text
) from public, anon, authenticated, service_role;
