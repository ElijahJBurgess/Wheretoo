create function private.finalize_webhook_receipt(
  p_stripe_event_id text,
  p_processing_status text,
  p_error_code text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt public.stripe_webhook_events;
begin
  if p_stripe_event_id is null
    or p_stripe_event_id !~ '^evt_[A-Za-z0-9]+$'
    or p_processing_status not in ('processed', 'failed')
    or p_error_code is null
    or p_error_code !~ '^[A-Z][A-Z0-9_]{0,254}$' then
    raise exception using errcode = 'P0001', message = 'WEBHOOK_FINALIZATION_INVALID';
  end if;

  select receipts.* into v_receipt
  from public.stripe_webhook_events as receipts
  where receipts.stripe_event_id = p_stripe_event_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'WEBHOOK_RECEIPT_NOT_FOUND';
  end if;

  if v_receipt.processing_status = 'processed' then
    return p_stripe_event_id;
  end if;

  update public.stripe_webhook_events as receipts
  set processing_status = p_processing_status,
      processed_at = case
        when p_processing_status = 'processed'
          then coalesce(receipts.processed_at, statement_timestamp())
        else null
      end,
      error_code = p_error_code
  where receipts.stripe_event_id = p_stripe_event_id;

  return p_stripe_event_id;
end;
$$;

create function private.get_webhook_order_snapshot(
  p_order_id uuid,
  p_checkout_session_id text
)
returns table (
  order_id uuid,
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
    and orders.stripe_checkout_session_id = p_checkout_session_id
    and orders.livemode = false
    and items.quantity = 1;
$$;

create function public.server_finalize_webhook_receipt(
  p_stripe_event_id text,
  p_processing_status text,
  p_error_code text
)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.finalize_webhook_receipt(
    p_stripe_event_id, p_processing_status, p_error_code
  );
$$;

create function public.server_get_webhook_order_snapshot(
  p_order_id uuid,
  p_checkout_session_id text
)
returns table (
  order_id uuid,
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
  select * from private.get_webhook_order_snapshot(
    p_order_id, p_checkout_session_id
  );
$$;

revoke all on function private.finalize_webhook_receipt(text, text, text)
from public, anon, authenticated, service_role;
revoke all on function private.get_webhook_order_snapshot(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.server_finalize_webhook_receipt(text, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.server_get_webhook_order_snapshot(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function public.server_finalize_webhook_receipt(text, text, text)
to service_role;
grant execute on function public.server_get_webhook_order_snapshot(uuid, text)
to service_role;
