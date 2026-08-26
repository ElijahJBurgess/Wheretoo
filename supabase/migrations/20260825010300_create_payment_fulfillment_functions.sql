create or replace function private.record_webhook_receipt(
  p_stripe_event_id text,
  p_event_type text,
  p_livemode boolean,
  p_stripe_object_id text,
  p_api_version text,
  p_stripe_created_at timestamptz,
  p_payload_sha256 text
)
returns table (
  should_process boolean,
  processing_status text,
  delivery_attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt public.stripe_webhook_events;
  v_inserted_count integer;
begin
  if p_livemode is distinct from false then
    raise exception using errcode = 'P0001', message = 'LIVE_MODE_FORBIDDEN';
  end if;

  if p_stripe_event_id is null
    or p_stripe_event_id !~ '^evt_[a-z0-9]+$'
    or p_event_type is null
    or p_event_type <> lower(btrim(p_event_type))
    or char_length(p_event_type) not between 3 and 160
    or p_stripe_object_id is null
    or p_stripe_object_id <> lower(btrim(p_stripe_object_id))
    or p_stripe_object_id !~ '^[a-z][a-z0-9_]*$'
    or p_stripe_created_at is null
    or p_payload_sha256 is null
    or p_payload_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = 'P0001', message = 'WEBHOOK_RECEIPT_INVALID';
  end if;

  insert into public.stripe_webhook_events (
    stripe_event_id,
    event_type,
    livemode,
    stripe_object_id,
    api_version,
    stripe_created_at,
    payload_sha256
  )
  values (
    p_stripe_event_id,
    p_event_type,
    false,
    p_stripe_object_id,
    p_api_version,
    p_stripe_created_at,
    p_payload_sha256
  )
  on conflict (stripe_event_id) do nothing;

  get diagnostics v_inserted_count = row_count;

  select receipts.* into v_receipt
  from public.stripe_webhook_events as receipts
  where receipts.stripe_event_id = p_stripe_event_id
  for update;

  if v_receipt.event_type is distinct from p_event_type
    or v_receipt.livemode is distinct from false
    or v_receipt.stripe_object_id is distinct from p_stripe_object_id
    or v_receipt.api_version is distinct from p_api_version
    or v_receipt.stripe_created_at is distinct from p_stripe_created_at
    or v_receipt.payload_sha256 is distinct from p_payload_sha256 then
    raise exception using errcode = 'P0001', message = 'WEBHOOK_EVENT_MISMATCH';
  end if;

  if v_inserted_count = 1 then
    return query select true, v_receipt.processing_status, v_receipt.delivery_attempt_count;
    return;
  end if;

  update public.stripe_webhook_events as receipts
  set delivery_attempt_count = receipts.delivery_attempt_count + 1,
      last_received_at = statement_timestamp(),
      processing_status = case
        when receipts.processing_status = 'processed' then 'processed'
        else 'processing'
      end,
      error_code = case
        when receipts.processing_status = 'processed' then receipts.error_code
        else null
      end
  where receipts.stripe_event_id = p_stripe_event_id
  returning receipts.* into v_receipt;

  return query
  select
    v_receipt.processing_status <> 'processed',
    v_receipt.processing_status,
    v_receipt.delivery_attempt_count;
end;
$$;

create or replace function private.lock_payment_order(p_order_id uuid)
returns table (
  event_id uuid,
  organizer_id uuid,
  ticket_tier_id uuid,
  order_item_id uuid,
  quantity integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_discovered_event_id uuid;
  v_discovered_tier_id uuid;
  v_event_id uuid;
  v_organizer_id uuid;
  v_ticket_tier_id uuid;
  v_order_item_id uuid;
  v_quantity integer;
begin
  select orders.event_id, items.ticket_tier_id
  into v_discovered_event_id, v_discovered_tier_id
  from public.orders as orders
  join public.order_items as items on items.order_id = orders.id
  where orders.id = p_order_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_FOUND';
  end if;

  -- Unlocked reads above discover the lock set. Every paid-event transaction then uses
  -- event advisory -> tiers by stable ID -> event -> order.
  perform public.lock_event_ticketing_operation(v_discovered_event_id);

  perform tiers.id
  from public.ticket_tiers as tiers
  where tiers.id = v_discovered_tier_id
  order by tiers.id
  for update;

  perform events.id
  from public.events as events
  where events.id = v_discovered_event_id
  for update;

  perform orders.id
  from public.orders as orders
  where orders.id = p_order_id
  for update;

  select
    orders.event_id,
    orders.organizer_id,
    items.ticket_tier_id,
    items.id,
    items.quantity
  into
    v_event_id,
    v_organizer_id,
    v_ticket_tier_id,
    v_order_item_id,
    v_quantity
  from public.orders as orders
  join public.order_items as items on items.order_id = orders.id
  where orders.id = p_order_id;

  if not found
    or v_event_id is distinct from v_discovered_event_id
    or v_ticket_tier_id is distinct from v_discovered_tier_id then
    raise exception using errcode = 'P0001', message = 'ORDER_CHANGED_RETRY';
  end if;

  return query
  select v_event_id, v_organizer_id, v_ticket_tier_id, v_order_item_id, v_quantity;
end;
$$;

create or replace function private.assert_payment_snapshot(
  p_stripe_event_id text,
  p_order_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_mode text,
  p_payment_status text,
  p_currency text,
  p_subtotal_minor bigint,
  p_total_minor bigint,
  p_application_fee_amount_minor bigint,
  p_destination_account_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_receipt public.stripe_webhook_events;
  v_destination text;
begin
  select orders.* into v_order
  from public.orders as orders
  where orders.id = p_order_id;

  select receipts.* into v_receipt
  from public.stripe_webhook_events as receipts
  where receipts.stripe_event_id = p_stripe_event_id
  for update;

  if not found
    or v_receipt.livemode
    or v_receipt.stripe_object_id is distinct from p_checkout_session_id then
    raise exception using errcode = 'P0001', message = 'WEBHOOK_RECEIPT_MISMATCH';
  end if;

  select accounts.stripe_account_id into v_destination
  from public.organizer_stripe_accounts as accounts
  where accounts.organizer_id = v_order.organizer_id
    and accounts.livemode = false;

  if v_order.id is null
    or v_order.livemode
    or v_order.stripe_checkout_session_id is distinct from p_checkout_session_id
    or (
      v_order.stripe_payment_intent_id is not null
      and v_order.stripe_payment_intent_id is distinct from p_payment_intent_id
    )
    or p_mode is distinct from 'payment'
    or p_payment_status not in ('paid', 'unpaid')
    or v_order.currency is distinct from p_currency
    or v_order.subtotal_minor is distinct from p_subtotal_minor
    or v_order.total_minor is distinct from p_total_minor
    or v_order.application_fee_amount_minor is distinct from p_application_fee_amount_minor
    or v_destination is distinct from p_destination_account_id then
    raise exception using errcode = 'P0001', message = 'PAYMENT_SNAPSHOT_MISMATCH';
  end if;
end;
$$;

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

  if v_order.stripe_charge_id is not null
    and v_order.stripe_charge_id is distinct from p_charge_id
    or v_order.stripe_transfer_id is not null
      and v_order.stripe_transfer_id is distinct from p_transfer_id
    or v_order.stripe_application_fee_id is not null
      and v_order.stripe_application_fee_id is distinct from p_application_fee_id
    or v_order.stripe_balance_transaction_id is not null
      and v_order.stripe_balance_transaction_id is distinct from p_balance_transaction_id
    or v_order.stripe_customer_id is not null
      and v_order.stripe_customer_id is distinct from p_customer_id then
    raise exception using errcode = 'P0001', message = 'PAYMENT_SNAPSHOT_MISMATCH';
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
      status = case
        when orders.status in ('partially_refunded', 'refunded', 'requires_review')
          then orders.status
        when v_invalidated then 'requires_review'
        else 'paid'
      end,
      reconciliation_status = case
        when orders.status = 'requires_review' or v_invalidated then 'requires_review'
        else 'reconciled'
      end,
      failure_code = case
        when orders.status = 'requires_review' then orders.failure_code
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

create or replace function private.mark_payment_processing(
  p_stripe_event_id text,
  p_order_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_mode text,
  p_payment_status text,
  p_currency text,
  p_subtotal_minor bigint,
  p_total_minor bigint,
  p_application_fee_amount_minor bigint,
  p_destination_account_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  perform * from private.lock_payment_order(p_order_id);
  perform private.assert_payment_snapshot(
    p_stripe_event_id, p_order_id, p_checkout_session_id, p_payment_intent_id,
    p_mode, p_payment_status, p_currency, p_subtotal_minor, p_total_minor,
    p_application_fee_amount_minor, p_destination_account_id
  );

  if p_payment_status is distinct from 'unpaid' then
    raise exception using errcode = 'P0001', message = 'PAYMENT_STATUS_INVALID';
  end if;

  select orders.* into v_order from public.orders as orders where orders.id = p_order_id;

  if v_order.status in ('creating_checkout', 'checkout_open', 'payment_processing') then
    update public.orders as orders
    set status = 'payment_processing',
        stripe_payment_intent_id = coalesce(
          orders.stripe_payment_intent_id, p_payment_intent_id
        ),
        last_stripe_event_id = p_stripe_event_id,
        reconciliation_status = 'pending',
        failure_code = null
    where orders.id = p_order_id;
  end if;

  update public.stripe_webhook_events as receipts
  set processing_status = 'processed',
      processed_at = coalesce(receipts.processed_at, statement_timestamp()),
      error_code = null
  where receipts.stripe_event_id = p_stripe_event_id;

  return p_order_id;
end;
$$;

create or replace function private.mark_payment_failed(
  p_stripe_event_id text,
  p_order_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_mode text,
  p_payment_status text,
  p_currency text,
  p_subtotal_minor bigint,
  p_total_minor bigint,
  p_application_fee_amount_minor bigint,
  p_destination_account_id text,
  p_failure_code text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_failure_code text := upper(btrim(p_failure_code));
begin
  perform * from private.lock_payment_order(p_order_id);
  perform private.assert_payment_snapshot(
    p_stripe_event_id, p_order_id, p_checkout_session_id, p_payment_intent_id,
    p_mode, p_payment_status, p_currency, p_subtotal_minor, p_total_minor,
    p_application_fee_amount_minor, p_destination_account_id
  );

  if p_payment_status is distinct from 'unpaid'
    or v_failure_code is null
    or char_length(v_failure_code) not between 1 and 255 then
    raise exception using errcode = 'P0001', message = 'PAYMENT_FAILURE_INVALID';
  end if;

  select orders.* into v_order from public.orders as orders where orders.id = p_order_id;

  if v_order.status in ('creating_checkout', 'checkout_open', 'payment_processing') then
    update public.orders as orders
    set status = 'payment_failed',
        failed_at = coalesce(orders.failed_at, statement_timestamp()),
        stripe_payment_intent_id = coalesce(
          orders.stripe_payment_intent_id, p_payment_intent_id
        ),
        last_stripe_event_id = p_stripe_event_id,
        reconciliation_status = 'reconciled',
        failure_code = coalesce(orders.failure_code, v_failure_code)
    where orders.id = p_order_id;
  end if;

  update public.stripe_webhook_events as receipts
  set processing_status = 'processed',
      processed_at = coalesce(receipts.processed_at, statement_timestamp()),
      error_code = null
  where receipts.stripe_event_id = p_stripe_event_id;

  return p_order_id;
end;
$$;

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

  if found and (
    v_refund.order_id is distinct from p_order_id
    or v_refund.amount_minor is distinct from p_amount_minor
    or v_refund.currency is distinct from p_currency
    or v_refund.reverse_transfer is distinct from p_reverse_transfer
    or v_refund.refund_application_fee is distinct from p_refund_application_fee
  ) then
    raise exception using errcode = 'P0001', message = 'REFUND_SNAPSHOT_MISMATCH';
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
  set status = case
        when public.refunds.status = 'succeeded' then 'succeeded'
        else excluded.status
      end,
      reason = coalesce(public.refunds.reason, excluded.reason),
      stripe_event_id = excluded.stripe_event_id,
      processed_at = case
        when (
          case
            when public.refunds.status = 'succeeded' then 'succeeded'
            else excluded.status
          end
        ) in ('succeeded', 'failed', 'cancelled')
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

    -- Day 2 sells one admission per order. Any successful partial refund therefore
    -- invalidates that admission conservatively while retaining its history.
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

create or replace function private.apply_dispute(
  p_stripe_event_id text,
  p_order_id uuid,
  p_stripe_dispute_id text,
  p_charge_id text,
  p_status text,
  p_amount_minor bigint,
  p_currency text,
  p_recovery_status text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_receipt public.stripe_webhook_events;
  v_failure_code text;
begin
  perform * from private.lock_payment_order(p_order_id);
  select orders.* into v_order from public.orders as orders where orders.id = p_order_id;
  select receipts.* into v_receipt
  from public.stripe_webhook_events as receipts
  where receipts.stripe_event_id = p_stripe_event_id
  for update;

  if not found
    or v_receipt.livemode
    or v_receipt.stripe_object_id is distinct from p_stripe_dispute_id
    or p_stripe_dispute_id is null
    or p_stripe_dispute_id !~ '^dp_[a-z0-9]+$'
    or v_order.paid_at is null
    or v_order.stripe_charge_id is distinct from p_charge_id
    or p_currency is distinct from v_order.currency
    or p_amount_minor is null
    or p_amount_minor <= 0
    or p_amount_minor > v_order.total_minor
    or p_status not in (
      'warning_needs_response', 'warning_under_review', 'warning_closed',
      'needs_response', 'under_review', 'won', 'lost'
    )
    or p_recovery_status not in ('not_attempted', 'succeeded', 'failed') then
    raise exception using errcode = 'P0001', message = 'DISPUTE_SNAPSHOT_MISMATCH';
  end if;

  v_failure_code := 'DISPUTE_' || upper(p_status) || '_RECOVERY_' || upper(p_recovery_status);

  update public.orders as orders
  set status = case when orders.status = 'refunded' then 'refunded' else 'requires_review' end,
      reconciliation_status = 'requires_review',
      failure_code = v_failure_code,
      last_stripe_event_id = p_stripe_event_id
  where orders.id = p_order_id;

  update public.tickets as tickets
  set status = 'cancelled',
      cancelled_at = coalesce(tickets.cancelled_at, statement_timestamp()),
      refunded_at = null
  where tickets.order_id = p_order_id
    and tickets.status = 'valid';

  update public.stripe_webhook_events as receipts
  set processing_status = 'processed',
      processed_at = coalesce(receipts.processed_at, statement_timestamp()),
      error_code = null
  where receipts.stripe_event_id = p_stripe_event_id;

  return p_order_id;
end;
$$;

create or replace function public.server_record_webhook_receipt(
  p_stripe_event_id text,
  p_event_type text,
  p_livemode boolean,
  p_stripe_object_id text,
  p_api_version text,
  p_stripe_created_at timestamptz,
  p_payload_sha256 text
)
returns table (
  should_process boolean,
  processing_status text,
  delivery_attempt_count integer
)
language sql
security definer
set search_path = ''
as $$
  select * from private.record_webhook_receipt(
    p_stripe_event_id, p_event_type, p_livemode, p_stripe_object_id,
    p_api_version, p_stripe_created_at, p_payload_sha256
  );
$$;

create or replace function public.server_fulfill_paid_order(
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
returns table (order_id uuid, order_status text, ticket_id uuid)
language sql
security definer
set search_path = ''
as $$
  select * from private.fulfill_paid_order(
    p_stripe_event_id, p_order_id, p_checkout_session_id, p_payment_intent_id,
    p_charge_id, p_transfer_id, p_application_fee_id, p_balance_transaction_id,
    p_customer_id, p_mode, p_payment_status, p_currency, p_subtotal_minor,
    p_total_minor, p_application_fee_amount_minor, p_destination_account_id
  );
$$;

create or replace function public.server_mark_payment_processing(
  p_stripe_event_id text,
  p_order_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_mode text,
  p_payment_status text,
  p_currency text,
  p_subtotal_minor bigint,
  p_total_minor bigint,
  p_application_fee_amount_minor bigint,
  p_destination_account_id text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.mark_payment_processing(
    p_stripe_event_id, p_order_id, p_checkout_session_id, p_payment_intent_id,
    p_mode, p_payment_status, p_currency, p_subtotal_minor, p_total_minor,
    p_application_fee_amount_minor, p_destination_account_id
  );
$$;

create or replace function public.server_mark_payment_failed(
  p_stripe_event_id text,
  p_order_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_mode text,
  p_payment_status text,
  p_currency text,
  p_subtotal_minor bigint,
  p_total_minor bigint,
  p_application_fee_amount_minor bigint,
  p_destination_account_id text,
  p_failure_code text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.mark_payment_failed(
    p_stripe_event_id, p_order_id, p_checkout_session_id, p_payment_intent_id,
    p_mode, p_payment_status, p_currency, p_subtotal_minor, p_total_minor,
    p_application_fee_amount_minor, p_destination_account_id, p_failure_code
  );
$$;

create or replace function public.server_apply_refund(
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
returns table (order_id uuid, order_status text, ticket_status text)
language sql
security definer
set search_path = ''
as $$
  select * from private.apply_refund(
    p_stripe_event_id, p_order_id, p_stripe_refund_id, p_amount_minor,
    p_currency, p_status, p_reason, p_reverse_transfer, p_refund_application_fee
  );
$$;

create or replace function public.server_apply_dispute(
  p_stripe_event_id text,
  p_order_id uuid,
  p_stripe_dispute_id text,
  p_charge_id text,
  p_status text,
  p_amount_minor bigint,
  p_currency text,
  p_recovery_status text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.apply_dispute(
    p_stripe_event_id, p_order_id, p_stripe_dispute_id, p_charge_id,
    p_status, p_amount_minor, p_currency, p_recovery_status
  );
$$;

revoke all on function private.record_webhook_receipt(
  text, text, boolean, text, text, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function private.lock_payment_order(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.assert_payment_snapshot(
  text, uuid, text, text, text, text, text, bigint, bigint, bigint, text
) from public, anon, authenticated, service_role;
revoke all on function private.fulfill_paid_order(
  text, uuid, text, text, text, text, text, text, text, text, text, text,
  bigint, bigint, bigint, text
) from public, anon, authenticated, service_role;
revoke all on function private.mark_payment_processing(
  text, uuid, text, text, text, text, text, bigint, bigint, bigint, text
) from public, anon, authenticated, service_role;
revoke all on function private.mark_payment_failed(
  text, uuid, text, text, text, text, text, bigint, bigint, bigint, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.apply_refund(
  text, uuid, text, bigint, text, text, text, boolean, boolean
) from public, anon, authenticated, service_role;
revoke all on function private.apply_dispute(
  text, uuid, text, text, text, bigint, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.server_record_webhook_receipt(
  text, text, boolean, text, text, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function public.server_fulfill_paid_order(
  text, uuid, text, text, text, text, text, text, text, text, text, text,
  bigint, bigint, bigint, text
) from public, anon, authenticated, service_role;
revoke all on function public.server_mark_payment_processing(
  text, uuid, text, text, text, text, text, bigint, bigint, bigint, text
) from public, anon, authenticated, service_role;
revoke all on function public.server_mark_payment_failed(
  text, uuid, text, text, text, text, text, bigint, bigint, bigint, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.server_apply_refund(
  text, uuid, text, bigint, text, text, text, boolean, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.server_apply_dispute(
  text, uuid, text, text, text, bigint, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.server_record_webhook_receipt(
  text, text, boolean, text, text, timestamptz, text
) to service_role;
grant execute on function public.server_fulfill_paid_order(
  text, uuid, text, text, text, text, text, text, text, text, text, text,
  bigint, bigint, bigint, text
) to service_role;
grant execute on function public.server_mark_payment_processing(
  text, uuid, text, text, text, text, text, bigint, bigint, bigint, text
) to service_role;
grant execute on function public.server_mark_payment_failed(
  text, uuid, text, text, text, text, text, bigint, bigint, bigint, text, text
) to service_role;
grant execute on function public.server_apply_refund(
  text, uuid, text, bigint, text, text, text, boolean, boolean
) to service_role;
grant execute on function public.server_apply_dispute(
  text, uuid, text, text, text, bigint, text, text
) to service_role;
