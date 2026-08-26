alter table public.organizer_stripe_accounts
  add column last_sync_revision text,
  add constraint organizer_stripe_accounts_last_sync_revision_check check (
    last_sync_revision is null
    or last_sync_revision ~ '^evt_[A-Za-z0-9]+$'
  );

alter table public.refunds
  add column stripe_transfer_reversal_id text,
  add column stripe_application_fee_refund_id text,
  add constraint refunds_transfer_reversal_id_check check (
    stripe_transfer_reversal_id is null
    or stripe_transfer_reversal_id ~ '^trr_[A-Za-z0-9]+$'
  ),
  add constraint refunds_application_fee_refund_id_check check (
    stripe_application_fee_refund_id is null
    or stripe_application_fee_refund_id ~ '^fr_[A-Za-z0-9]+$'
  ),
  add constraint refunds_transfer_reversal_id_key unique (stripe_transfer_reversal_id),
  add constraint refunds_application_fee_refund_id_key unique (stripe_application_fee_refund_id);

alter table public.disputes
  add column stripe_payment_intent_id text,
  add column stripe_transfer_reversal_id text,
  add constraint disputes_payment_intent_id_check check (
    stripe_payment_intent_id is null
    or stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]+$'
  ),
  add constraint disputes_transfer_reversal_id_check check (
    stripe_transfer_reversal_id is null
    or stripe_transfer_reversal_id ~ '^trr_[A-Za-z0-9]+$'
  ),
  add constraint disputes_transfer_reversal_id_key unique (stripe_transfer_reversal_id),
  drop constraint disputes_recovery_status_check,
  add constraint disputes_recovery_status_check check (
    recovery_status in (
      'not_attempted', 'not_applicable', 'failed', 'succeeded', 'recovered'
    )
  );

create function private.get_webhook_payment_order_snapshot(p_order_id uuid)
returns table (
  order_id uuid,
  checkout_session_id text,
  event_id uuid,
  tier_id uuid,
  currency text,
  subtotal_minor bigint,
  total_minor bigint,
  application_fee_amount_minor bigint,
  destination_account_id text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    orders.id,
    orders.stripe_checkout_session_id,
    orders.event_id,
    items.ticket_tier_id,
    orders.currency,
    orders.subtotal_minor,
    orders.total_minor,
    orders.application_fee_amount_minor,
    orders.stripe_destination_account_id
  from public.orders as orders
  join public.order_items as items on items.order_id = orders.id
  where orders.id = p_order_id
    and orders.livemode = false
    and orders.stripe_checkout_session_id is not null
    and items.quantity = 1;
$$;

create function public.server_get_webhook_payment_order_snapshot(p_order_id uuid)
returns table (
  order_id uuid,
  checkout_session_id text,
  event_id uuid,
  tier_id uuid,
  currency text,
  subtotal_minor bigint,
  total_minor bigint,
  application_fee_amount_minor bigint,
  destination_account_id text
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.get_webhook_payment_order_snapshot(p_order_id);
$$;

create function private.persist_connect_status_if_current(
  p_stripe_account_id text,
  p_retrieved_at timestamptz,
  p_revision text,
  p_transfers_status text,
  p_payouts_status text,
  p_requirements_status text,
  p_currently_due_count integer,
  p_past_due_count integer,
  p_last_status_code text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.organizer_stripe_accounts;
begin
  if p_stripe_account_id is null
    or p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$'
    or p_retrieved_at is null
    or p_revision is null
    or p_revision !~ '^evt_[A-Za-z0-9]+$'
    or p_transfers_status not in ('inactive', 'pending', 'active', 'restricted')
    or p_payouts_status not in ('inactive', 'pending', 'active', 'restricted')
    or p_requirements_status not in (
      'not_started', 'pending', 'action_required', 'restricted', 'clear'
    )
    or p_currently_due_count is null or p_currently_due_count < 0
    or p_past_due_count is null or p_past_due_count < 0
    or (
      p_last_status_code is not null
      and p_last_status_code !~ '^[A-Z][A-Z0-9_]{0,254}$'
    ) then
    raise exception using errcode = 'P0001', message = 'CONNECT_STATUS_INVALID';
  end if;

  select accounts.* into v_account
  from public.organizer_stripe_accounts as accounts
  where accounts.stripe_account_id = p_stripe_account_id
    and accounts.livemode = false
  for update;

  if not found then
    return 'not_found';
  end if;

  if (v_account.last_synced_at, coalesce(v_account.last_sync_revision, ''))
    > (p_retrieved_at, p_revision) then
    return 'stale';
  end if;

  update public.organizer_stripe_accounts as accounts
  set transfers_status = p_transfers_status,
      payouts_status = p_payouts_status,
      requirements_status = p_requirements_status,
      requirements_currently_due_count = p_currently_due_count,
      requirements_past_due_count = p_past_due_count,
      last_status_code = p_last_status_code,
      last_synced_at = p_retrieved_at,
      last_sync_revision = p_revision
  where accounts.organizer_id = v_account.organizer_id;

  return 'updated';
end;
$$;

create function public.server_persist_connect_status_if_current(
  p_stripe_account_id text,
  p_retrieved_at timestamptz,
  p_revision text,
  p_transfers_status text,
  p_payouts_status text,
  p_requirements_status text,
  p_currently_due_count integer,
  p_past_due_count integer,
  p_last_status_code text
)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.persist_connect_status_if_current(
    p_stripe_account_id, p_retrieved_at, p_revision,
    p_transfers_status, p_payouts_status, p_requirements_status,
    p_currently_due_count, p_past_due_count, p_last_status_code
  );
$$;

create function private.mark_payment_requires_review(
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
  v_lock record;
  v_order public.orders;
  v_receipt public.stripe_webhook_events;
  v_ticket_status text;
begin
  select * into v_lock from private.lock_payment_order(p_order_id);
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

create function public.server_mark_payment_requires_review(
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
language sql
security definer
set search_path = ''
as $$
  select * from private.mark_payment_requires_review(
    p_stripe_event_id, p_order_id, p_checkout_session_id, p_payment_intent_id,
    p_charge_id, p_transfer_id, p_application_fee_id, p_balance_transaction_id,
    p_customer_id, p_mode, p_payment_status, p_currency, p_subtotal_minor,
    p_total_minor, p_application_fee_amount_minor, p_destination_account_id,
    p_failure_code
  );
$$;

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
  p_refund_application_fee boolean
)
returns table (order_id uuid, order_status text, ticket_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_receipt public.stripe_webhook_events;
  v_refund public.refunds;
  v_successful_total bigint;
  v_ticket_status text;
  v_existing boolean;
  v_ignore boolean;
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
    or p_stripe_refund_id is null
    or p_stripe_refund_id !~ '^re_[A-Za-z0-9]+$'
    or p_payment_intent_id is null
    or p_payment_intent_id !~ '^pi_[A-Za-z0-9]+$'
    or p_charge_id is null
    or p_charge_id !~ '^ch_[A-Za-z0-9]+$'
    or p_amount_minor is null or p_amount_minor <= 0
    or p_currency is distinct from v_order.currency
    or p_status is null
    or p_status not in (
      'pending', 'requires_action', 'succeeded', 'failed', 'canceled', 'cancelled'
    )
    or p_reverse_transfer is distinct from true
    or p_refund_application_fee is null
    or (p_status = 'succeeded' and p_transfer_reversal_id is null)
    or (
      p_transfer_reversal_id is not null
      and p_transfer_reversal_id !~ '^trr_[A-Za-z0-9]+$'
    )
    or (
      p_refund_application_fee
      and p_status = 'succeeded'
      and p_application_fee_refund_id is null
    )
    or (
      not p_refund_application_fee
      and p_application_fee_refund_id is not null
    )
    or (
      p_application_fee_refund_id is not null
      and p_application_fee_refund_id !~ '^fr_[A-Za-z0-9]+$'
    )
    or (
      v_order.stripe_payment_intent_id is not null
      and v_order.stripe_payment_intent_id is distinct from p_payment_intent_id
    )
    or (
      v_order.stripe_charge_id is not null
      and v_order.stripe_charge_id is distinct from p_charge_id
    ) then
    raise exception using errcode = 'P0001', message = 'REFUND_SNAPSHOT_MISMATCH';
  end if;

  if exists (
    select 1 from public.orders as orders
    where orders.id <> p_order_id
      and (
        orders.stripe_payment_intent_id = p_payment_intent_id
        or orders.stripe_charge_id = p_charge_id
      )
  ) then
    raise exception using errcode = 'P0001', message = 'REFUND_SNAPSHOT_MISMATCH';
  end if;

  select refunds.* into v_refund
  from public.refunds as refunds
  where refunds.stripe_refund_id = p_stripe_refund_id
  for update;
  v_existing := found;

  if v_existing and (
    v_refund.order_id is distinct from p_order_id
    or v_refund.stripe_payment_intent_id is distinct from p_payment_intent_id
    or v_refund.stripe_charge_id is distinct from p_charge_id
    or v_refund.amount_minor is distinct from p_amount_minor
    or v_refund.currency is distinct from p_currency
    or v_refund.reverse_transfer is distinct from p_reverse_transfer
    or v_refund.refund_application_fee is distinct from p_refund_application_fee
    or (
      v_refund.stripe_transfer_reversal_id is not null
      and v_refund.stripe_transfer_reversal_id is distinct from p_transfer_reversal_id
    )
    or (
      v_refund.stripe_application_fee_refund_id is not null
      and v_refund.stripe_application_fee_refund_id
        is distinct from p_application_fee_refund_id
    )
  ) then
    raise exception using errcode = 'P0001', message = 'REFUND_SNAPSHOT_MISMATCH';
  end if;

  update public.orders as orders
  set stripe_payment_intent_id = coalesce(orders.stripe_payment_intent_id, p_payment_intent_id),
      stripe_charge_id = coalesce(orders.stripe_charge_id, p_charge_id)
  where orders.id = p_order_id;

  v_ignore := v_existing and (
    v_refund.status in ('succeeded', 'failed', 'canceled', 'cancelled')
    or v_refund.status = p_status
    or (v_refund.status = 'requires_action' and p_status = 'pending')
  );

  if not v_ignore then
    insert into public.refunds (
      stripe_refund_id, order_id, stripe_payment_intent_id, stripe_charge_id,
      stripe_transfer_reversal_id, stripe_application_fee_refund_id,
      amount_minor, currency, status, reason, reverse_transfer,
      refund_application_fee, stripe_event_id, processed_at
    ) values (
      p_stripe_refund_id, p_order_id, p_payment_intent_id, p_charge_id,
      p_transfer_reversal_id, p_application_fee_refund_id,
      p_amount_minor, p_currency, p_status, p_reason, true,
      p_refund_application_fee, p_stripe_event_id,
      case when p_status in ('succeeded', 'failed', 'canceled', 'cancelled')
        then statement_timestamp() else null end
    )
    on conflict (stripe_refund_id) do update
    set status = excluded.status,
        reason = coalesce(public.refunds.reason, excluded.reason),
        stripe_transfer_reversal_id = coalesce(
          public.refunds.stripe_transfer_reversal_id,
          excluded.stripe_transfer_reversal_id
        ),
        stripe_application_fee_refund_id = coalesce(
          public.refunds.stripe_application_fee_refund_id,
          excluded.stripe_application_fee_refund_id
        ),
        stripe_event_id = excluded.stripe_event_id,
        processed_at = case
          when excluded.status in ('succeeded', 'failed', 'canceled', 'cancelled')
            then coalesce(public.refunds.processed_at, statement_timestamp())
          else null
        end;
  end if;

  select coalesce(sum(refunds.amount_minor), 0)::bigint into v_successful_total
  from public.refunds as refunds
  where refunds.order_id = p_order_id and refunds.status = 'succeeded';
  if v_successful_total > v_order.total_minor then
    raise exception using errcode = 'P0001', message = 'REFUND_TOTAL_INVALID';
  end if;

  if v_successful_total = v_order.total_minor then
    update public.orders as orders
    set status = 'refunded',
        refunded_at = coalesce(orders.refunded_at, statement_timestamp()),
        reconciliation_status = case
          when orders.paid_at is null then 'requires_review' else 'reconciled'
        end,
        failure_code = case
          when orders.paid_at is null then 'REFUND_BEFORE_PAYMENT_RECONCILIATION'
          else null
        end,
        last_stripe_event_id = p_stripe_event_id
    where orders.id = p_order_id;
  elsif v_successful_total > 0 then
    update public.orders as orders
    set status = 'partially_refunded',
        reconciliation_status = case
          when orders.paid_at is null then 'requires_review' else 'reconciled'
        end,
        failure_code = case
          when orders.paid_at is null then 'REFUND_BEFORE_PAYMENT_RECONCILIATION'
          else orders.failure_code
        end,
        last_stripe_event_id = p_stripe_event_id
    where orders.id = p_order_id;
  elsif p_status in ('pending', 'requires_action') or v_order.paid_at is null then
    update public.orders as orders
    set status = 'requires_review',
        reconciliation_status = 'requires_review',
        failure_code = 'REFUND_REQUIRES_REVIEW',
        last_stripe_event_id = p_stripe_event_id
    where orders.id = p_order_id;
  end if;

  update public.tickets as tickets
  set status = 'refunded',
      refunded_at = coalesce(tickets.refunded_at, statement_timestamp()),
      cancelled_at = null
  where tickets.order_id = p_order_id
    and tickets.status = 'valid'
    and (v_successful_total > 0 or p_status in ('pending', 'requires_action'));

  update public.stripe_webhook_events as receipts
  set processing_status = 'processed',
      processed_at = coalesce(receipts.processed_at, statement_timestamp()),
      error_code = case when v_ignore then 'REFUND_STATE_IGNORED' else null end
  where receipts.stripe_event_id = p_stripe_event_id;

  select orders.* into v_order from public.orders as orders where orders.id = p_order_id;
  select tickets.status into v_ticket_status
  from public.tickets as tickets where tickets.order_id = p_order_id;
  return query select v_order.id, v_order.status, v_ticket_status;
end;
$$;

create function public.server_apply_verified_refund(
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
  p_refund_application_fee boolean
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
    p_reason, p_reverse_transfer, p_refund_application_fee
  );
$$;

create function private.apply_verified_dispute(
  p_stripe_event_id text,
  p_order_id uuid,
  p_stripe_dispute_id text,
  p_payment_intent_id text,
  p_charge_id text,
  p_transfer_reversal_id text,
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
  v_dispute public.disputes;
  v_existing boolean;
  v_status_valid boolean;
  v_status_changed boolean;
  v_recovery_changed boolean;
  v_existing_rank integer;
  v_incoming_rank integer;
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
    or p_stripe_dispute_id !~ '^(du|dp)_[A-Za-z0-9]+$'
    or p_payment_intent_id is null
    or p_payment_intent_id !~ '^pi_[A-Za-z0-9]+$'
    or p_charge_id is null
    or p_charge_id !~ '^ch_[A-Za-z0-9]+$'
    or p_status is null
    or p_status not in (
      'warning_needs_response', 'warning_under_review', 'warning_closed',
      'needs_response', 'under_review', 'won', 'lost', 'prevented'
    )
    or p_amount_minor is null or p_amount_minor <= 0
    or p_amount_minor > v_order.total_minor
    or p_currency is distinct from v_order.currency
    or p_recovery_status is null
    or p_recovery_status not in (
      'not_attempted', 'not_applicable', 'failed', 'recovered'
    )
    or (p_recovery_status = 'recovered' and p_transfer_reversal_id is null)
    or (
      p_recovery_status <> 'recovered' and p_transfer_reversal_id is not null
    )
    or (
      p_transfer_reversal_id is not null
      and p_transfer_reversal_id !~ '^trr_[A-Za-z0-9]+$'
    )
    or (
      v_order.stripe_payment_intent_id is not null
      and v_order.stripe_payment_intent_id is distinct from p_payment_intent_id
    )
    or (
      v_order.stripe_charge_id is not null
      and v_order.stripe_charge_id is distinct from p_charge_id
    ) then
    raise exception using errcode = 'P0001', message = 'DISPUTE_SNAPSHOT_MISMATCH';
  end if;

  if exists (
    select 1 from public.orders as orders
    where orders.id <> p_order_id
      and (
        orders.stripe_payment_intent_id = p_payment_intent_id
        or orders.stripe_charge_id = p_charge_id
      )
  ) then
    raise exception using errcode = 'P0001', message = 'DISPUTE_SNAPSHOT_MISMATCH';
  end if;

  update public.orders as orders
  set stripe_payment_intent_id = coalesce(orders.stripe_payment_intent_id, p_payment_intent_id),
      stripe_charge_id = coalesce(orders.stripe_charge_id, p_charge_id)
  where orders.id = p_order_id;

  select disputes.* into v_dispute
  from public.disputes as disputes
  where disputes.stripe_dispute_id = p_stripe_dispute_id
  for update;
  v_existing := found;

  if not v_existing then
    insert into public.disputes (
      stripe_dispute_id, order_id, stripe_payment_intent_id, stripe_charge_id,
      stripe_transfer_reversal_id, amount_minor, currency, status,
      recovery_status, first_stripe_event_id, last_stripe_event_id,
      first_stripe_event_created_at, last_stripe_event_created_at
    ) values (
      p_stripe_dispute_id, p_order_id, p_payment_intent_id, p_charge_id,
      p_transfer_reversal_id, p_amount_minor, p_currency, p_status,
      p_recovery_status, p_stripe_event_id, p_stripe_event_id,
      v_receipt.stripe_created_at, v_receipt.stripe_created_at
    );
    select disputes.* into v_dispute
    from public.disputes as disputes
    where disputes.stripe_dispute_id = p_stripe_dispute_id;
  else
    if v_dispute.order_id is distinct from p_order_id
      or v_dispute.stripe_payment_intent_id is distinct from p_payment_intent_id
      or v_dispute.stripe_charge_id is distinct from p_charge_id
      or v_dispute.amount_minor is distinct from p_amount_minor
      or v_dispute.currency is distinct from p_currency
      or (
        v_dispute.stripe_transfer_reversal_id is not null
        and p_transfer_reversal_id is not null
        and v_dispute.stripe_transfer_reversal_id is distinct from p_transfer_reversal_id
      ) then
      raise exception using errcode = 'P0001', message = 'DISPUTE_SNAPSHOT_MISMATCH';
    end if;

    v_status_valid := p_status = v_dispute.status
      or (v_dispute.status = 'warning_needs_response' and p_status in (
        'warning_under_review', 'warning_closed', 'needs_response',
        'under_review', 'won', 'lost', 'prevented'
      ))
      or (v_dispute.status = 'warning_under_review' and p_status in (
        'warning_closed', 'needs_response', 'under_review', 'won', 'lost', 'prevented'
      ))
      or (v_dispute.status = 'needs_response' and p_status in (
        'under_review', 'won', 'lost', 'prevented'
      ))
      or (v_dispute.status = 'under_review' and p_status in ('won', 'lost', 'prevented'))
      or (v_dispute.status = 'lost' and p_status = 'won');

    v_status_changed := v_status_valid
      and v_receipt.stripe_created_at >= v_dispute.last_stripe_event_created_at
      and p_status is distinct from v_dispute.status;
    v_existing_rank := case v_dispute.recovery_status
      when 'recovered' then 3 when 'succeeded' then 3
      when 'failed' then 2 when 'not_applicable' then 1 else 0 end;
    v_incoming_rank := case p_recovery_status
      when 'recovered' then 3 when 'failed' then 2
      when 'not_applicable' then 1 else 0 end;
    v_recovery_changed := v_incoming_rank > v_existing_rank
      or (v_incoming_rank = 3 and v_dispute.recovery_status = 'succeeded');

    if not v_status_changed and not v_recovery_changed then
      update public.stripe_webhook_events as receipts
      set processing_status = 'processed',
          processed_at = coalesce(receipts.processed_at, statement_timestamp()),
          error_code = 'DISPUTE_STATE_IGNORED'
      where receipts.stripe_event_id = p_stripe_event_id;
      return p_order_id;
    end if;

    update public.disputes as disputes
    set status = case when v_status_changed then p_status else disputes.status end,
        recovery_status = case
          when v_recovery_changed then p_recovery_status else disputes.recovery_status
        end,
        stripe_transfer_reversal_id = case
          when v_recovery_changed and p_transfer_reversal_id is not null
            then p_transfer_reversal_id
          else disputes.stripe_transfer_reversal_id
        end,
        last_stripe_event_id = case
          when v_status_valid
            and v_receipt.stripe_created_at >= disputes.last_stripe_event_created_at
            then p_stripe_event_id
          else disputes.last_stripe_event_id
        end,
        last_stripe_event_created_at = case
          when v_status_valid
            and v_receipt.stripe_created_at >= disputes.last_stripe_event_created_at
            then v_receipt.stripe_created_at
          else disputes.last_stripe_event_created_at
        end
    where disputes.stripe_dispute_id = p_stripe_dispute_id
    returning disputes.* into v_dispute;
  end if;

  update public.orders as orders
  set status = case when orders.status = 'refunded' then 'refunded' else 'requires_review' end,
      reconciliation_status = 'requires_review',
      failure_code = 'DISPUTE_' || upper(v_dispute.status)
        || '_RECOVERY_' || upper(v_dispute.recovery_status),
      last_stripe_event_id = p_stripe_event_id
  where orders.id = p_order_id;

  update public.tickets as tickets
  set status = 'cancelled',
      cancelled_at = coalesce(tickets.cancelled_at, statement_timestamp()),
      refunded_at = null
  where tickets.order_id = p_order_id and tickets.status = 'valid';

  update public.stripe_webhook_events as receipts
  set processing_status = 'processed',
      processed_at = coalesce(receipts.processed_at, statement_timestamp()),
      error_code = null
  where receipts.stripe_event_id = p_stripe_event_id;
  return p_order_id;
end;
$$;

create function public.server_apply_verified_dispute(
  p_stripe_event_id text,
  p_order_id uuid,
  p_stripe_dispute_id text,
  p_payment_intent_id text,
  p_charge_id text,
  p_transfer_reversal_id text,
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
  select private.apply_verified_dispute(
    p_stripe_event_id, p_order_id, p_stripe_dispute_id,
    p_payment_intent_id, p_charge_id, p_transfer_reversal_id,
    p_status, p_amount_minor, p_currency, p_recovery_status
  );
$$;

revoke all on function private.get_webhook_payment_order_snapshot(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.persist_connect_status_if_current(
  text, timestamptz, text, text, text, text, integer, integer, text
) from public, anon, authenticated, service_role;
revoke all on function private.mark_payment_requires_review(
  text, uuid, text, text, text, text, text, text, text, text, text, text,
  bigint, bigint, bigint, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.apply_verified_refund(
  text, uuid, text, text, text, text, text, bigint, text, text, text, boolean, boolean
) from public, anon, authenticated, service_role;
revoke all on function private.apply_verified_dispute(
  text, uuid, text, text, text, text, text, bigint, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.server_get_webhook_payment_order_snapshot(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.server_persist_connect_status_if_current(
  text, timestamptz, text, text, text, text, integer, integer, text
) from public, anon, authenticated, service_role;
revoke all on function public.server_mark_payment_requires_review(
  text, uuid, text, text, text, text, text, text, text, text, text, text,
  bigint, bigint, bigint, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.server_apply_verified_refund(
  text, uuid, text, text, text, text, text, bigint, text, text, text, boolean, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.server_apply_verified_dispute(
  text, uuid, text, text, text, text, text, bigint, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.server_get_webhook_payment_order_snapshot(uuid)
to service_role;
grant execute on function public.server_persist_connect_status_if_current(
  text, timestamptz, text, text, text, text, integer, integer, text
) to service_role;
grant execute on function public.server_mark_payment_requires_review(
  text, uuid, text, text, text, text, text, text, text, text, text, text,
  bigint, bigint, bigint, text, text
) to service_role;
grant execute on function public.server_apply_verified_refund(
  text, uuid, text, text, text, text, text, bigint, text, text, text, boolean, boolean
) to service_role;
grant execute on function public.server_apply_verified_dispute(
  text, uuid, text, text, text, text, text, bigint, text, text
) to service_role;
