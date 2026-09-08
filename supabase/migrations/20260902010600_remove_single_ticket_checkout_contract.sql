-- Forward-only Task 15 cleanup. Preserve cart guards and canonical eligibility.
-- Remove only its legacy digest alternative before dropping the obsolete helpers.

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
  ticket_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_event public.events;
  v_digest_items jsonb;
  v_item_count integer;
  v_item_snapshot_valid boolean;
  v_item_set_valid boolean;
  v_inventory_valid boolean;
  v_ticket_set_exact boolean;
  v_ticket_set_valid boolean;
  v_ticket_lifecycle_valid boolean;
  v_ticket_count bigint;
  v_invalidated boolean;
  v_ticket_mismatch boolean;
begin
  perform * from private.lock_payment_order(p_order_id);

  perform private.assert_payment_snapshot(
    p_stripe_event_id,
    p_order_id,
    p_checkout_session_id,
    p_payment_intent_id,
    p_mode,
    p_payment_status,
    p_currency,
    p_subtotal_minor,
    p_total_minor,
    p_application_fee_amount_minor,
    p_destination_account_id
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

  select orders.* into v_order
  from public.orders as orders
  where orders.id = p_order_id;

  select events.* into v_event
  from public.events as events
  where events.id = v_order.event_id;

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

  select
    count(*)::integer,
    jsonb_agg(
      jsonb_build_object(
        'order_item_id', items.id,
        'ticket_tier_id', items.ticket_tier_id,
        'tier_name', items.tier_name,
        'unit_amount_minor', items.unit_amount_minor,
        'quantity', items.quantity,
        'subtotal_minor', items.subtotal_minor,
        'currency', items.currency
      )
      order by items.ticket_tier_id
    )
  into v_item_count, v_digest_items
  from public.order_items as items
  where items.order_id = p_order_id;

  v_item_snapshot_valid :=
    v_order.stripe_checkout_request_digest = private.checkout_cart_request_digest(
      v_order.id,
      v_order.event_id,
      v_order.client_request_id,
      v_order.confirmation_token_hash,
      v_order.buyer_email,
      v_order.currency,
      v_order.subtotal_minor,
      v_order.application_fee_amount_minor,
      v_order.stripe_destination_account_id,
      v_order.checkout_expires_at,
      v_order.stripe_checkout_integration_identifier,
      v_digest_items
    );

  select
    count(*) > 0
      and coalesce(sum(items.quantity), 0)::bigint = v_order.quantity
      and coalesce(sum(items.subtotal_minor), 0)::bigint = v_order.subtotal_minor
      and bool_and(
        tiers.id is not null
        and tiers.event_id = v_order.event_id
        and items.currency = v_order.currency
        and items.quantity between 1 and 10
        and items.subtotal_minor::numeric
          = items.unit_amount_minor::numeric * items.quantity::numeric
      )
      and v_event.id = v_order.event_id
      and v_event.organizer_id = v_order.organizer_id
  into v_item_set_valid
  from public.order_items as items
  left join public.ticket_tiers as tiers on tiers.id = items.ticket_tier_id
  where items.order_id = p_order_id;

  v_item_set_valid := coalesce(v_item_set_valid, false)
    and coalesce(v_item_snapshot_valid, false);

  select not exists (
    select 1
    from public.order_items as current_items
    join public.ticket_tiers as current_tiers
      on current_tiers.id = current_items.ticket_tier_id
    where current_items.order_id = p_order_id
      and (
        select coalesce(sum(other_items.quantity), 0)::bigint
        from public.order_items as other_items
        join public.orders as other_orders on other_orders.id = other_items.order_id
        where other_items.ticket_tier_id = current_items.ticket_tier_id
          and other_orders.id <> p_order_id
          and (
            other_orders.status in (
              'paid', 'payment_processing', 'requires_review', 'partially_refunded'
            )
            or (
              other_orders.status in ('creating_checkout', 'checkout_open')
              and other_orders.reservation_expires_at > statement_timestamp()
            )
          )
      ) + current_items.quantity > current_tiers.quantity_total
  ) into v_inventory_valid;

  select
    count(*)::bigint,
    count(*)::bigint = v_order.quantity
      and not exists (
        select 1
        from public.order_items as expected_items
        cross join lateral generate_series(
          1,
          expected_items.quantity
        ) as expected_sequences(unit_sequence)
        where expected_items.order_id = p_order_id
          and not exists (
            select 1
            from public.tickets as expected_ticket
            where expected_ticket.order_id = p_order_id
              and expected_ticket.order_item_id = expected_items.id
              and expected_ticket.unit_sequence = expected_sequences.unit_sequence
              and expected_ticket.event_id = v_order.event_id
              and expected_ticket.organizer_id = v_order.organizer_id
              and expected_ticket.ticket_tier_id = expected_items.ticket_tier_id
          )
      )
      and not exists (
        select 1
        from public.tickets as actual_ticket
        left join public.order_items as actual_item
          on actual_item.id = actual_ticket.order_item_id
          and actual_item.order_id = p_order_id
        where actual_ticket.order_id = p_order_id
          and (
            actual_item.id is null
            or actual_ticket.unit_sequence < 1
            or actual_ticket.unit_sequence > actual_item.quantity
            or actual_ticket.event_id <> v_order.event_id
            or actual_ticket.organizer_id <> v_order.organizer_id
            or actual_ticket.ticket_tier_id <> actual_item.ticket_tier_id
          )
      ),
    coalesce(bool_and(
      tickets.status = 'valid'
      and tickets.refunded_at is null
      and tickets.cancelled_at is null
    ), false)
  into v_ticket_count, v_ticket_set_exact, v_ticket_set_valid
  from public.tickets as tickets
  where tickets.order_id = p_order_id;

  -- Valid admission is coherent only for a fully paid order. Pre-payment
  -- states require no ticket history; review, refund, and invalidated terminal
  -- states may retain history but never a still-valid admission.
  v_ticket_lifecycle_valid := case
    when v_order.status = 'paid' then
      coalesce(v_ticket_set_exact, false)
        and coalesce(v_ticket_set_valid, false)
    when v_order.status in (
      'creating_checkout', 'checkout_open', 'payment_processing'
    ) then
      v_ticket_count = 0
    when v_order.status in (
      'expired', 'payment_failed', 'cancelled', 'partially_refunded',
      'refunded', 'requires_review'
    ) then
      not exists (
        select 1
        from public.tickets as lifecycle_ticket
        where lifecycle_ticket.order_id = p_order_id
          and lifecycle_ticket.status = 'valid'
      )
    else false
  end;

  v_ticket_mismatch := not v_item_set_valid
    or (
      v_ticket_count > 0
      and not coalesce(v_ticket_set_exact, false)
    )
    or not coalesce(v_ticket_lifecycle_valid, false);

  if v_ticket_mismatch then
    update public.orders as orders
    set stripe_payment_intent_id = coalesce(
          orders.stripe_payment_intent_id,
          p_payment_intent_id
        ),
        stripe_charge_id = coalesce(orders.stripe_charge_id, p_charge_id),
        stripe_transfer_id = coalesce(orders.stripe_transfer_id, p_transfer_id),
        stripe_application_fee_id = coalesce(
          orders.stripe_application_fee_id,
          p_application_fee_id
        ),
        stripe_balance_transaction_id = coalesce(
          orders.stripe_balance_transaction_id,
          p_balance_transaction_id
        ),
        stripe_customer_id = coalesce(orders.stripe_customer_id, p_customer_id),
        paid_at = coalesce(orders.paid_at, statement_timestamp()),
        status = case
          when orders.status = 'refunded' then 'refunded'
          else 'requires_review'
        end,
        reconciliation_status = 'requires_review',
        failure_code = 'TICKET_SET_MISMATCH',
        last_stripe_event_id = p_stripe_event_id
    where orders.id = p_order_id
    returning orders.* into v_order;

    update public.tickets as tickets
    set status = 'cancelled',
        cancelled_at = coalesce(tickets.cancelled_at, statement_timestamp()),
        refunded_at = null
    where tickets.order_id = p_order_id
      and tickets.status = 'valid';

    update public.stripe_webhook_events as receipts
    set processing_status = 'processed',
        processed_at = coalesce(receipts.processed_at, statement_timestamp()),
        error_code = 'TICKET_SET_MISMATCH'
    where receipts.stripe_event_id = p_stripe_event_id;

    select count(*)::bigint into v_ticket_count
    from public.tickets as tickets
    where tickets.order_id = p_order_id;

    return query select v_order.id, v_order.status, v_ticket_count;
    return;
  end if;

  if v_order.status in ('paid', 'partially_refunded', 'refunded', 'requires_review') then
    update public.stripe_webhook_events as receipts
    set processing_status = 'processed',
        processed_at = coalesce(receipts.processed_at, statement_timestamp()),
        error_code = null
    where receipts.stripe_event_id = p_stripe_event_id;

    return query select v_order.id, v_order.status, v_ticket_count;
    return;
  end if;

  v_invalidated :=
    v_order.status in ('expired', 'payment_failed', 'cancelled')
    or (
      v_order.status in ('creating_checkout', 'checkout_open')
      and v_order.reservation_expires_at <= statement_timestamp()
    )
    or not private.event_has_current_public_eligibility(v_event.id)
    or v_event.admission_type is distinct from 'paid'
    or exists (
      select 1
      from public.order_items as items
      join public.ticket_tiers as tiers on tiers.id = items.ticket_tier_id
      where items.order_id = p_order_id
        and (
          tiers.status is distinct from 'active'
          or tiers.event_id is distinct from v_event.id
        )
    )
    or not coalesce(v_inventory_valid, false);

  if not v_invalidated and v_ticket_count = 0 then
    insert into public.tickets (
      order_id,
      order_item_id,
      event_id,
      organizer_id,
      ticket_tier_id,
      unit_sequence
    )
    select
      p_order_id,
      items.id,
      v_order.event_id,
      v_order.organizer_id,
      items.ticket_tier_id,
      sequences.unit_sequence
    from public.order_items as items
    cross join lateral generate_series(1, items.quantity)
      as sequences(unit_sequence)
    where items.order_id = p_order_id
    order by items.ticket_tier_id, items.id, sequences.unit_sequence;

    select
      count(*)::bigint,
      count(*)::bigint = v_order.quantity
        and not exists (
          select 1
          from public.order_items as expected_items
          cross join lateral generate_series(
            1,
            expected_items.quantity
          ) as expected_sequences(unit_sequence)
          where expected_items.order_id = p_order_id
            and not exists (
              select 1
              from public.tickets as expected_ticket
              where expected_ticket.order_id = p_order_id
                and expected_ticket.order_item_id = expected_items.id
                and expected_ticket.unit_sequence = expected_sequences.unit_sequence
                and expected_ticket.event_id = v_order.event_id
                and expected_ticket.organizer_id = v_order.organizer_id
                and expected_ticket.ticket_tier_id = expected_items.ticket_tier_id
                and expected_ticket.status = 'valid'
                and expected_ticket.refunded_at is null
                and expected_ticket.cancelled_at is null
            )
        )
        and not exists (
          select 1
          from public.tickets as actual_ticket
          left join public.order_items as actual_item
            on actual_item.id = actual_ticket.order_item_id
            and actual_item.order_id = p_order_id
          where actual_ticket.order_id = p_order_id
            and (
              actual_item.id is null
              or actual_ticket.unit_sequence < 1
              or actual_ticket.unit_sequence > actual_item.quantity
              or actual_ticket.event_id <> v_order.event_id
              or actual_ticket.organizer_id <> v_order.organizer_id
              or actual_ticket.ticket_tier_id <> actual_item.ticket_tier_id
              or actual_ticket.status <> 'valid'
              or actual_ticket.refunded_at is not null
              or actual_ticket.cancelled_at is not null
            )
        )
    into v_ticket_count, v_ticket_set_exact
    from public.tickets as tickets
    where tickets.order_id = p_order_id;

    if not coalesce(v_ticket_set_exact, false) then
      raise exception using errcode = 'P0001', message = 'TICKET_GENERATION_FAILED';
    end if;
  end if;

  update public.orders as orders
  set stripe_payment_intent_id = coalesce(
        orders.stripe_payment_intent_id,
        p_payment_intent_id
      ),
      stripe_charge_id = coalesce(orders.stripe_charge_id, p_charge_id),
      stripe_transfer_id = coalesce(orders.stripe_transfer_id, p_transfer_id),
      stripe_application_fee_id = coalesce(
        orders.stripe_application_fee_id,
        p_application_fee_id
      ),
      stripe_balance_transaction_id = coalesce(
        orders.stripe_balance_transaction_id,
        p_balance_transaction_id
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

  update public.stripe_webhook_events as receipts
  set processing_status = 'processed',
      processed_at = coalesce(receipts.processed_at, statement_timestamp()),
      error_code = null
  where receipts.stripe_event_id = p_stripe_event_id;

  select count(*)::bigint into v_ticket_count
  from public.tickets as tickets
  where tickets.order_id = p_order_id;

  return query select v_order.id, v_order.status, v_ticket_count;
end;
$$;

revoke all on function private.fulfill_paid_order(
  text, uuid, text, text, text, text, text, text, text, text, text, text,
  bigint, bigint, bigint, text
) from public, anon, authenticated, service_role;

-- Public wrappers precede private implementations. No table or history changes.
drop function public.server_reserve_checkout(uuid, uuid, text, text, uuid, text);
drop function private.reserve_checkout(uuid, uuid, text, text, uuid, text);
drop function private.checkout_reservation_v1(uuid, uuid, text, text, uuid, text);
drop function public.server_get_checkout_preflight(uuid, uuid);
drop function private.get_checkout_preflight(uuid, uuid);
drop function private.checkout_request_digest(uuid, uuid, uuid, uuid, text, text, text, bigint, bigint, text, timestamptz, text);
drop function public.server_get_webhook_order_snapshot(uuid, text);
drop function private.get_webhook_order_snapshot(uuid, text);
drop function public.server_get_webhook_payment_order_snapshot(uuid);
drop function private.get_webhook_payment_order_snapshot(uuid);
drop function public.server_lookup_order_confirmation(text);
drop function private.lookup_order_confirmation(text);
drop function private.order_confirmation_status(text);
