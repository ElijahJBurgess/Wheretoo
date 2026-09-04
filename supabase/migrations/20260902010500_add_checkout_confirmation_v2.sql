create or replace function private.lookup_checkout_integrity_confirmation(
  p_token_hash text
)
returns table (
  event_title text,
  event_starts_at timestamptz,
  event_ends_at timestamptz,
  event_timezone text,
  event_venue_name text,
  items jsonb,
  order_number text,
  confirmation_status text,
  quantity integer,
  currency text,
  subtotal_minor bigint,
  tax_amount_minor bigint,
  total_minor bigint
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
    confirmation_items.items,
    orders.order_number,
    case orders.status
      when 'creating_checkout' then 'processing'
      when 'checkout_open' then 'processing'
      when 'payment_processing' then 'processing'
      when 'paid' then 'paid'
      when 'payment_failed' then 'payment_failed'
      when 'cancelled' then 'cancelled'
      when 'expired' then 'expired'
      when 'refunded' then 'refunded'
      when 'partially_refunded' then 'requires_review'
      when 'requires_review' then 'requires_review'
    end,
    orders.quantity,
    orders.currency,
    orders.subtotal_minor,
    orders.tax_amount_minor,
    orders.total_minor
  from public.orders as orders
  join public.events as events on events.id = orders.event_id
  cross join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'tier_name', order_items.tier_name,
        'quantity', order_items.quantity,
        'unit_amount_minor', order_items.unit_amount_minor,
        'subtotal_minor', order_items.subtotal_minor,
        'currency', order_items.currency
      )
      order by order_items.ticket_tier_id
    ) as items
    from public.order_items as order_items
    where order_items.order_id = orders.id
  ) as confirmation_items
  where orders.confirmation_token_hash = p_token_hash
    and not orders.livemode
    and confirmation_items.items is not null;
end;
$$;

create or replace function public.server_lookup_checkout_integrity_confirmation(
  p_token_hash text
)
returns table (
  event_title text,
  event_starts_at timestamptz,
  event_ends_at timestamptz,
  event_timezone text,
  event_venue_name text,
  items jsonb,
  order_number text,
  confirmation_status text,
  quantity integer,
  currency text,
  subtotal_minor bigint,
  tax_amount_minor bigint,
  total_minor bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select *
  from private.lookup_checkout_integrity_confirmation(p_token_hash);
$$;

revoke all on function private.lookup_checkout_integrity_confirmation(text)
  from public, anon, authenticated, service_role;
revoke all on function public.server_lookup_checkout_integrity_confirmation(text)
  from public, anon, authenticated;
grant execute on function public.server_lookup_checkout_integrity_confirmation(text)
  to service_role;

comment on function public.server_lookup_checkout_integrity_confirmation(text) is
  'Service-only bearer-safe multi-item confirmation projection. Returns persisted item labels and integer totals without buyer, Stripe, ticket, reconciliation, failure-detail, or credential fields.';
