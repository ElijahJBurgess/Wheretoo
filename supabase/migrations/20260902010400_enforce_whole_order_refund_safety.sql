alter table public.refunds
  add column transfer_reversal_amount_minor bigint not null default 0,
  add column application_fee_refund_amount_minor bigint not null default 0,
  add column policy_verified boolean not null default false,
  add column policy_failure_code text;

alter table public.refunds
  add constraint refunds_transfer_reversal_amount_check check (
    transfer_reversal_amount_minor between 0 and amount_minor
  ),
  add constraint refunds_application_fee_refund_amount_check check (
    application_fee_refund_amount_minor between 0 and amount_minor
  ),
  add constraint refunds_policy_outcome_check check (
    (policy_verified and policy_failure_code is null)
    or (
      not policy_verified
      and policy_failure_code in (
        'REFUND_POLICY_MISMATCH', 'REFUND_PENDING',
        'REFUND_FAILED', 'REFUND_CANCELLED'
      )
    )
  );

drop trigger if exists orders_reconcile_verified_refund_ticket on public.orders;

create or replace function private.reconcile_verified_refund_ticket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'refunded' then
    update public.tickets as tickets
    set status = 'refunded',
        refunded_at = coalesce(tickets.refunded_at, statement_timestamp()),
        cancelled_at = null
    where tickets.order_id = new.id
      and tickets.status in ('valid', 'cancelled');
  end if;
  return new;
end;
$$;

create trigger orders_reconcile_verified_refund_ticket
after update of status on public.orders
for each row
when (new.status = 'refunded')
execute function private.reconcile_verified_refund_ticket();

drop function public.server_apply_verified_refund(
  text, uuid, text, text, text, text, text, bigint, text, text, text,
  boolean, boolean
);
drop function private.apply_verified_refund(
  text, uuid, text, text, text, text, text, bigint, text, text, text,
  boolean, boolean
);

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
  v_receipt public.stripe_webhook_events;
  v_refund public.refunds;
  v_status text := case when p_status = 'canceled' then 'cancelled' else p_status end;
  v_existing boolean;
  v_ignore boolean;
  v_successful_total bigint;
  v_reversal_total bigint;
  v_fee_refund_total bigint;
  v_has_policy_conflict boolean;
  v_failure_code text;
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
    or v_receipt.stripe_object_id is distinct from p_stripe_refund_id
    or p_stripe_refund_id is null
    or p_stripe_refund_id !~ '^re_[A-Za-z0-9]+$'
    or p_payment_intent_id is null
    or p_payment_intent_id !~ '^pi_[A-Za-z0-9]+$'
    or p_charge_id is null or p_charge_id !~ '^ch_[A-Za-z0-9]+$'
    or p_amount_minor is null or p_amount_minor <= 0
    or p_currency is distinct from v_order.currency
    or v_status is null
    or v_status not in (
      'pending', 'requires_action', 'succeeded', 'failed', 'cancelled'
    )
    or p_reverse_transfer is null or p_refund_application_fee is null
    or p_transfer_reversal_amount_minor is null
    or p_transfer_reversal_amount_minor < 0
    or p_transfer_reversal_amount_minor > p_amount_minor
    or p_application_fee_refund_amount_minor is null
    or p_application_fee_refund_amount_minor < 0
    or p_application_fee_refund_amount_minor > v_order.application_fee_amount_minor
    or p_policy_verified is null
    or (
      p_policy_verified
      and (
        p_policy_failure_code is not null
        or p_reverse_transfer is distinct from true
        or p_refund_application_fee is distinct from true
      )
    )
    or (
      not p_policy_verified
      and p_policy_failure_code not in (
        'REFUND_POLICY_MISMATCH', 'REFUND_PENDING',
        'REFUND_FAILED', 'REFUND_CANCELLED'
      )
    )
    or (
      p_transfer_reversal_id is not null
      and p_transfer_reversal_id !~ '^trr_[A-Za-z0-9]+$'
    )
    or (
      p_application_fee_refund_id is not null
      and p_application_fee_refund_id !~ '^fr_[A-Za-z0-9]+$'
    )
    or (
      p_transfer_reversal_amount_minor > 0
      and p_transfer_reversal_id is null
    )
    or (
      p_application_fee_refund_amount_minor > 0
      and p_application_fee_refund_id is null
    )
    or (
      p_policy_verified and v_status = 'succeeded'
      and (
        p_transfer_reversal_id is null
        or p_application_fee_refund_id is null
        or p_transfer_reversal_amount_minor <> p_amount_minor
      )
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
    or v_refund.transfer_reversal_amount_minor
      is distinct from p_transfer_reversal_amount_minor
    or v_refund.application_fee_refund_amount_minor
      is distinct from p_application_fee_refund_amount_minor
    or v_refund.policy_verified is distinct from p_policy_verified
    or v_refund.policy_failure_code is distinct from p_policy_failure_code
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
  set stripe_payment_intent_id = coalesce(
        orders.stripe_payment_intent_id, p_payment_intent_id
      ),
      stripe_charge_id = coalesce(orders.stripe_charge_id, p_charge_id)
  where orders.id = p_order_id;

  v_ignore := v_existing and (
    v_refund.status in ('succeeded', 'failed', 'cancelled')
    or v_refund.status = v_status
    or (v_refund.status = 'requires_action' and v_status = 'pending')
  );

  if not v_ignore then
    insert into public.refunds (
      stripe_refund_id, order_id, stripe_payment_intent_id, stripe_charge_id,
      stripe_transfer_reversal_id, stripe_application_fee_refund_id,
      amount_minor, currency, status, reason, reverse_transfer,
      refund_application_fee, stripe_event_id, processed_at,
      transfer_reversal_amount_minor, application_fee_refund_amount_minor,
      policy_verified, policy_failure_code
    ) values (
      p_stripe_refund_id, p_order_id, p_payment_intent_id, p_charge_id,
      p_transfer_reversal_id, p_application_fee_refund_id,
      p_amount_minor, p_currency, v_status, p_reason, p_reverse_transfer,
      p_refund_application_fee, p_stripe_event_id,
      case when v_status in ('succeeded', 'failed', 'cancelled')
        then statement_timestamp() else null end,
      p_transfer_reversal_amount_minor,
      p_application_fee_refund_amount_minor,
      p_policy_verified, p_policy_failure_code
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
          when excluded.status in ('succeeded', 'failed', 'cancelled')
            then coalesce(public.refunds.processed_at, statement_timestamp())
          else null
        end;
  end if;

  select
    coalesce(sum(refunds.amount_minor), 0)::bigint,
    coalesce(sum(refunds.transfer_reversal_amount_minor), 0)::bigint,
    coalesce(sum(refunds.application_fee_refund_amount_minor), 0)::bigint,
    coalesce(bool_or(
      not refunds.policy_verified
      or not refunds.reverse_transfer
      or not refunds.refund_application_fee
    ), false)
  into v_successful_total, v_reversal_total, v_fee_refund_total,
    v_has_policy_conflict
  from public.refunds as refunds
  where refunds.order_id = p_order_id and refunds.status = 'succeeded';

  if v_successful_total > v_order.total_minor
    or v_reversal_total > v_order.total_minor
    or v_fee_refund_total > v_order.application_fee_amount_minor then
    raise exception using errcode = 'P0001', message = 'REFUND_TOTAL_INVALID';
  end if;

  if v_successful_total = v_order.total_minor
    and v_reversal_total = v_order.total_minor
    and v_fee_refund_total = v_order.application_fee_amount_minor
    and not v_has_policy_conflict then
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

    update public.tickets as tickets
    set status = 'refunded',
        refunded_at = coalesce(tickets.refunded_at, statement_timestamp()),
        cancelled_at = null
    where tickets.order_id = p_order_id
      and tickets.status in ('valid', 'cancelled');
  elsif v_successful_total > 0 then
    select coalesce(
      min(refunds.policy_failure_code)
        filter (where not refunds.policy_verified),
      'INCOMPLETE_REFUND_ECONOMICS_REQUIRES_REVIEW'
    ) into v_failure_code
    from public.refunds as refunds
    where refunds.order_id = p_order_id and refunds.status = 'succeeded';

    if v_successful_total < v_order.total_minor then
      v_failure_code := 'PARTIAL_REFUND_REQUIRES_REVIEW';
    end if;

    update public.orders as orders
    set status = 'requires_review',
        reconciliation_status = 'requires_review',
        failure_code = v_failure_code,
        last_stripe_event_id = p_stripe_event_id
    where orders.id = p_order_id and orders.status <> 'refunded';

    update public.tickets as tickets
    set status = 'cancelled',
        cancelled_at = coalesce(tickets.cancelled_at, statement_timestamp()),
        refunded_at = null
    where tickets.order_id = p_order_id
      and tickets.status = 'valid';
  end if;

  update public.stripe_webhook_events as receipts
  set processing_status = 'processed',
      processed_at = coalesce(receipts.processed_at, statement_timestamp()),
      error_code = case when v_ignore then 'REFUND_STATE_IGNORED' else null end
  where receipts.stripe_event_id = p_stripe_event_id;

  select orders.* into v_order
  from public.orders as orders where orders.id = p_order_id;
  select case
    when count(*) = 0 then null
    when min(tickets.status) = max(tickets.status) then min(tickets.status)
    else 'mixed'
  end into v_ticket_status
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

create or replace function private.prepare_whole_order_refund(
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
declare
  v_order public.orders;
  v_reason text := btrim(p_reason);
begin
  perform * from private.lock_payment_order(p_order_id);
  select orders.* into v_order
  from public.orders as orders where orders.id = p_order_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_FOUND';
  end if;
  if p_reason is distinct from v_reason
    or v_reason not in ('duplicate', 'fraudulent', 'requested_by_customer')
    or v_order.livemode
    or v_order.status not in ('paid', 'requires_review')
    or v_order.stripe_payment_intent_id is null
    or v_order.stripe_charge_id is null
    or v_order.stripe_transfer_id is null
    or v_order.stripe_application_fee_id is null
    or v_order.total_minor <= 0
    or v_order.application_fee_amount_minor < 0
    or v_order.application_fee_amount_minor >= v_order.total_minor then
    raise exception using errcode = 'P0001', message = 'REFUND_NOT_AVAILABLE';
  end if;
  return query select
    v_order.id, v_order.stripe_payment_intent_id, v_order.stripe_charge_id,
    v_order.stripe_transfer_id, v_order.stripe_application_fee_id,
    v_order.currency, v_order.total_minor,
    v_order.application_fee_amount_minor, v_reason;
end;
$$;

create function public.server_prepare_whole_order_refund(
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

create or replace function private.apply_refund(
  p_stripe_event_id text,
  p_order_id uuid,
  p_stripe_refund_id text,
  p_payment_intent_id text,
  p_charge_id text,
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
    p_payment_intent_id, p_charge_id, null, null,
    p_amount_minor, p_currency, p_status, p_reason,
    p_reverse_transfer, p_refund_application_fee, 0, 0, false,
    case
      when p_status in ('pending', 'requires_action') then 'REFUND_PENDING'
      when p_status = 'failed' then 'REFUND_FAILED'
      when p_status in ('canceled', 'cancelled') then 'REFUND_CANCELLED'
      else 'REFUND_POLICY_MISMATCH'
    end
  );
$$;

revoke all on function private.apply_verified_refund(
  text, uuid, text, text, text, text, text, bigint, text, text, text,
  boolean, boolean, bigint, bigint, boolean, text
) from public, anon, authenticated, service_role;
revoke all on function private.prepare_whole_order_refund(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.server_apply_verified_refund(
  text, uuid, text, text, text, text, text, bigint, text, text, text,
  boolean, boolean, bigint, bigint, boolean, text
) from public, anon, authenticated, service_role;
revoke all on function public.server_prepare_whole_order_refund(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.server_apply_verified_refund(
  text, uuid, text, text, text, text, text, bigint, text, text, text,
  boolean, boolean, bigint, bigint, boolean, text
) to service_role;
grant execute on function public.server_prepare_whole_order_refund(uuid, text)
  to service_role;

comment on function public.server_prepare_whole_order_refund(uuid, text) is
  'Service-only whole-order refund snapshot with no buyer, ticket, or tier data.';
comment on function public.server_apply_verified_refund(
  text, uuid, text, text, text, text, text, bigint, text, text, text,
  boolean, boolean, bigint, bigint, boolean, text
) is 'Persists exact refund economics; only a complete whole-order unwind reconciles automatically.';
