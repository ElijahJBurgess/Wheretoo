create or replace function private.apply_refund(
  p_stripe_event_id text,
  p_order_id uuid,
  p_stripe_refund_id text,
  p_amount_minor bigint,
  p_currency text,
  p_status text,
  p_reason text,
  p_reverse_transfer boolean,
  p_refund_application_fee boolean
)
returns table (
  order_id uuid,
  order_status text,
  ticket_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_receipt public.stripe_webhook_events;
  v_refund public.refunds;
  v_successful_refund_total bigint;
  v_ticket_status text;
  v_existing_refund boolean;
  v_ignore_transition boolean;
begin
  perform * from private.lock_payment_order(p_order_id);
  select orders.* into v_order from public.orders as orders where orders.id = p_order_id;
  select receipts.* into v_receipt
  from public.stripe_webhook_events as receipts
  where receipts.stripe_event_id = p_stripe_event_id
  for update;

  if not found
    or v_receipt.livemode
    or v_receipt.stripe_object_id is distinct from p_stripe_refund_id
    or v_order.paid_at is null
    or p_currency is distinct from v_order.currency
    or p_amount_minor is null
    or p_amount_minor <= 0
    or p_status not in ('pending', 'requires_action', 'succeeded', 'failed', 'cancelled')
    or p_reverse_transfer is null
    or p_refund_application_fee is null then
    raise exception using errcode = 'P0001', message = 'REFUND_SNAPSHOT_MISMATCH';
  end if;

  select refunds.* into v_refund
  from public.refunds as refunds
  where refunds.stripe_refund_id = p_stripe_refund_id
  for update;

  v_existing_refund := found;

  if v_existing_refund and (
    v_refund.order_id is distinct from p_order_id
    or v_refund.amount_minor is distinct from p_amount_minor
    or v_refund.currency is distinct from p_currency
    or v_refund.reverse_transfer is distinct from p_reverse_transfer
    or v_refund.refund_application_fee is distinct from p_refund_application_fee
  ) then
    raise exception using errcode = 'P0001', message = 'REFUND_SNAPSHOT_MISMATCH';
  end if;

  v_ignore_transition := v_existing_refund and (
    v_refund.status in ('succeeded', 'failed', 'cancelled')
    or v_refund.status = p_status
    or (v_refund.status = 'requires_action' and p_status = 'pending')
  );

  if v_ignore_transition then
    update public.stripe_webhook_events as receipts
    set processing_status = 'processed',
        processed_at = coalesce(receipts.processed_at, statement_timestamp()),
        error_code = null
    where receipts.stripe_event_id = p_stripe_event_id;

    select tickets.status into v_ticket_status
    from public.tickets as tickets where tickets.order_id = p_order_id;

    return query select v_order.id, v_order.status, v_ticket_status;
    return;
  end if;

  insert into public.refunds (
    stripe_refund_id, order_id, amount_minor, currency, status, reason,
    reverse_transfer, refund_application_fee, stripe_event_id, processed_at
  )
  values (
    p_stripe_refund_id, p_order_id, p_amount_minor, p_currency, p_status,
    p_reason, p_reverse_transfer, p_refund_application_fee, p_stripe_event_id,
    case when p_status in ('succeeded', 'failed', 'cancelled')
      then statement_timestamp() else null end
  )
  on conflict (stripe_refund_id) do update
  set status = excluded.status,
      reason = coalesce(public.refunds.reason, excluded.reason),
      stripe_event_id = excluded.stripe_event_id,
      processed_at = case
        when excluded.status in ('succeeded', 'failed', 'cancelled')
          then coalesce(public.refunds.processed_at, statement_timestamp())
        else null
      end;

  select coalesce(sum(refunds.amount_minor), 0)::bigint
  into v_successful_refund_total
  from public.refunds as refunds
  where refunds.order_id = p_order_id
    and refunds.status = 'succeeded';

  if v_successful_refund_total > v_order.total_minor then
    raise exception using errcode = 'P0001', message = 'REFUND_TOTAL_INVALID';
  end if;

  if v_successful_refund_total = v_order.total_minor then
    update public.orders as orders
    set status = 'refunded',
        refunded_at = coalesce(orders.refunded_at, statement_timestamp()),
        reconciliation_status = 'reconciled',
        last_stripe_event_id = p_stripe_event_id,
        failure_code = null
    where orders.id = p_order_id;

    update public.tickets as tickets
    set status = 'refunded',
        refunded_at = coalesce(tickets.refunded_at, statement_timestamp()),
        cancelled_at = null
    where tickets.order_id = p_order_id
      and tickets.status = 'valid';
  elsif v_successful_refund_total > 0 then
    update public.orders as orders
    set status = case
          when orders.status in ('refunded', 'requires_review') then orders.status
          else 'partially_refunded'
        end,
        reconciliation_status = case
          when orders.status = 'requires_review' then 'requires_review'
          else 'reconciled'
        end,
        last_stripe_event_id = p_stripe_event_id
    where orders.id = p_order_id;

    update public.tickets as tickets
    set status = 'refunded',
        refunded_at = coalesce(tickets.refunded_at, statement_timestamp()),
        cancelled_at = null
    where tickets.order_id = p_order_id
      and tickets.status = 'valid';
  end if;

  update public.stripe_webhook_events as receipts
  set processing_status = 'processed',
      processed_at = coalesce(receipts.processed_at, statement_timestamp()),
      error_code = null
  where receipts.stripe_event_id = p_stripe_event_id;

  select orders.* into v_order from public.orders as orders where orders.id = p_order_id;
  select tickets.status into v_ticket_status
  from public.tickets as tickets where tickets.order_id = p_order_id;

  return query select v_order.id, v_order.status, v_ticket_status;
end;
$$;

revoke all on function private.apply_refund(
  text, uuid, text, bigint, text, text, text, boolean, boolean
) from public, anon, authenticated, service_role;
