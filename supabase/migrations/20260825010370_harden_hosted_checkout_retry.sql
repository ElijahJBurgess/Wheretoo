-- Task 12 review hardening. Applied migration history remains immutable.

alter table public.orders
  add column stripe_destination_account_id text,
  add column stripe_checkout_integration_identifier text,
  add column stripe_checkout_request_digest text;

create or replace function private.checkout_integration_identifier(p_order_id uuid)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select 'whereto_checkout_' || translate(
    substr(replace(p_order_id::text, '-', ''), 1, 8),
    '0123456789abcdef',
    'abcdefghijklmnop'
  );
$$;

create or replace function private.checkout_request_digest(
  p_order_id uuid,
  p_event_id uuid,
  p_tier_id uuid,
  p_client_request_id uuid,
  p_confirmation_token_hash text,
  p_buyer_email text,
  p_currency text,
  p_subtotal_minor bigint,
  p_application_fee_amount_minor bigint,
  p_destination_account_id text,
  p_checkout_expires_at timestamptz,
  p_integration_identifier text
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(
    extensions.digest(
      concat_ws(
        chr(31),
        'whereto-checkout-v2',
        p_order_id::text,
        p_event_id::text,
        p_tier_id::text,
        p_client_request_id::text,
        p_confirmation_token_hash,
        p_buyer_email,
        p_currency,
        p_subtotal_minor::text,
        p_application_fee_amount_minor::text,
        p_destination_account_id,
        extract(epoch from p_checkout_expires_at)::bigint::text,
        p_integration_identifier
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function private.populate_checkout_request_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.stripe_destination_account_id is distinct from old.stripe_destination_account_id
      or new.stripe_checkout_integration_identifier is distinct from old.stripe_checkout_integration_identifier
      or (
        new.stripe_checkout_request_digest is distinct from old.stripe_checkout_request_digest
        and old.stripe_checkout_request_digest <> repeat('0', 64)
      ) then
      raise exception using errcode = 'P0001', message = 'CHECKOUT_SNAPSHOT_IMMUTABLE';
    end if;
    return new;
  end if;

  select accounts.stripe_account_id into new.stripe_destination_account_id
  from public.organizer_stripe_accounts as accounts
  where accounts.organizer_id = new.organizer_id
    and accounts.livemode = false;

  new.stripe_destination_account_id := coalesce(
    new.stripe_destination_account_id,
    'acct_unavailable_snapshot'
  );

  -- Stripe requires at least thirty minutes at request time. Snapping to the
  -- next minute makes this value deterministic and preserves that minimum.
  new.checkout_expires_at := date_trunc('minute', statement_timestamp())
    + interval '31 minutes';
  new.reservation_expires_at := new.checkout_expires_at + interval '5 minutes';
  new.stripe_checkout_integration_identifier :=
    private.checkout_integration_identifier(new.id);
  new.stripe_checkout_request_digest := repeat('0', 64);
  -- The tier is inserted after the order, so reserve_checkout replaces this
  -- placeholder digest after inserting the immutable order item snapshot.
  return new;
end;
$$;

-- Backfill any unfinished development orders before enforcing the snapshot.
update public.orders as orders
set stripe_destination_account_id = coalesce(
      (
        select accounts.stripe_account_id
        from public.organizer_stripe_accounts as accounts
        where accounts.organizer_id = orders.organizer_id
          and accounts.livemode = false
      ),
      'acct_unavailable_snapshot'
    ),
    checkout_expires_at = coalesce(
      date_trunc('second', orders.checkout_expires_at),
      date_trunc('minute', orders.created_at) + interval '31 minutes'
    ),
    stripe_checkout_integration_identifier =
      private.checkout_integration_identifier(orders.id);

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
where items.order_id = orders.id;

alter table public.orders
  alter column stripe_destination_account_id set not null,
  alter column stripe_checkout_integration_identifier set not null,
  alter column stripe_checkout_request_digest set not null,
  add constraint orders_stripe_destination_account_id_check check (
    stripe_destination_account_id ~ '^acct_[A-Za-z0-9_]+$'
  ),
  add constraint orders_stripe_checkout_integration_identifier_check check (
    stripe_checkout_integration_identifier ~ '^whereto_checkout_[a-p]{8}$'
  ),
  add constraint orders_stripe_checkout_request_digest_check check (
    stripe_checkout_request_digest ~ '^[a-f0-9]{64}$'
  );

drop function public.server_reserve_checkout(uuid, uuid, text, text, uuid, text);
alter function private.reserve_checkout(uuid, uuid, text, text, uuid, text)
  rename to checkout_reservation_v1;

create trigger orders_checkout_snapshot_insert
before insert on public.orders
for each row execute function private.populate_checkout_request_snapshot();

create trigger orders_checkout_snapshot_update
before update on public.orders
for each row execute function private.populate_checkout_request_snapshot();

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
begin
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

create or replace function public.server_reserve_checkout(
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
language sql
security definer
set search_path = ''
as $$
  select * from private.reserve_checkout(
    p_event_id, p_tier_id, p_name, p_email, p_client_request_id,
    p_confirmation_token_hash
  );
$$;

comment on function public.server_reserve_checkout(uuid, uuid, text, text, uuid, text) is
  'Service-only Checkout boundary. The caller derives the 32-byte clear confirmation token as SHA-256 bytes of p_client_request_id::text, URL-safe encodes those bytes for redirect URLs, and passes the lowercase hexadecimal SHA-256 of those bytes as p_confirmation_token_hash. The same request UUID reproduces both values; the returned request digest binds the immutable Stripe create snapshot.';

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
    or p_expires_at is null then
    raise exception using errcode = 'P0001', message = 'CHECKOUT_INPUT_INVALID';
  end if;

  select orders.* into v_order
  from public.orders as orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_FOUND';
  end if;
  if p_expires_at is distinct from v_order.checkout_expires_at then
    raise exception using errcode = 'P0001', message = 'CHECKOUT_SNAPSHOT_MISMATCH';
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
        stripe_checkout_session_id = p_session_id
    where orders.id = p_order_id;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'CHECKOUT_ALREADY_EXISTS';
  end;
  return p_order_id;
end;
$$;

create or replace function private.assert_payment_snapshot(
  p_stripe_event_id text,
  p_order_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_mode text,
  p_payment_status text,
  p_currency text,
  p_subtotal_minor bigint,
  p_total_minor bigint,
  p_application_fee_amount_minor bigint,
  p_destination_account_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_receipt public.stripe_webhook_events;
begin
  select orders.* into v_order from public.orders as orders
  where orders.id = p_order_id;
  select receipts.* into v_receipt
  from public.stripe_webhook_events as receipts
  where receipts.stripe_event_id = p_stripe_event_id
  for update;

  if not found or v_receipt.livemode
    or v_receipt.stripe_object_id is distinct from p_checkout_session_id then
    raise exception using errcode = 'P0001', message = 'WEBHOOK_RECEIPT_MISMATCH';
  end if;
  if v_order.id is null or v_order.livemode
    or v_order.stripe_checkout_session_id is distinct from p_checkout_session_id
    or (v_order.stripe_payment_intent_id is not null
      and v_order.stripe_payment_intent_id is distinct from p_payment_intent_id)
    or p_mode is distinct from 'payment'
    or p_payment_status not in ('paid', 'unpaid')
    or v_order.currency is distinct from p_currency
    or v_order.subtotal_minor is distinct from p_subtotal_minor
    or v_order.total_minor is distinct from p_total_minor
    or v_order.application_fee_amount_minor is distinct from p_application_fee_amount_minor
    or v_order.stripe_destination_account_id is distinct from p_destination_account_id then
    raise exception using errcode = 'P0001', message = 'PAYMENT_SNAPSHOT_MISMATCH';
  end if;
end;
$$;

create or replace function private.get_checkout_preflight(p_event_id uuid, p_tier_id uuid)
returns table (organizer_id uuid, stripe_account_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_event public.events;
  v_tier public.ticket_tiers;
  v_account text;
begin
  select events.* into v_event from public.events as events where events.id = p_event_id;
  if not found or v_event.status is distinct from 'published'
    or v_event.admission_type is distinct from 'paid'
    or v_event.moderation_status not in ('clear', 'flagged')
    or v_event.starts_at is null or v_event.starts_at <= v_now
    or v_event.ends_at is null or v_event.ends_at <= v_event.starts_at then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_SELLABLE';
  end if;

  select tiers.* into v_tier from public.ticket_tiers as tiers
  where tiers.id = p_tier_id and tiers.event_id = p_event_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'TIER_NOT_FOUND';
  end if;
  if v_tier.status is distinct from 'active' or v_tier.currency is distinct from 'usd' then
    raise exception using errcode = 'P0001', message = 'TIER_NOT_ACTIVE';
  end if;

  select accounts.stripe_account_id into v_account
  from public.organizer_stripe_accounts as accounts
  where accounts.organizer_id = v_event.organizer_id and not accounts.livemode;
  if not found then
    raise exception using errcode = 'P0001', message = 'CONNECT_NOT_READY';
  end if;
  return query select v_event.organizer_id, v_account;
end;
$$;

create or replace function public.server_get_checkout_preflight(p_event_id uuid, p_tier_id uuid)
returns table (organizer_id uuid, stripe_account_id text)
language sql
security definer
set search_path = ''
as $$ select * from private.get_checkout_preflight(p_event_id, p_tier_id); $$;

create or replace function private.lookup_checkout_cancellation(p_token_hash text)
returns table (order_id uuid, status text, stripe_checkout_session_id text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = 'P0001', message = 'CHECKOUT_INPUT_INVALID';
  end if;
  return query select orders.id, orders.status, orders.stripe_checkout_session_id
  from public.orders as orders
  where orders.confirmation_token_hash = p_token_hash and not orders.livemode;
end;
$$;

create or replace function public.server_lookup_checkout_cancellation(p_token_hash text)
returns table (order_id uuid, status text, stripe_checkout_session_id text)
language sql
security definer
set search_path = ''
as $$ select * from private.lookup_checkout_cancellation(p_token_hash); $$;

create table private.checkout_rate_limit_config (
  singleton boolean primary key default true check (singleton),
  identity_hmac_secret bytea not null,
  max_buckets integer not null check (max_buckets between 100 and 100000)
);
insert into private.checkout_rate_limit_config(identity_hmac_secret, max_buckets)
values (extensions.gen_random_bytes(32), 10000);

create table private.checkout_rate_limit_buckets (
  identity_digest bytea primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count between 1 and 10),
  expires_at timestamptz not null
);
create index checkout_rate_limit_buckets_expires_idx
  on private.checkout_rate_limit_buckets(expires_at);

create or replace function private.consume_checkout_rate_limit(p_identity_hash text)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_secret bytea;
  v_max integer;
  v_digest bytea;
  v_bucket private.checkout_rate_limit_buckets;
begin
  if p_identity_hash is null or p_identity_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = 'P0001', message = 'CHECKOUT_INPUT_INVALID';
  end if;
  select config.identity_hmac_secret, config.max_buckets into v_secret, v_max
  from private.checkout_rate_limit_config as config where config.singleton for update;
  delete from private.checkout_rate_limit_buckets as buckets where buckets.expires_at <= v_now;
  v_digest := extensions.hmac(decode(p_identity_hash, 'hex'), v_secret, 'sha256');
  select buckets.* into v_bucket from private.checkout_rate_limit_buckets as buckets
  where buckets.identity_digest = v_digest for update;

  if not found then
    if (select count(*) from private.checkout_rate_limit_buckets) >= v_max then
      return query select false, 60;
      return;
    end if;
    insert into private.checkout_rate_limit_buckets
      (identity_digest, window_started_at, request_count, expires_at)
    values (v_digest, v_now, 1, v_now + interval '2 minutes');
    return query select true, 0;
    return;
  end if;
  if v_bucket.window_started_at + interval '60 seconds' <= v_now then
    update private.checkout_rate_limit_buckets as buckets
    set window_started_at = v_now, request_count = 1,
        expires_at = v_now + interval '2 minutes'
    where buckets.identity_digest = v_digest;
    return query select true, 0;
    return;
  end if;
  if v_bucket.request_count >= 10 then
    return query select false,
      greatest(1, ceil(extract(epoch from
        (v_bucket.window_started_at + interval '60 seconds' - v_now)))::integer);
    return;
  end if;
  update private.checkout_rate_limit_buckets as buckets
  set request_count = buckets.request_count + 1,
      expires_at = v_now + interval '2 minutes'
  where buckets.identity_digest = v_digest;
  return query select true, 0;
end;
$$;

create or replace function public.server_consume_checkout_rate_limit(p_identity_hash text)
returns table (allowed boolean, retry_after_seconds integer)
language sql
security definer
set search_path = ''
as $$ select * from private.consume_checkout_rate_limit(p_identity_hash); $$;

revoke all on function private.checkout_integration_identifier(uuid) from public, anon, authenticated, service_role;
revoke all on function private.checkout_request_digest(uuid,uuid,uuid,uuid,text,text,text,bigint,bigint,text,timestamptz,text) from public, anon, authenticated, service_role;
revoke all on function private.populate_checkout_request_snapshot() from public, anon, authenticated, service_role;
revoke all on function private.checkout_reservation_v1(uuid,uuid,text,text,uuid,text) from public, anon, authenticated, service_role;
revoke all on function private.reserve_checkout(uuid,uuid,text,text,uuid,text) from public, anon, authenticated, service_role;
revoke all on function private.get_checkout_preflight(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function private.lookup_checkout_cancellation(text) from public, anon, authenticated, service_role;
revoke all on function private.consume_checkout_rate_limit(text) from public, anon, authenticated, service_role;

revoke all on function public.server_reserve_checkout(uuid,uuid,text,text,uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.server_get_checkout_preflight(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.server_lookup_checkout_cancellation(text) from public, anon, authenticated, service_role;
revoke all on function public.server_consume_checkout_rate_limit(text) from public, anon, authenticated, service_role;
grant execute on function public.server_reserve_checkout(uuid,uuid,text,text,uuid,text) to service_role;
grant execute on function public.server_get_checkout_preflight(uuid,uuid) to service_role;
grant execute on function public.server_lookup_checkout_cancellation(text) to service_role;
grant execute on function public.server_consume_checkout_rate_limit(text) to service_role;

revoke all on table private.checkout_rate_limit_config from public, anon, authenticated, service_role;
revoke all on table private.checkout_rate_limit_buckets from public, anon, authenticated, service_role;
