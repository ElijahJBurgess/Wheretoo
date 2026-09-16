-- Forward recovery only. No historical receipt/order is selected or repaired by this migration.
-- Candidate data is evidence to validate; only the atomic service writer grants attachment.
create function private.unattached_checkout_snapshot(p_order_id uuid, p_session_id text)
returns table(order_id uuid, checkout_session_id text, event_id uuid, currency text,
  subtotal_minor bigint, total_minor bigint, application_fee_amount_minor bigint,
  destination_account_id text, order_items jsonb, checkout_request_id uuid,
  checkout_expires_at timestamptz, create_digest text, snapshot_digest text)
language sql stable security definer set search_path = '' as $$
  select o.id, p_session_id, o.event_id, o.currency, o.subtotal_minor, o.total_minor,
    o.application_fee_amount_minor, o.stripe_destination_account_id, i.items,
    o.client_request_id, o.checkout_expires_at, o.stripe_checkout_request_digest,
    encode(extensions.digest(jsonb_build_object(
      'contract','unattached_checkout_v1','order_id',o.id,'session_id',p_session_id,
      'create_digest',o.stripe_checkout_request_digest,'items',i.items,
      'total_minor',o.total_minor,'organizer_id',o.organizer_id
    )::text,'sha256'),'hex')
  from public.orders o
  cross join lateral (
    select jsonb_agg(jsonb_build_object('order_item_id',x.id,'ticket_tier_id',x.ticket_tier_id,
      'tier_name',x.tier_name,'unit_amount_minor',x.unit_amount_minor,'quantity',x.quantity,
      'subtotal_minor',x.subtotal_minor,'currency',x.currency) order by x.ticket_tier_id) items,
      count(*) item_count, sum(x.quantity) quantity, sum(x.subtotal_minor) subtotal,
      bool_and(x.quantity between 1 and 10 and x.currency=o.currency
        and x.subtotal_minor::numeric=x.unit_amount_minor::numeric*x.quantity::numeric) coherent
    from public.order_items x where x.order_id=o.id
  ) i
  where o.id=p_order_id and not o.livemode
    and p_session_id ~ '^cs_test_[A-Za-z0-9]+$'
    and (o.stripe_checkout_session_id is null or o.stripe_checkout_session_id=p_session_id)
    and (o.failure_code is distinct from 'UNATTACHED_PAID_CHECKOUT' or exists (
      select 1 from public.stripe_webhook_events anchor where anchor.stripe_event_id=o.last_stripe_event_id
        and not anchor.livemode and anchor.stripe_object_id=p_session_id
        and anchor.processing_status='processed' and anchor.error_code='UNATTACHED_PAID_CHECKOUT'))
    and o.client_request_id is not null and o.checkout_expires_at is not null
    and o.stripe_checkout_request_digest<>repeat('0',64)
    and o.stripe_checkout_request_digest=private.checkout_cart_request_digest(
      o.id,o.event_id,o.client_request_id,o.confirmation_token_hash,o.buyer_email,o.currency,
      o.subtotal_minor,o.application_fee_amount_minor,o.stripe_destination_account_id,
      o.checkout_expires_at,o.stripe_checkout_integration_identifier,i.items)
    and i.item_count between 1 and 3 and i.quantity=o.quantity and i.subtotal=o.subtotal_minor
    and i.coherent and o.total_minor=o.subtotal_minor and o.tax_amount_minor=0;
$$;

create function public.server_get_unattached_checkout_review_snapshot(
  p_order_id uuid, p_session_id text, p_stripe_event_id text)
returns table(order_id uuid, checkout_session_id text, event_id uuid, currency text,
  subtotal_minor bigint, total_minor bigint, application_fee_amount_minor bigint,
  destination_account_id text, order_items jsonb, checkout_request_id uuid,
  checkout_expires_at timestamptz, create_digest text, snapshot_digest text)
language sql stable security definer set search_path = '' as $$
  select s.* from private.unattached_checkout_snapshot(p_order_id,p_session_id) s
  join public.orders o on o.id=s.order_id
  where (o.stripe_checkout_session_id=p_session_id or (
    o.stripe_checkout_session_id is null
    and o.status in ('creating_checkout','expired','cancelled','payment_failed','requires_review')
    and not exists(select 1 from public.tickets t where t.order_id=o.id)))
    and exists(select 1 from public.stripe_webhook_events r
      where r.stripe_event_id=p_stripe_event_id and not r.livemode
        and r.stripe_object_id=p_session_id
        and r.event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded')
        and r.processing_status='processing' and r.processed_at is null);
$$;

create function private.reconcile_unattached_paid_checkout(
  p_order_id uuid, p_session_id text, p_stripe_event_id text,
  p_expected_snapshot_digest text, p_payment_snapshot jsonb, p_ticket_manifest jsonb)
returns table(order_id uuid, order_status text, ticket_count bigint, disposition text)
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_receipt public.stripe_webhook_events;
  v_snapshot record;
  v_fulfilled record;
  v_payment jsonb := p_payment_snapshot;
  v_count bigint;
  v_review boolean := false;
  v_was_attached boolean;
begin
  -- Identical event -> tiers -> event row -> order -> items hierarchy as existing fulfillment.
  perform * from private.lock_payment_order(p_order_id);
  -- Only new reconciliation writers take this additional key, after the existing
  -- hierarchy. They never acquire another order lock while holding it. Existing
  -- attach races on this order remain serialized by lock_payment_order; original
  -- handlers still validate provider order metadata before calling old attach.
  if p_session_id is null or p_session_id !~ '^cs_test_[A-Za-z0-9]+$' then
    raise exception using errcode='P0001',message='PAYMENT_SNAPSHOT_MISMATCH'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('unattached-checkout-session:'||p_session_id,0));
  select o.* into v_order from public.orders o where o.id=p_order_id;
  select r.* into v_receipt from public.stripe_webhook_events r
    where r.stripe_event_id=p_stripe_event_id for update;
  if not found or v_receipt.livemode or v_receipt.stripe_object_id is distinct from p_session_id
    or v_receipt.event_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded')
    or p_stripe_event_id is null or p_stripe_event_id !~ '^evt_[A-Za-z0-9]+$'
    or p_session_id is null or p_session_id !~ '^cs_test_[A-Za-z0-9]+$'
  then raise exception using errcode='P0001',message='WEBHOOK_RECEIPT_MISMATCH'; end if;
  select * into v_snapshot from private.unattached_checkout_snapshot(p_order_id,p_session_id);
  if not found or p_expected_snapshot_digest is null
    or v_snapshot.snapshot_digest is distinct from p_expected_snapshot_digest
  then raise exception using errcode='P0001',message='PAYMENT_SNAPSHOT_MISMATCH'; end if;

  if v_payment is null or jsonb_typeof(v_payment)<>'object' then
    raise exception using errcode='P0001',message='PAYMENT_SNAPSHOT_MISMATCH'; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(v_payment) k) is distinct from
    array['application_fee_amount_minor','application_fee_id','balance_transaction_id','charge_id',
      'checkout_expires_at','currency','customer_id','destination_account_id','mode','payment_affected',
      'payment_intent_id','payment_status','subtotal_minor','total_minor','transfer_id']::text[]
    or jsonb_typeof(v_payment->'payment_intent_id') is distinct from 'string'
    or (v_payment->>'payment_intent_id') !~ '^pi_[A-Za-z0-9]+$'
    or jsonb_typeof(v_payment->'charge_id') is distinct from 'string'
    or (v_payment->>'charge_id') !~ '^ch_[A-Za-z0-9]+$'
    or jsonb_typeof(v_payment->'transfer_id') is distinct from 'string'
    or (v_payment->>'transfer_id') !~ '^tr_[A-Za-z0-9]+$'
    or jsonb_typeof(v_payment->'application_fee_id') is distinct from 'string'
    or (v_payment->>'application_fee_id') !~ '^fee_[A-Za-z0-9]+$'
    or jsonb_typeof(v_payment->'balance_transaction_id') is distinct from 'string'
    or (v_payment->>'balance_transaction_id') !~ '^txn_[A-Za-z0-9]+$'
    or (v_payment->'customer_id'<>'null'::jsonb and
      (jsonb_typeof(v_payment->'customer_id') is distinct from 'string' or (v_payment->>'customer_id') !~ '^cus_[A-Za-z0-9]+$'))
    or v_payment->>'mode' is distinct from 'payment'
    or v_payment->>'payment_status' is distinct from 'paid'
    or v_payment->'currency' is distinct from to_jsonb(v_order.currency)
    or v_payment->'subtotal_minor' is distinct from to_jsonb(v_order.subtotal_minor)
    or v_payment->'total_minor' is distinct from to_jsonb(v_order.total_minor)
    or v_payment->'application_fee_amount_minor' is distinct from to_jsonb(v_order.application_fee_amount_minor)
    or v_payment->'destination_account_id' is distinct from to_jsonb(v_order.stripe_destination_account_id)
    or v_payment->'checkout_expires_at' is distinct from to_jsonb(extract(epoch from v_order.checkout_expires_at)::bigint)
    or jsonb_typeof(v_payment->'payment_affected') is distinct from 'boolean'
  then raise exception using errcode='P0001',message='PAYMENT_SNAPSHOT_MISMATCH'; end if;

  -- A conflicting object can never poison another order or replace an attachment.
  if exists(select 1 from public.orders o where o.id<>p_order_id and (
    o.stripe_checkout_session_id=p_session_id or exists (
      select 1 from public.stripe_webhook_events anchor where anchor.stripe_event_id=o.last_stripe_event_id
        and o.failure_code='UNATTACHED_PAID_CHECKOUT' and o.reconciliation_status='requires_review'
        and not anchor.livemode and anchor.stripe_object_id=p_session_id
        and anchor.processing_status='processed' and anchor.error_code='UNATTACHED_PAID_CHECKOUT')
    or o.stripe_payment_intent_id=v_payment->>'payment_intent_id'
    or o.stripe_charge_id=v_payment->>'charge_id' or o.stripe_transfer_id=v_payment->>'transfer_id'
    or o.stripe_application_fee_id=v_payment->>'application_fee_id'
    or o.stripe_balance_transaction_id=v_payment->>'balance_transaction_id'))
  then raise exception using errcode='P0001',message='PAYMENT_OBJECT_ALREADY_USED'; end if;
  if (v_order.stripe_payment_intent_id is not null and v_order.stripe_payment_intent_id is distinct from v_payment->>'payment_intent_id')
    or (v_order.stripe_charge_id is not null and v_order.stripe_charge_id is distinct from v_payment->>'charge_id')
    or (v_order.stripe_transfer_id is not null and v_order.stripe_transfer_id is distinct from v_payment->>'transfer_id')
    or (v_order.stripe_application_fee_id is not null and v_order.stripe_application_fee_id is distinct from v_payment->>'application_fee_id')
    or (v_order.stripe_balance_transaction_id is not null and v_order.stripe_balance_transaction_id is distinct from v_payment->>'balance_transaction_id')
  then raise exception using errcode='P0001',message='PAYMENT_SNAPSHOT_MISMATCH'; end if;
  select count(*) into v_count from public.tickets t where t.order_id=p_order_id;
  if v_receipt.processing_status='processed' then
    -- Never reopen a permanent failed receipt, including historical J08g.
    if v_receipt.error_code='UNATTACHED_PAID_CHECKOUT' and v_order.stripe_checkout_session_id is null
      and v_order.failure_code='UNATTACHED_PAID_CHECKOUT' and v_order.reconciliation_status='requires_review' and v_count=0
    then return query select v_order.id,v_order.status,v_count,'review'::text; return;
    elsif v_receipt.error_code is null and v_order.stripe_checkout_session_id=p_session_id
      and v_order.status in ('paid','partially_refunded','refunded') and v_count=v_order.quantity
    then return query select v_order.id,v_order.status,v_count,'replay'::text; return;
    else raise exception using errcode='P0001',message='WEBHOOK_RECEIPT_MISMATCH'; end if;
  end if;
  if v_receipt.processing_status<>'processing' or v_receipt.processed_at is not null
  then raise exception using errcode='P0001',message='WEBHOOK_RECEIPT_MISMATCH'; end if;
  v_was_attached := v_order.stripe_checkout_session_id is not null;
  if not v_was_attached and (v_count<>0 or v_order.status not in
    ('creating_checkout','expired','cancelled','payment_failed','requires_review'))
  then raise exception using errcode='P0001',message='PAYMENT_SNAPSHOT_MISMATCH'; end if;

  if v_was_attached and (v_payment->>'payment_affected')::boolean then
    raise exception using errcode='P0001',message='ORDER_CHANGED_RETRY';
  end if;
  if not v_was_attached and v_order.status='requires_review' and v_order.failure_code is distinct from 'UNATTACHED_PAID_CHECKOUT' then
    raise exception using errcode='P0001',message='ORDER_CHANGED_RETRY';
  end if;
  v_review := not v_was_attached and (v_order.status<>'creating_checkout'
    or v_order.reservation_expires_at<=statement_timestamp() or (v_payment->>'payment_affected')::boolean);
  if not v_review then
    begin
      if not v_was_attached then
        perform private.attach_checkout_session(p_order_id,p_session_id,v_order.checkout_expires_at);
      end if;
      -- Reuses all current inventory/eligibility/manifest/lifecycle checks and initial email enqueue.
      select * into v_fulfilled from public.server_fulfill_paid_order(
        p_stripe_event_id,p_order_id,p_session_id,v_payment->>'payment_intent_id',v_payment->>'charge_id',
        v_payment->>'transfer_id',v_payment->>'application_fee_id',v_payment->>'balance_transaction_id',
        v_payment->>'customer_id','payment','paid',v_order.currency,v_order.subtotal_minor,v_order.total_minor,
        v_order.application_fee_amount_minor,v_order.stripe_destination_account_id,p_ticket_manifest);
      if not v_was_attached and v_fulfilled.order_status<>'paid' then
        -- Subtransaction rolls back attachment, fulfillment, receipt and email enqueue together.
        raise exception using errcode='P0001',message='UNATTACHED_ELIGIBILITY_REVIEW';
      end if;
      return query select v_fulfilled.order_id,v_fulfilled.order_status,v_fulfilled.ticket_count,
        case when v_fulfilled.order_status='requires_review' then 'review'
          when v_was_attached then 'replay' else 'fulfilled' end;
      return;
    exception when raise_exception then
      if not v_was_attached and SQLERRM in ('CHECKOUT_EXPIRED','UNATTACHED_ELIGIBILITY_REVIEW') then
        v_review := true;
      else raise; end if;
    end;
  end if;
  if v_review then
    update public.orders o set
      status=case when o.status='creating_checkout' then 'requires_review' else o.status end,
      reconciliation_status='requires_review',failure_code='UNATTACHED_PAID_CHECKOUT',last_stripe_event_id=p_stripe_event_id
    where o.id=p_order_id;
    update public.stripe_webhook_events r set processing_status='processed',processed_at=statement_timestamp(),
      error_code='UNATTACHED_PAID_CHECKOUT' where r.stripe_event_id=p_stripe_event_id;
    return query select o.id,o.status,0::bigint,'review'::text from public.orders o where o.id=p_order_id;
  end if;
end;
$$;

create function public.server_reconcile_unattached_paid_checkout(
  p_order_id uuid, p_session_id text, p_stripe_event_id text,
  p_expected_snapshot_digest text, p_payment_snapshot jsonb, p_ticket_manifest jsonb)
returns table(order_id uuid, order_status text, ticket_count bigint, disposition text)
language sql security definer set search_path = '' as $$
  select * from private.reconcile_unattached_paid_checkout(p_order_id,p_session_id,p_stripe_event_id,
    p_expected_snapshot_digest,p_payment_snapshot,p_ticket_manifest);
$$;

revoke all on function private.unattached_checkout_snapshot(uuid,text) from public,anon,authenticated,service_role;
revoke all on function private.reconcile_unattached_paid_checkout(uuid,text,text,text,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.server_get_unattached_checkout_review_snapshot(uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.server_reconcile_unattached_paid_checkout(uuid,text,text,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.server_get_unattached_checkout_review_snapshot(uuid,text,text) to service_role;
grant execute on function public.server_reconcile_unattached_paid_checkout(uuid,text,text,text,jsonb,jsonb) to service_role;

-- Preserve existing terminal status while projecting the received-payment review truthfully.
CREATE OR REPLACE FUNCTION private.lookup_checkout_integrity_confirmation(p_token_hash text)
 RETURNS TABLE(event_title text, event_starts_at timestamp with time zone, event_ends_at timestamp with time zone, event_timezone text, event_venue_name text, items jsonb, order_number text, confirmation_status text, quantity integer, currency text, subtotal_minor bigint, tax_amount_minor bigint, total_minor bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    case when orders.stripe_checkout_session_id is null
      and orders.status in ('creating_checkout','expired','cancelled','payment_failed','requires_review')
      and orders.reconciliation_status='requires_review'
      and orders.failure_code='UNATTACHED_PAID_CHECKOUT' then 'requires_review'
    else case orders.status
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
    end end,
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
$function$;
