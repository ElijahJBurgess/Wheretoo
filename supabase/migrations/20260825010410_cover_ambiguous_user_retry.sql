-- A user retry after one fully ambiguous 240-second Stripe attempt envelope
-- must itself begin with another full envelope above Checkout's 30-minute
-- minimum. The worst minute boundary therefore retains just over 38 minutes.
-- Existing immutable order snapshots are intentionally unchanged.

create or replace function private.checkout_expiry_from(p_now timestamptz)
returns timestamptz
language sql
immutable
strict
set search_path = ''
as $$
  select date_trunc('minute', p_now) + interval '39 minutes';
$$;

revoke all on function private.checkout_expiry_from(timestamptz)
from public, anon, authenticated, service_role;
