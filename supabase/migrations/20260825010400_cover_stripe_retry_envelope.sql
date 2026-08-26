-- Stripe 22.5.0 uses an 80-second timeout and two network retries. The
-- minute-snapped expiry therefore preserves all three attempts (240 seconds)
-- above Checkout's 30-minute minimum even at the worst minute boundary.
-- Existing immutable order snapshots are intentionally unchanged.

create or replace function private.checkout_expiry_from(p_now timestamptz)
returns timestamptz
language sql
immutable
strict
set search_path = ''
as $$
  select date_trunc('minute', p_now) + interval '35 minutes';
$$;

revoke all on function private.checkout_expiry_from(timestamptz)
from public, anon, authenticated, service_role;
