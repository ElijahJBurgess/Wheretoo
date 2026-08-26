create or replace function private.fulfill_paid_order(
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
  p_destination_account_id text
)
returns table (
  order_id uuid,
  order_status text,
  ticket_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lock record;
  v_order public.orders;
  v_event public.events;
  v_tier public.ticket_tiers;
  v_item public.order_items;
  v_ticket_id uuid;
  v_committed_quantity bigint;
  v_invalidated boolean;
begin
  select * into v_lock from private.lock_payment_order(p_order_id);

  perform private.assert_payment_snapshot(
    p_stripe_event_id, p_order_id, p_checkout_session_id, p_payment_intent_id,
    p_mode, p_payment_status, p_currency, p_subtotal_minor, p_total_minor,
    p_application_fee_amount_minor, p_destination_account_id
  );

  if p_payment_status is distinct from 'paid' then
    raise exception using errcode = 'P0001', message = 'PAYMENT_NOT_PAID';
  end if;

  if p_payment_intent_id is null
    or p_charge_id is null
    or p_transfer_id is null
    or p_application_fee_id is null
    or p_balance_transaction_id is null then
    raise exception using errcode = 'P0001', message = 'PAYMENT_SNAPSHOT_MISMATCH';
  end if;

  if exists (
    select 1
    from public.orders as orders
    where orders.id <> p_order_id
      and (
        orders.stripe_checkout_session_id = p_checkout_session_id
        or orders.stripe_payment_intent_id = p_payment_intent_id
        or orders.stripe_charge_id = p_charge_id
        or orders.stripe_transfer_id = p_transfer_id
        or orders.stripe_application_fee_id = p_application_fee_id
        or orders.stripe_balance_transaction_id = p_balance_transaction_id
      )
  ) then
    raise exception using errcode = 'P0001', message = 'PAYMENT_OBJECT_ALREADY_USED';
  end if;

  select orders.* into v_order from public.orders as orders where orders.id = p_order_id;
  select events.* into v_event from public.events as events where events.id = v_lock.event_id;
  select tiers.* into v_tier
  from public.ticket_tiers as tiers where tiers.id = v_lock.ticket_tier_id;
  select items.* into v_item
  from public.order_items as items where items.id = v_lock.order_item_id;

  if (
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

  if v_order.status in ('paid', 'partially_refunded', 'refunded', 'requires_review') then
    select tickets.id into v_ticket_id
    from public.tickets as tickets
    where tickets.order_item_id = v_lock.order_item_id
      and tickets.unit_sequence = 1;

    update public.stripe_webhook_events as receipts
    set processing_status = 'processed',
        processed_at = coalesce(receipts.processed_at, statement_timestamp()),
        error_code = null
    where receipts.stripe_event_id = p_stripe_event_id;

    return query select v_order.id, v_order.status, v_ticket_id;
    return;
  end if;

  select coalesce(sum(items.quantity), 0)::bigint into v_committed_quantity
  from public.order_items as items
  join public.orders as orders on orders.id = items.order_id
  where items.ticket_tier_id = v_lock.ticket_tier_id
    and orders.id <> p_order_id
    and (
      orders.status in ('paid', 'payment_processing')
      or (
        orders.status in ('creating_checkout', 'checkout_open')
        and orders.reservation_expires_at > statement_timestamp()
      )
    );

  v_invalidated :=
    v_order.status in ('expired', 'payment_failed', 'cancelled')
    or (
      v_order.status in ('creating_checkout', 'checkout_open')
      and v_order.reservation_expires_at <= statement_timestamp()
    )
    or v_event.status is distinct from 'published'
    or v_event.admission_type is distinct from 'paid'
    or v_event.moderation_status not in ('clear', 'flagged')
    or v_tier.status is distinct from 'active'
    or v_tier.event_id is distinct from v_event.id
    or v_item.quantity is distinct from 1
    or v_item.currency is distinct from v_order.currency
    or v_item.subtotal_minor is distinct from v_order.subtotal_minor
    or v_committed_quantity + v_item.quantity > v_tier.quantity_total;

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
      status = case when v_invalidated then 'requires_review' else 'paid' end,
      reconciliation_status = case
        when v_invalidated then 'requires_review'
        else 'reconciled'
      end,
      failure_code = case
        when v_invalidated then 'PAYMENT_AFTER_INVALIDATION'
        else null
      end,
      last_stripe_event_id = p_stripe_event_id
  where orders.id = p_order_id
  returning orders.* into v_order;

  if v_order.status = 'paid' then
    insert into public.tickets (
      order_id, order_item_id, event_id, organizer_id, ticket_tier_id, unit_sequence
    )
    values (
      p_order_id, v_lock.order_item_id, v_lock.event_id, v_lock.organizer_id,
      v_lock.ticket_tier_id, 1
    )
    on conflict (order_item_id, unit_sequence) do nothing;
  end if;

  select tickets.id into v_ticket_id
  from public.tickets as tickets
  where tickets.order_item_id = v_lock.order_item_id
    and tickets.unit_sequence = 1;

  update public.stripe_webhook_events as receipts
  set processing_status = 'processed',
      processed_at = coalesce(receipts.processed_at, statement_timestamp()),
      error_code = null
  where receipts.stripe_event_id = p_stripe_event_id;

  return query select v_order.id, v_order.status, v_ticket_id;
end;
$$;

revoke all on function private.fulfill_paid_order(
  text, uuid, text, text, text, text, text, text, text, text, text, text,
  bigint, bigint, bigint, text
) from public, anon, authenticated, service_role;
