alter table public.organizer_stripe_accounts
  drop constraint organizer_stripe_accounts_stripe_id_check,
  add constraint organizer_stripe_accounts_stripe_id_check check (
    stripe_account_id = btrim(stripe_account_id)
    and stripe_account_id ~ '^acct_[A-Za-z0-9]+$'
  );

alter table public.stripe_webhook_events
  drop constraint stripe_webhook_events_event_id_check,
  add constraint stripe_webhook_events_event_id_check check (
    stripe_event_id = btrim(stripe_event_id)
    and stripe_event_id ~ '^evt_[A-Za-z0-9]+$'
  ),
  drop constraint stripe_webhook_events_object_id_check,
  add constraint stripe_webhook_events_object_id_check check (
    stripe_object_id is null
    or (
      stripe_object_id = btrim(stripe_object_id)
      and stripe_object_id ~ '^[a-z][a-z0-9_]*_[A-Za-z0-9]+$'
    )
  );

alter table public.orders
  drop constraint orders_checkout_session_id_check,
  add constraint orders_checkout_session_id_check check (
    stripe_checkout_session_id is null
    or (
      stripe_checkout_session_id = btrim(stripe_checkout_session_id)
      and stripe_checkout_session_id ~ '^cs_test_[A-Za-z0-9]+$'
    )
  ),
  drop constraint orders_payment_intent_id_check,
  add constraint orders_payment_intent_id_check check (
    stripe_payment_intent_id is null
    or (
      stripe_payment_intent_id = btrim(stripe_payment_intent_id)
      and stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]+$'
    )
  ),
  drop constraint orders_charge_id_check,
  add constraint orders_charge_id_check check (
    stripe_charge_id is null
    or (
      stripe_charge_id = btrim(stripe_charge_id)
      and stripe_charge_id ~ '^ch_[A-Za-z0-9]+$'
    )
  ),
  drop constraint orders_transfer_id_check,
  add constraint orders_transfer_id_check check (
    stripe_transfer_id is null
    or (
      stripe_transfer_id = btrim(stripe_transfer_id)
      and stripe_transfer_id ~ '^tr_[A-Za-z0-9]+$'
    )
  ),
  drop constraint orders_application_fee_id_check,
  add constraint orders_application_fee_id_check check (
    stripe_application_fee_id is null
    or (
      stripe_application_fee_id = btrim(stripe_application_fee_id)
      and stripe_application_fee_id ~ '^fee_[A-Za-z0-9]+$'
    )
  ),
  drop constraint orders_balance_transaction_id_check,
  add constraint orders_balance_transaction_id_check check (
    stripe_balance_transaction_id is null
    or (
      stripe_balance_transaction_id = btrim(stripe_balance_transaction_id)
      and stripe_balance_transaction_id ~ '^txn_[A-Za-z0-9]+$'
    )
  ),
  drop constraint orders_customer_id_check,
  add constraint orders_customer_id_check check (
    stripe_customer_id is null
    or (
      stripe_customer_id = btrim(stripe_customer_id)
      and stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'
    )
  );

alter table public.refunds
  drop constraint refunds_stripe_refund_id_check,
  add constraint refunds_stripe_refund_id_check check (
    stripe_refund_id = btrim(stripe_refund_id)
    and stripe_refund_id ~ '^re_[A-Za-z0-9]+$'
  );

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
    or p_stripe_event_id !~ '^evt_[A-Za-z0-9]+$'
    or p_event_type is null
    or p_event_type <> lower(btrim(p_event_type))
    or char_length(p_event_type) not between 3 and 160
    or p_stripe_object_id is null
    or p_stripe_object_id <> btrim(p_stripe_object_id)
    or p_stripe_object_id !~ '^[a-z][a-z0-9_]*_[A-Za-z0-9]+$'
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

create or replace function private.attach_checkout_session(
  p_order_id uuid,
  p_session_id text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_order public.orders;
begin
  if p_order_id is null
    or p_session_id is null
    or p_session_id <> btrim(p_session_id)
    or p_session_id !~ '^cs_test_[A-Za-z0-9]+$'
    or p_expires_at is null
    or p_expires_at <= v_now then
    raise exception using errcode = 'P0001', message = 'CHECKOUT_INPUT_INVALID';
  end if;

  select orders.* into v_order
  from public.orders as orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_FOUND';
  end if;

  if v_order.stripe_checkout_session_id = p_session_id
    and v_order.status = 'checkout_open' then
    return v_order.id;
  end if;

  if v_order.stripe_checkout_session_id is not null then
    raise exception using errcode = 'P0001', message = 'CHECKOUT_ALREADY_EXISTS';
  end if;

  if v_order.status <> 'creating_checkout'
    or v_order.reservation_expires_at <= v_now then
    raise exception using errcode = 'P0001', message = 'CHECKOUT_EXPIRED';
  end if;

  begin
    update public.orders as orders
    set status = 'checkout_open',
        stripe_checkout_session_id = p_session_id,
        checkout_expires_at = p_expires_at,
        reservation_expires_at = p_expires_at + interval '5 minutes'
    where orders.id = p_order_id;
  exception
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'CHECKOUT_ALREADY_EXISTS';
  end;

  return p_order_id;
end;
$$;

revoke all on function private.record_webhook_receipt(
  text, text, boolean, text, text, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function private.attach_checkout_session(uuid, text, timestamptz)
from public, anon, authenticated, service_role;
