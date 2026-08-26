create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  stripe_dispute_id text not null,
  order_id uuid not null references public.orders(id) on delete restrict,
  stripe_charge_id text not null,
  amount_minor bigint not null,
  currency text not null,
  status text not null,
  recovery_status text not null,
  first_stripe_event_id text not null
    references public.stripe_webhook_events(stripe_event_id) on delete restrict,
  last_stripe_event_id text not null
    references public.stripe_webhook_events(stripe_event_id) on delete restrict,
  first_stripe_event_created_at timestamptz not null,
  last_stripe_event_created_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint disputes_stripe_dispute_id_key unique (stripe_dispute_id),
  constraint disputes_stripe_dispute_id_check check (
    stripe_dispute_id = btrim(stripe_dispute_id)
    and stripe_dispute_id ~ '^(du|dp)_[A-Za-z0-9]+$'
  ),
  constraint disputes_charge_id_check check (
    stripe_charge_id = btrim(stripe_charge_id)
    and stripe_charge_id ~ '^ch_[A-Za-z0-9]+$'
  ),
  constraint disputes_amount_check check (amount_minor > 0),
  constraint disputes_currency_check check (currency = 'usd'),
  constraint disputes_status_check check (
    status in (
      'warning_needs_response', 'warning_under_review', 'warning_closed',
      'needs_response', 'under_review', 'won', 'lost', 'prevented'
    )
  ),
  constraint disputes_recovery_status_check check (
    recovery_status in ('not_attempted', 'failed', 'succeeded')
  ),
  constraint disputes_event_time_check check (
    last_stripe_event_created_at >= first_stripe_event_created_at
  )
);

create index disputes_order_id_idx on public.disputes(order_id);

create trigger disputes_set_updated_at
before update on public.disputes
for each row execute function public.set_updated_at();

alter table public.disputes enable row level security;
alter table public.disputes force row level security;
revoke all on table public.disputes from public, anon, authenticated, service_role;

drop function public.server_apply_dispute(
  text, uuid, text, text, text, bigint, text, text
);
drop function private.apply_dispute(
  text, uuid, text, text, text, bigint, text, text
);

create function private.apply_dispute(
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
  v_dispute public.disputes;
  v_existing boolean;
  v_failure_code text;
  v_status_transition_valid boolean;
  v_recovery_transition_valid boolean;
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
    or v_order.paid_at is null
    or v_order.stripe_charge_id is distinct from p_charge_id
    or p_currency is distinct from v_order.currency
    or p_amount_minor is null
    or p_amount_minor <= 0
    or p_amount_minor > v_order.total_minor
    or p_status is null
    or p_status not in (
      'warning_needs_response', 'warning_under_review', 'warning_closed',
      'needs_response', 'under_review', 'won', 'lost', 'prevented'
    )
    or p_recovery_status is null
    or p_recovery_status not in ('not_attempted', 'succeeded', 'failed') then
    raise exception using errcode = 'P0001', message = 'DISPUTE_SNAPSHOT_MISMATCH';
  end if;

  select disputes.* into v_dispute
  from public.disputes as disputes
  where disputes.stripe_dispute_id = p_stripe_dispute_id
  for update;

  v_existing := found;

  if not v_existing then
    insert into public.disputes (
      stripe_dispute_id, order_id, stripe_charge_id, amount_minor, currency,
      status, recovery_status, first_stripe_event_id, last_stripe_event_id,
      first_stripe_event_created_at, last_stripe_event_created_at
    )
    values (
      p_stripe_dispute_id, p_order_id, p_charge_id, p_amount_minor, p_currency,
      p_status, p_recovery_status, p_stripe_event_id, p_stripe_event_id,
      v_receipt.stripe_created_at, v_receipt.stripe_created_at
    )
    on conflict (stripe_dispute_id) do nothing;

    select disputes.* into v_dispute
    from public.disputes as disputes
    where disputes.stripe_dispute_id = p_stripe_dispute_id
    for update;

    v_existing := v_dispute.first_stripe_event_id is distinct from p_stripe_event_id;
  end if;

  if v_dispute.order_id is distinct from p_order_id
    or v_dispute.stripe_charge_id is distinct from p_charge_id
    or v_dispute.amount_minor is distinct from p_amount_minor
    or v_dispute.currency is distinct from p_currency then
    raise exception using errcode = 'P0001', message = 'DISPUTE_SNAPSHOT_MISMATCH';
  end if;

  if v_existing then
    if v_receipt.stripe_created_at < v_dispute.last_stripe_event_created_at
      or (
        v_receipt.stripe_created_at = v_dispute.last_stripe_event_created_at
        and p_stripe_event_id is distinct from v_dispute.last_stripe_event_id
      ) then
      raise exception using errcode = 'P0001', message = 'DISPUTE_STATE_REGRESSION';
    end if;

    v_status_transition_valid :=
      p_status = v_dispute.status
      or (
        v_dispute.status = 'warning_needs_response'
        and p_status in (
          'warning_under_review', 'warning_closed', 'needs_response',
          'under_review', 'won', 'lost', 'prevented'
        )
      )
      or (
        v_dispute.status = 'warning_under_review'
        and p_status in (
          'warning_closed', 'needs_response', 'under_review', 'won', 'lost', 'prevented'
        )
      )
      or (
        v_dispute.status = 'needs_response'
        and p_status in ('under_review', 'won', 'lost', 'prevented')
      )
      or (
        v_dispute.status = 'under_review'
        and p_status in ('won', 'lost', 'prevented')
      )
      or (v_dispute.status = 'lost' and p_status = 'won');

    v_recovery_transition_valid :=
      p_recovery_status = v_dispute.recovery_status
      or (
        v_dispute.recovery_status = 'not_attempted'
        and p_recovery_status in ('failed', 'succeeded')
      )
      or (
        v_dispute.recovery_status = 'failed'
        and p_recovery_status = 'succeeded'
      );

    if not v_status_transition_valid or not v_recovery_transition_valid then
      raise exception using errcode = 'P0001', message = 'DISPUTE_STATE_REGRESSION';
    end if;

    update public.disputes as disputes
    set status = p_status,
        recovery_status = p_recovery_status,
        last_stripe_event_id = p_stripe_event_id,
        last_stripe_event_created_at = v_receipt.stripe_created_at
    where disputes.stripe_dispute_id = p_stripe_dispute_id
    returning disputes.* into v_dispute;
  end if;

  v_failure_code := 'DISPUTE_' || upper(v_dispute.status)
    || '_RECOVERY_' || upper(v_dispute.recovery_status);

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

create function public.server_apply_dispute(
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

revoke all on function private.apply_dispute(
  text, uuid, text, text, text, bigint, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.server_apply_dispute(
  text, uuid, text, text, text, bigint, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.server_apply_dispute(
  text, uuid, text, text, text, bigint, text, text
) to service_role;
