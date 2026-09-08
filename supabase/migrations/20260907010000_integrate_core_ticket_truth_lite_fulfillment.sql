-- One atomic upgrade: existing durable tickets require an explicit founder decision.
do $$
begin
  lock table public.tickets in access exclusive mode;
  if exists (select 1 from public.tickets) then
    raise exception using errcode = 'P0001', message = 'LITE_EXISTING_TICKETS_REQUIRE_DECISION';
  end if;
end;
$$;

alter table public.tickets
  add column admission_label text not null,
  add column credential_hash bytea not null,
  add column used_at timestamptz,
  add constraint tickets_admission_label_check check (admission_label = btrim(admission_label) and char_length(admission_label) between 1 and 80),
  add constraint tickets_credential_hash_check check (octet_length(credential_hash) = 32),
  drop constraint tickets_status_check,
  add constraint tickets_status_check check (status in ('valid','used','refunded','cancelled')),
  drop constraint tickets_status_timestamp_check,
  add constraint tickets_status_timestamp_check check (
    (status = 'valid' and used_at is null and refunded_at is null and cancelled_at is null)
    or (status = 'used' and used_at is not null and refunded_at is null and cancelled_at is null)
    or (status = 'refunded' and used_at is null and refunded_at is not null and cancelled_at is null)
    or (status = 'cancelled' and used_at is null and refunded_at is null and cancelled_at is not null)
  );
create unique index tickets_credential_hash_key on public.tickets(credential_hash);

create function private.guard_ticket_identity_and_transition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if row(new.id,new.order_id,new.order_item_id,new.event_id,new.organizer_id,new.ticket_tier_id,new.unit_sequence,new.issued_at,new.admission_label,new.credential_hash)
    is distinct from row(old.id,old.order_id,old.order_item_id,old.event_id,old.organizer_id,old.ticket_tier_id,old.unit_sequence,old.issued_at,old.admission_label,old.credential_hash) then
    raise exception using errcode = 'P0001', message = 'TICKET_IDENTITY_IMMUTABLE';
  end if;
  if new.status = old.status then
    if row(new.used_at,new.refunded_at,new.cancelled_at) is distinct from row(old.used_at,old.refunded_at,old.cancelled_at) then
      raise exception using errcode = 'P0001', message = 'TICKET_TRANSITION_INVALID';
    end if;
  elsif not (old.status = 'valid' and new.status in ('used','refunded','cancelled')
    or old.status = 'cancelled' and new.status = 'refunded') then
    raise exception using errcode = 'P0001', message = 'TICKET_TRANSITION_INVALID';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_ticket_identity_and_transition() from public,anon,authenticated,service_role;
create trigger tickets_identity_and_transition before update on public.tickets
for each row execute function private.guard_ticket_identity_and_transition();

create or replace function private.get_checkout_integrity_order_snapshot(
  p_order_id uuid,
  p_checkout_session_id text
)
returns table (
  order_id uuid,
  checkout_session_id text,
  event_id uuid,
  currency text,
  subtotal_minor bigint,
  total_minor bigint,
  application_fee_amount_minor bigint,
  destination_account_id text,
  order_items jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    orders.id,
    orders.stripe_checkout_session_id,
    orders.event_id,
    orders.currency,
    orders.subtotal_minor,
    orders.total_minor,
    orders.application_fee_amount_minor,
    orders.stripe_destination_account_id,
    jsonb_agg(
      jsonb_build_object(
        'order_item_id', items.id,
        'ticket_tier_id', items.ticket_tier_id,
        'tier_name', items.tier_name,
        'currency', items.currency,
        'unit_amount_minor', items.unit_amount_minor,
        'quantity', items.quantity,
        'subtotal_minor', items.subtotal_minor
      )
      order by items.ticket_tier_id, items.id
    )
  from public.orders as orders
  join public.order_items as items on items.order_id = orders.id
  where orders.id = p_order_id
    and orders.stripe_checkout_session_id = p_checkout_session_id
    and orders.livemode = false
  group by orders.id;
$$;

drop function public.server_fulfill_paid_order(text, uuid, text, text, text, text, text, text, text, text, text, text, bigint, bigint, bigint, text);
drop function private.fulfill_paid_order(text, uuid, text, text, text, text, text, text, text, text, text, text, bigint, bigint, bigint, text);

create or replace function private.fulfill_paid_order(
  p_stripe_event_id text,
  p_order_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_charge_id text,
  p_transfer_id text,
  p_application_fee_id text,
  p_balance_transaction_id text,
  p_customer_id text,
  p_mode text,
  p_payment_status text,
  p_currency text,
  p_subtotal_minor bigint,
  p_total_minor bigint,
  p_application_fee_amount_minor bigint,
  p_destination_account_id text,
  p_ticket_manifest jsonb
)
returns table (
  order_id uuid,
  order_status text,
  ticket_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_manifest_entry jsonb;
  v_order public.orders;
  v_event public.events;
  v_digest_items jsonb;
  v_item_count integer;
  v_item_snapshot_valid boolean;
  v_item_set_valid boolean;
  v_inventory_valid boolean;
  v_ticket_set_exact boolean;
  v_ticket_set_valid boolean;
  v_ticket_lifecycle_valid boolean;
  v_ticket_count bigint;
  v_invalidated boolean;
  v_ticket_mismatch boolean;
begin
  perform * from private.lock_payment_order(p_order_id);
  perform tickets.id from public.tickets as tickets
  where tickets.order_id = p_order_id order by tickets.id for update;

  perform private.assert_payment_snapshot(
    p_stripe_event_id,
    p_order_id,
    p_checkout_session_id,
    p_payment_intent_id,
    p_mode,
    p_payment_status,
    p_currency,
    p_subtotal_minor,
    p_total_minor,
    p_application_fee_amount_minor,
    p_destination_account_id
  );

  if p_payment_status is distinct from 'paid' then
    raise exception using errcode = 'P0001', message = 'PAYMENT_NOT_PAID';
  end if;

  if p_payment_intent_id is null
    or p_charge_id is null
    or p_transfer_id is null
    or p_application_fee_id is null
    or p_balance_transaction_id is null then
    raise exception using errcode = 'P0001', message = 'PAYMENT_SNAPSHOT_MISMATCH';
  end if;

  if exists (
    select 1
    from public.orders as orders
    where orders.id <> p_order_id
      and (
        orders.stripe_checkout_session_id = p_checkout_session_id
        or orders.stripe_payment_intent_id = p_payment_intent_id
        or orders.stripe_charge_id = p_charge_id
        or orders.stripe_transfer_id = p_transfer_id
        or orders.stripe_application_fee_id = p_application_fee_id
        or orders.stripe_balance_transaction_id = p_balance_transaction_id
      )
  ) then
    raise exception using errcode = 'P0001', message = 'PAYMENT_OBJECT_ALREADY_USED';
  end if;

  select orders.* into v_order
  from public.orders as orders
  where orders.id = p_order_id;

  select events.* into v_event
  from public.events as events
  where events.id = v_order.event_id;

  if (
    v_order.stripe_charge_id is not null
    and v_order.stripe_charge_id is distinct from p_charge_id
  ) or (
    v_order.stripe_transfer_id is not null
    and v_order.stripe_transfer_id is distinct from p_transfer_id
  ) or (
    v_order.stripe_application_fee_id is not null
    and v_order.stripe_application_fee_id is distinct from p_application_fee_id
  ) or (
    v_order.stripe_balance_transaction_id is not null
    and v_order.stripe_balance_transaction_id is distinct from p_balance_transaction_id
  ) or (
    v_order.stripe_customer_id is not null
    and v_order.stripe_customer_id is distinct from p_customer_id
  ) then
    raise exception using errcode = 'P0001', message = 'PAYMENT_SNAPSHOT_MISMATCH';
  end if;

  select
    count(*)::integer,
    jsonb_agg(
      jsonb_build_object(
        'order_item_id', items.id,
        'ticket_tier_id', items.ticket_tier_id,
        'tier_name', items.tier_name,
        'unit_amount_minor', items.unit_amount_minor,
        'quantity', items.quantity,
        'subtotal_minor', items.subtotal_minor,
        'currency', items.currency
      )
      order by items.ticket_tier_id
    )
  into v_item_count, v_digest_items
  from public.order_items as items
  where items.order_id = p_order_id;

  v_item_snapshot_valid :=
    v_order.stripe_checkout_request_digest = private.checkout_cart_request_digest(
      v_order.id,
      v_order.event_id,
      v_order.client_request_id,
      v_order.confirmation_token_hash,
      v_order.buyer_email,
      v_order.currency,
      v_order.subtotal_minor,
      v_order.application_fee_amount_minor,
      v_order.stripe_destination_account_id,
      v_order.checkout_expires_at,
      v_order.stripe_checkout_integration_identifier,
      v_digest_items
    );

  select
    count(*) > 0
      and coalesce(sum(items.quantity), 0)::bigint = v_order.quantity
      and coalesce(sum(items.subtotal_minor), 0)::bigint = v_order.subtotal_minor
      and bool_and(
        tiers.id is not null
        and tiers.event_id = v_order.event_id
        and items.currency = v_order.currency
        and items.quantity between 1 and 10
        and items.subtotal_minor::numeric
          = items.unit_amount_minor::numeric * items.quantity::numeric
      )
      and v_event.id = v_order.event_id
      and v_event.organizer_id = v_order.organizer_id
  into v_item_set_valid
  from public.order_items as items
  left join public.ticket_tiers as tiers on tiers.id = items.ticket_tier_id
  where items.order_id = p_order_id;

  v_item_set_valid := coalesce(v_item_set_valid, false)
    and coalesce(v_item_snapshot_valid, false);

  select not exists (
    select 1
    from public.order_items as current_items
    join public.ticket_tiers as current_tiers
      on current_tiers.id = current_items.ticket_tier_id
    where current_items.order_id = p_order_id
      and (
        select coalesce(sum(other_items.quantity), 0)::bigint
        from public.order_items as other_items
        join public.orders as other_orders on other_orders.id = other_items.order_id
        where other_items.ticket_tier_id = current_items.ticket_tier_id
          and other_orders.id <> p_order_id
          and (
            other_orders.status in (
              'paid', 'payment_processing', 'requires_review', 'partially_refunded'
            )
            or (
              other_orders.status in ('creating_checkout', 'checkout_open')
              and other_orders.reservation_expires_at > statement_timestamp()
            )
          )
      ) + current_items.quantity > current_tiers.quantity_total
  ) into v_inventory_valid;

  -- Validate the exact immutable source-unit manifest before any mutation.
  if p_ticket_manifest is null or jsonb_typeof(p_ticket_manifest) <> 'array' then
    raise exception using errcode = 'P0001', message = 'TICKET_MANIFEST_INVALID';
  end if;
  for v_manifest_entry in select value from jsonb_array_elements(p_ticket_manifest) loop
    if jsonb_typeof(v_manifest_entry) <> 'object' then
      raise exception using errcode = 'P0001', message = 'TICKET_MANIFEST_INVALID';
    end if;
    if (select array_agg(key order by key) from jsonb_object_keys(v_manifest_entry) as k(key))
        is distinct from array['admission_label','credential_hash','order_item_id','unit_sequence']::text[]
      or jsonb_typeof(v_manifest_entry->'order_item_id') is distinct from 'string'
      or (v_manifest_entry->>'order_item_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(v_manifest_entry->'unit_sequence') is distinct from 'number'
      or (v_manifest_entry->>'unit_sequence') !~ '^([1-9]|10)$'
      or jsonb_typeof(v_manifest_entry->'admission_label') is distinct from 'string'
      or char_length(v_manifest_entry->>'admission_label') not between 1 and 80
      or btrim(v_manifest_entry->>'admission_label') <> v_manifest_entry->>'admission_label'
      or jsonb_typeof(v_manifest_entry->'credential_hash') is distinct from 'string'
      or (v_manifest_entry->>'credential_hash') !~ '^[0-9a-f]{64}$' then
      raise exception using errcode = 'P0001', message = 'TICKET_MANIFEST_INVALID';
    end if;
  end loop;
  if jsonb_array_length(p_ticket_manifest) is distinct from (
      select coalesce(sum(i.quantity),0) from public.order_items as i where i.order_id = p_order_id)
    or exists (
      select 1 from jsonb_array_elements(p_ticket_manifest) as m(value)
      left join public.order_items as i on i.id::text = m.value->>'order_item_id' and i.order_id = p_order_id
      where i.id is null or (m.value->>'unit_sequence')::integer not between 1 and i.quantity
        or m.value->>'admission_label' <> i.tier_name
    ) or exists (
      select 1 from jsonb_array_elements(p_ticket_manifest) as m(value)
      group by m.value->>'order_item_id',m.value->>'unit_sequence' having count(*) > 1
    ) or exists (
      select 1 from jsonb_array_elements(p_ticket_manifest) as m(value)
      group by m.value->>'credential_hash' having count(*) > 1
    ) or exists (
      select 1 from jsonb_array_elements(p_ticket_manifest) as m(value)
      join public.tickets as t on t.credential_hash = decode(m.value->>'credential_hash','hex')
      where t.order_id <> p_order_id
    ) then
    raise exception using errcode = 'P0001', message = 'TICKET_MANIFEST_INVALID';
  end if;

  select
    count(*)::bigint,
    count(*)::bigint = v_order.quantity
      and not exists (
        select 1
        from public.order_items as expected_items
        cross join lateral generate_series(
          1,
          expected_items.quantity
        ) as expected_sequences(unit_sequence)
        where expected_items.order_id = p_order_id
          and not exists (
            select 1
            from public.tickets as expected_ticket
            where expected_ticket.order_id = p_order_id
              and expected_ticket.order_item_id = expected_items.id
              and expected_ticket.unit_sequence = expected_sequences.unit_sequence
              and expected_ticket.event_id = v_order.event_id
              and expected_ticket.organizer_id = v_order.organizer_id
              and expected_ticket.ticket_tier_id = expected_items.ticket_tier_id
              and expected_ticket.admission_label = expected_items.tier_name
              and exists (
                select 1 from jsonb_array_elements(p_ticket_manifest) as m(value)
                where m.value->>'order_item_id' = expected_ticket.order_item_id::text
                  and (m.value->>'unit_sequence')::integer = expected_ticket.unit_sequence
                  and decode(m.value->>'credential_hash','hex') = expected_ticket.credential_hash
              )
          )
      )
      and not exists (
        select 1
        from public.tickets as actual_ticket
        left join public.order_items as actual_item
          on actual_item.id = actual_ticket.order_item_id
          and actual_item.order_id = p_order_id
        where actual_ticket.order_id = p_order_id
          and (
            actual_item.id is null
            or actual_ticket.unit_sequence < 1
            or actual_ticket.unit_sequence > actual_item.quantity
            or actual_ticket.event_id <> v_order.event_id
            or actual_ticket.organizer_id <> v_order.organizer_id
            or actual_ticket.ticket_tier_id <> actual_item.ticket_tier_id
          )
      ),
    coalesce(bool_and(
      tickets.refunded_at is null and (
        (tickets.status = 'used' and tickets.used_at is not null and tickets.cancelled_at is null)
        or (v_event.status <> 'cancelled' and tickets.status = 'valid'
          and tickets.used_at is null and tickets.cancelled_at is null)
        or (v_event.status = 'cancelled'
          and tickets.status = 'cancelled' and tickets.used_at is null and tickets.cancelled_at is not null)
      )
    ), false)
  into v_ticket_count, v_ticket_set_exact, v_ticket_set_valid
  from public.tickets as tickets
  where tickets.order_id = p_order_id;

  -- Valid admission is coherent only for a fully paid order. Pre-payment
  -- states require no ticket history; review, refund, and invalidated terminal
  -- states may retain history but never a still-valid admission.
  v_ticket_lifecycle_valid := case
    when v_order.status = 'paid' then
      coalesce(v_ticket_set_exact, false)
        and coalesce(v_ticket_set_valid, false)
    when v_order.status in (
      'creating_checkout', 'checkout_open', 'payment_processing'
    ) then
      v_ticket_count = 0
    when v_order.status in (
      'expired', 'payment_failed', 'cancelled', 'partially_refunded',
      'refunded', 'requires_review'
    ) then
      not exists (
        select 1
        from public.tickets as lifecycle_ticket
        where lifecycle_ticket.order_id = p_order_id
          and lifecycle_ticket.status = 'valid'
      )
    else false
  end;

  v_ticket_mismatch := not v_item_set_valid
    or (
      v_ticket_count > 0
      and not coalesce(v_ticket_set_exact, false)
    )
    or not coalesce(v_ticket_lifecycle_valid, false);

  if v_ticket_mismatch then
    update public.orders as orders
    set stripe_payment_intent_id = coalesce(
          orders.stripe_payment_intent_id,
          p_payment_intent_id
        ),
        stripe_charge_id = coalesce(orders.stripe_charge_id, p_charge_id),
        stripe_transfer_id = coalesce(orders.stripe_transfer_id, p_transfer_id),
        stripe_application_fee_id = coalesce(
          orders.stripe_application_fee_id,
          p_application_fee_id
        ),
        stripe_balance_transaction_id = coalesce(
          orders.stripe_balance_transaction_id,
          p_balance_transaction_id
        ),
        stripe_customer_id = coalesce(orders.stripe_customer_id, p_customer_id),
        paid_at = coalesce(orders.paid_at, statement_timestamp()),
        status = case
          when orders.status = 'refunded' then 'refunded'
          else 'requires_review'
        end,
        reconciliation_status = 'requires_review',
        failure_code = 'TICKET_SET_MISMATCH',
        last_stripe_event_id = p_stripe_event_id
    where orders.id = p_order_id
    returning orders.* into v_order;

    update public.tickets as tickets
    set status = 'cancelled',
        cancelled_at = coalesce(tickets.cancelled_at, statement_timestamp()),
        refunded_at = null
    where tickets.order_id = p_order_id
      and tickets.status = 'valid';

    update public.stripe_webhook_events as receipts
    set processing_status = 'processed',
        processed_at = coalesce(receipts.processed_at, statement_timestamp()),
        error_code = 'TICKET_SET_MISMATCH'
    where receipts.stripe_event_id = p_stripe_event_id;

    select count(*)::bigint into v_ticket_count
    from public.tickets as tickets
    where tickets.order_id = p_order_id;

    return query select v_order.id, v_order.status, v_ticket_count;
    return;
  end if;

  if v_order.status in ('paid', 'partially_refunded', 'refunded', 'requires_review') then
    update public.stripe_webhook_events as receipts
    set processing_status = 'processed',
        processed_at = coalesce(receipts.processed_at, statement_timestamp()),
        error_code = null
    where receipts.stripe_event_id = p_stripe_event_id;

    return query select v_order.id, v_order.status, v_ticket_count;
    return;
  end if;

  v_invalidated :=
    v_order.status in ('expired', 'payment_failed', 'cancelled')
    or (
      v_order.status in ('creating_checkout', 'checkout_open')
      and v_order.reservation_expires_at <= statement_timestamp()
    )
    or not private.event_has_current_public_eligibility(v_event.id)
    or v_event.admission_type is distinct from 'paid'
    or exists (
      select 1
      from public.order_items as items
      join public.ticket_tiers as tiers on tiers.id = items.ticket_tier_id
      where items.order_id = p_order_id
        and (
          tiers.status is distinct from 'active'
          or tiers.event_id is distinct from v_event.id
        )
    )
    or not coalesce(v_inventory_valid, false);

  if not v_invalidated and v_ticket_count = 0 then
    insert into public.tickets (
      order_id,
      order_item_id,
      event_id,
      organizer_id,
      ticket_tier_id,
      unit_sequence,
      admission_label,
      credential_hash
    )
    select
      p_order_id,
      items.id,
      v_order.event_id,
      v_order.organizer_id,
      items.ticket_tier_id,
      sequences.unit_sequence,
      items.tier_name,
      decode(manifest.value->>'credential_hash','hex')
    from public.order_items as items
    cross join lateral generate_series(1, items.quantity)
      as sequences(unit_sequence)
    join jsonb_array_elements(p_ticket_manifest) as manifest(value)
      on manifest.value->>'order_item_id' = items.id::text
      and (manifest.value->>'unit_sequence')::integer = sequences.unit_sequence
    where items.order_id = p_order_id
    order by items.ticket_tier_id, items.id, sequences.unit_sequence;

    select
      count(*)::bigint,
      count(*)::bigint = v_order.quantity
        and not exists (
          select 1
          from public.order_items as expected_items
          cross join lateral generate_series(
            1,
            expected_items.quantity
          ) as expected_sequences(unit_sequence)
          where expected_items.order_id = p_order_id
            and not exists (
              select 1
              from public.tickets as expected_ticket
              where expected_ticket.order_id = p_order_id
                and expected_ticket.order_item_id = expected_items.id
                and expected_ticket.unit_sequence = expected_sequences.unit_sequence
                and expected_ticket.event_id = v_order.event_id
                and expected_ticket.organizer_id = v_order.organizer_id
                and expected_ticket.ticket_tier_id = expected_items.ticket_tier_id
              and expected_ticket.admission_label = expected_items.tier_name
              and exists (
                select 1 from jsonb_array_elements(p_ticket_manifest) as m(value)
                where m.value->>'order_item_id' = expected_ticket.order_item_id::text
                  and (m.value->>'unit_sequence')::integer = expected_ticket.unit_sequence
                  and decode(m.value->>'credential_hash','hex') = expected_ticket.credential_hash
              )
                and expected_ticket.status = 'valid'
                and expected_ticket.used_at is null
                and expected_ticket.refunded_at is null
                and expected_ticket.cancelled_at is null
            )
        )
        and not exists (
          select 1
          from public.tickets as actual_ticket
          left join public.order_items as actual_item
            on actual_item.id = actual_ticket.order_item_id
            and actual_item.order_id = p_order_id
          where actual_ticket.order_id = p_order_id
            and (
              actual_item.id is null
              or actual_ticket.unit_sequence < 1
              or actual_ticket.unit_sequence > actual_item.quantity
              or actual_ticket.event_id <> v_order.event_id
              or actual_ticket.organizer_id <> v_order.organizer_id
              or actual_ticket.ticket_tier_id <> actual_item.ticket_tier_id
              or actual_ticket.used_at is not null
              or actual_ticket.status <> 'valid'
              or actual_ticket.refunded_at is not null
              or actual_ticket.cancelled_at is not null
            )
        )
    into v_ticket_count, v_ticket_set_exact
    from public.tickets as tickets
    where tickets.order_id = p_order_id;

    if not coalesce(v_ticket_set_exact, false) then
      raise exception using errcode = 'P0001', message = 'TICKET_GENERATION_FAILED';
    end if;
  end if;

  update public.orders as orders
  set stripe_payment_intent_id = coalesce(
        orders.stripe_payment_intent_id,
        p_payment_intent_id
      ),
      stripe_charge_id = coalesce(orders.stripe_charge_id, p_charge_id),
      stripe_transfer_id = coalesce(orders.stripe_transfer_id, p_transfer_id),
      stripe_application_fee_id = coalesce(
        orders.stripe_application_fee_id,
        p_application_fee_id
      ),
      stripe_balance_transaction_id = coalesce(
        orders.stripe_balance_transaction_id,
        p_balance_transaction_id
      ),
      stripe_customer_id = coalesce(orders.stripe_customer_id, p_customer_id),
      paid_at = coalesce(orders.paid_at, statement_timestamp()),
      status = case when v_invalidated then 'requires_review' else 'paid' end,
      reconciliation_status = case
        when v_invalidated then 'requires_review'
        else 'reconciled'
      end,
      failure_code = case
        when v_invalidated then 'PAYMENT_AFTER_INVALIDATION'
        else null
      end,
      last_stripe_event_id = p_stripe_event_id
  where orders.id = p_order_id
  returning orders.* into v_order;

  update public.stripe_webhook_events as receipts
  set processing_status = 'processed',
      processed_at = coalesce(receipts.processed_at, statement_timestamp()),
      error_code = null
  where receipts.stripe_event_id = p_stripe_event_id;

  select count(*)::bigint into v_ticket_count
  from public.tickets as tickets
  where tickets.order_id = p_order_id;

  return query select v_order.id, v_order.status, v_ticket_count;
end;
$$;

revoke all on function private.fulfill_paid_order(
  text, uuid, text, text, text, text, text, text, text, text, text, text,
  bigint, bigint, bigint, text, jsonb
) from public, anon, authenticated, service_role;

create function public.server_fulfill_paid_order(
  p_stripe_event_id text,
  p_order_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_charge_id text,
  p_transfer_id text,
  p_application_fee_id text,
  p_balance_transaction_id text,
  p_customer_id text,
  p_mode text,
  p_payment_status text,
  p_currency text,
  p_subtotal_minor bigint,
  p_total_minor bigint,
  p_application_fee_amount_minor bigint,
  p_destination_account_id text,
  p_ticket_manifest jsonb
)
returns table (
  order_id uuid,
  order_status text,
  ticket_count bigint
)
language sql
security definer
set search_path = ''
as $$
  select *
  from private.fulfill_paid_order(
    p_stripe_event_id,
    p_order_id,
    p_checkout_session_id,
    p_payment_intent_id,
    p_charge_id,
    p_transfer_id,
    p_application_fee_id,
    p_balance_transaction_id,
    p_customer_id,
    p_mode,
    p_payment_status,
    p_currency,
    p_subtotal_minor,
    p_total_minor,
    p_application_fee_amount_minor,
    p_destination_account_id,
    p_ticket_manifest
  );
$$;

revoke all on function public.server_fulfill_paid_order(text, uuid, text, text, text, text, text, text, text, text, text, text, bigint, bigint, bigint, text, jsonb) from public,anon,authenticated,service_role;
grant execute on function public.server_fulfill_paid_order(text, uuid, text, text, text, text, text, text, text, text, text, text, bigint, bigint, bigint, text, jsonb) to service_role;
