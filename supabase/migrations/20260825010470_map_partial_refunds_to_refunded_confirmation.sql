create or replace function private.order_confirmation_status(p_order_status text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select case p_order_status
    when 'creating_checkout' then 'processing'
    when 'checkout_open' then 'processing'
    when 'payment_processing' then 'processing'
    when 'paid' then 'paid'
    when 'partially_refunded' then 'refunded'
    when 'payment_failed' then 'failed'
    when 'requires_review' then 'failed'
    when 'expired' then 'expired'
    when 'cancelled' then 'expired'
    when 'refunded' then 'refunded'
  end;
$$;

revoke all on function private.order_confirmation_status(text)
  from public, anon, authenticated, service_role;

comment on function private.order_confirmation_status(text) is
  'Maps persisted test-mode order truth to the minimum confirmation state. Any refund state is presented as refunded, never paid.';
