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
    when 'partially_refunded' then 'paid'
    when 'payment_failed' then 'failed'
    when 'requires_review' then 'failed'
    when 'expired' then 'expired'
    when 'cancelled' then 'expired'
    when 'refunded' then 'refunded'
  end;
$$;

create or replace function private.lookup_order_confirmation(p_token_hash text)
returns table (
  event_title text,
  event_starts_at timestamptz,
  event_ends_at timestamptz,
  event_timezone text,
  event_venue_name text,
  tier_name text,
  order_number text,
  confirmation_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_FOUND';
  end if;

  return query
  select
    events.title,
    events.starts_at,
    events.ends_at,
    events.timezone,
    events.venue_name,
    items.tier_name,
    orders.order_number,
    private.order_confirmation_status(orders.status)
  from public.orders as orders
  join public.events as events on events.id = orders.event_id
  join public.order_items as items on items.order_id = orders.id
  where orders.confirmation_token_hash = p_token_hash
    and not orders.livemode;
end;
$$;

create or replace function public.server_lookup_order_confirmation(p_token_hash text)
returns table (
  event_title text,
  event_starts_at timestamptz,
  event_ends_at timestamptz,
  event_timezone text,
  event_venue_name text,
  tier_name text,
  order_number text,
  confirmation_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.lookup_order_confirmation(p_token_hash);
$$;

revoke all on function private.order_confirmation_status(text)
  from public, anon, authenticated, service_role;
revoke all on function private.lookup_order_confirmation(text)
  from public, anon, authenticated, service_role;
revoke all on function public.server_lookup_order_confirmation(text)
  from public, anon, authenticated;
grant execute on function public.server_lookup_order_confirmation(text)
  to service_role;

comment on function public.server_lookup_order_confirmation(text) is
  'Service-only bearer-safe confirmation projection. Accepts only the lowercase SHA-256 hash of a canonical 32-byte confirmation bearer and returns no customer, financial, Stripe, ticket-internal, UUID, or failure fields.';
