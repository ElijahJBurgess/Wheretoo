alter table public.orders
  drop constraint orders_quantity_check,
  add constraint orders_quantity_check check (quantity between 1 and 10);

alter table public.order_items
  drop constraint order_items_order_id_key,
  drop constraint order_items_quantity_check,
  add constraint order_items_order_id_ticket_tier_id_key
    unique (order_id, ticket_tier_id),
  add constraint order_items_quantity_check check (quantity between 1 and 10);

create table private.checkout_runtime_control (
  singleton boolean primary key default true,
  checkout_creation_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint checkout_runtime_control_singleton_check check (singleton)
);

alter table private.checkout_runtime_control enable row level security;

insert into private.checkout_runtime_control (
  singleton,
  checkout_creation_enabled
)
values (true, false);

comment on table private.checkout_runtime_control is
  'Owner-only runtime gate for new hosted Checkout creation. Existing lifecycle operations remain enabled.';

revoke all on table private.checkout_runtime_control
from public, anon, authenticated, service_role;

create or replace function private.reserve_checkout(
  p_event_id uuid,
  p_tier_id uuid,
  p_name text,
  p_email text,
  p_client_request_id uuid,
  p_confirmation_token_hash text
)
returns table (
  order_id uuid,
  organizer_id uuid,
  subtotal_minor bigint,
  currency text,
  application_fee_amount_minor bigint,
  stripe_account_id text,
  checkout_expires_at timestamptz,
  existing_checkout_session_id text,
  integration_identifier text,
  create_request_digest text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_matching_order_id uuid;
  v_checkout_creation_enabled boolean;
begin
  select orders.id
  into v_matching_order_id
  from public.orders as orders
  join public.order_items as items on items.order_id = orders.id
  where orders.event_id = p_event_id
    and orders.client_request_id = p_client_request_id
    and orders.buyer_name = btrim(p_name)
    and orders.buyer_email = lower(btrim(p_email))
    and orders.confirmation_token_hash = p_confirmation_token_hash
    and items.ticket_tier_id = p_tier_id
  order by orders.id
  limit 1;

  if v_matching_order_id is null then
    select controls.checkout_creation_enabled
    into v_checkout_creation_enabled
    from private.checkout_runtime_control as controls
    where controls.singleton;

    if not coalesce(v_checkout_creation_enabled, false) then
      raise exception using errcode = 'P0001', message = 'CHECKOUT_DISABLED';
    end if;
  end if;

  select legacy.order_id into v_order_id
  from private.checkout_reservation_v1(
    p_event_id, p_tier_id, p_name, p_email, p_client_request_id,
    p_confirmation_token_hash
  ) as legacy;

  if v_order_id is null then
    return;
  end if;

  -- The legacy insert trigger cannot see the subsequently inserted tier item.
  update public.orders as orders
  set stripe_checkout_request_digest = private.checkout_request_digest(
    orders.id,
    orders.event_id,
    items.ticket_tier_id,
    orders.client_request_id,
    orders.confirmation_token_hash,
    orders.buyer_email,
    orders.currency,
    orders.subtotal_minor,
    orders.application_fee_amount_minor,
    orders.stripe_destination_account_id,
    orders.checkout_expires_at,
    orders.stripe_checkout_integration_identifier
  )
  from public.order_items as items
  where orders.id = v_order_id
    and items.order_id = orders.id
    and orders.stripe_checkout_request_digest is distinct from
      private.checkout_request_digest(
        orders.id, orders.event_id, items.ticket_tier_id,
        orders.client_request_id, orders.confirmation_token_hash,
        orders.buyer_email, orders.currency, orders.subtotal_minor,
        orders.application_fee_amount_minor,
        orders.stripe_destination_account_id, orders.checkout_expires_at,
        orders.stripe_checkout_integration_identifier
      );

  return query
  select
    orders.id,
    orders.organizer_id,
    orders.subtotal_minor,
    orders.currency,
    orders.application_fee_amount_minor,
    orders.stripe_destination_account_id,
    orders.checkout_expires_at,
    orders.stripe_checkout_session_id,
    orders.stripe_checkout_integration_identifier,
    orders.stripe_checkout_request_digest
  from public.orders as orders
  where orders.id = v_order_id;
end;
$$;

revoke all on function private.reserve_checkout(uuid, uuid, text, text, uuid, text)
from public, anon, authenticated, service_role;
