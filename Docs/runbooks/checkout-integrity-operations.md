# Checkout Integrity 1.0 Operations

This runbook is for the database owner/operator. It is an internal integrity
tool, not organizer analytics. Run every diagnostic query in a read-only
session against the intended environment and inspect the environment name
before continuing:

```sql
begin transaction read only;
-- Run one or more diagnostics from this document.
rollback;
```

The projections below intentionally contain only counts, opaque identifiers,
statuses, timestamps/ages, currency, and integer aggregate money/quantity.
Never add buyer fields, confirmation hashes or bearers, authorization values,
provider payloads or digests, raw error content, payment details, or request
metadata to an operational export.

## Immediate triage

Correlate sanitized function events by `orderId`, internal `eventId`,
`stripeEventId`, and a non-secret provider object identifier only when that
identifier is already known. Treat browser state as navigation state, never as
proof of payment. Durable order, receipt, refund, and ticket rows remain the
authority.

Escalate any nonempty anomaly query before enabling new sales. Preserve every
financial record while investigating.

## Order and item aggregates

Detect a missing item set or disagreement between order and item quantity,
subtotal, or currency.

```sql
with item_totals as (
  select
    items.order_id,
    count(*)::bigint as item_count,
    coalesce(sum(items.quantity), 0)::bigint as item_quantity,
    coalesce(sum(items.subtotal_minor), 0)::bigint as item_subtotal_minor,
    count(distinct items.currency)::bigint as item_currency_count,
    min(items.currency) as item_currency
  from public.order_items as items
  group by items.order_id
)
select
  orders.id as order_id,
  orders.status,
  orders.currency,
  orders.quantity as order_quantity,
  coalesce(item_totals.item_count, 0) as item_count,
  coalesce(item_totals.item_quantity, 0) as item_quantity,
  orders.subtotal_minor as order_subtotal_minor,
  coalesce(item_totals.item_subtotal_minor, 0) as item_subtotal_minor
from public.orders as orders
left join item_totals on item_totals.order_id = orders.id
where coalesce(item_totals.item_count, 0) = 0
   or coalesce(item_totals.item_quantity, 0) <> orders.quantity
   or coalesce(item_totals.item_subtotal_minor, 0) <> orders.subtotal_minor
   or item_totals.item_currency_count <> 1
   or item_totals.item_currency is distinct from orders.currency
order by orders.id;
```

Detect duplicate tiers within one order, even if a database constraint has
been disabled or damaged.

```sql
select
  items.order_id,
  items.ticket_tier_id,
  count(*)::bigint as duplicate_count
from public.order_items as items
group by items.order_id, items.ticket_tier_id
having count(*) > 1
order by items.order_id, items.ticket_tier_id;
```

Detect item tiers from another event, an event owned by another organizer, or
mixed currencies.

```sql
select
  orders.id as order_id,
  orders.status,
  orders.event_id,
  orders.organizer_id,
  orders.currency,
  count(*)::bigint as item_count,
  count(distinct tiers.event_id)::bigint as tier_event_count,
  count(distinct items.currency)::bigint as item_currency_count
from public.orders as orders
join public.order_items as items on items.order_id = orders.id
left join public.ticket_tiers as tiers on tiers.id = items.ticket_tier_id
left join public.events as events on events.id = tiers.event_id
group by
  orders.id,
  orders.status,
  orders.event_id,
  orders.organizer_id,
  orders.currency
having bool_or(tiers.id is null)
    or bool_or(tiers.event_id is distinct from orders.event_id)
    or bool_or(events.organizer_id is distinct from orders.organizer_id)
    or bool_or(items.currency is distinct from orders.currency)
    or count(distinct tiers.event_id) <> 1
    or count(distinct items.currency) <> 1
order by orders.id;
```

## Fulfillment and ticket integrity

Detect paid orders without exactly one coherent ticket per purchased unit.

```sql
with ticket_totals as (
  select
    tickets.order_id,
    count(*)::bigint as ticket_count,
    count(*) filter (where tickets.status = 'valid')::bigint
      as valid_ticket_count
  from public.tickets as tickets
  group by tickets.order_id
)
select
  orders.id as order_id,
  orders.status,
  orders.quantity as expected_ticket_count,
  coalesce(ticket_totals.ticket_count, 0) as ticket_count,
  coalesce(ticket_totals.valid_ticket_count, 0) as valid_ticket_count,
  orders.paid_at
from public.orders as orders
left join ticket_totals on ticket_totals.order_id = orders.id
where orders.status = 'paid'
  and (
    coalesce(ticket_totals.ticket_count, 0) <> orders.quantity
    or coalesce(ticket_totals.valid_ticket_count, 0) <> orders.quantity
  )
order by orders.id;
```

Detect ticket references or unit sequences that disagree with their order and
order item. Sequence completeness applies once an order has any issued ticket:
an ordinary zero-ticket open, expired, cancelled, or payment-failed order is
not anomalous here, while a partial issued set (including an entirely missing
order-item slice) still exposes gaps in the required `1..quantity` sequence.
The separate paid-order query above continues to catch paid zero-ticket sets.

```sql
with incoherent_references as (
  select tickets.order_id, tickets.id as ticket_id
  from public.tickets as tickets
  left join public.orders as orders on orders.id = tickets.order_id
  left join public.order_items as items on items.id = tickets.order_item_id
  where orders.id is null
     or items.id is null
     or items.order_id is distinct from tickets.order_id
     or tickets.event_id is distinct from orders.event_id
     or tickets.organizer_id is distinct from orders.organizer_id
     or tickets.ticket_tier_id is distinct from items.ticket_tier_id
     or tickets.unit_sequence < 1
     or tickets.unit_sequence > items.quantity
), missing_sequences as (
  select items.order_id, items.id as order_item_id
  from public.order_items as items
  cross join lateral generate_series(1, items.quantity)
    as expected(unit_sequence)
  where exists (
    select 1
    from public.tickets as issued
    where issued.order_id = items.order_id
  )
  and not exists (
    select 1
    from public.tickets as tickets
    where tickets.order_id = items.order_id
      and tickets.order_item_id = items.id
      and tickets.unit_sequence = expected.unit_sequence
  )
), duplicate_sequences as (
  select
    tickets.order_id,
    tickets.order_item_id,
    tickets.unit_sequence
  from public.tickets as tickets
  group by tickets.order_id, tickets.order_item_id, tickets.unit_sequence
  having count(*) > 1
)
select
  'incoherent_reference'::text as anomaly_status,
  incoherent_references.order_id,
  incoherent_references.ticket_id as object_id
from incoherent_references
union all
select
  'missing_sequence'::text as anomaly_status,
  missing_sequences.order_id,
  missing_sequences.order_item_id as object_id
from missing_sequences
union all
select
  'duplicate_sequence'::text as anomaly_status,
  duplicate_sequences.order_id,
  duplicate_sequences.order_item_id as object_id
from duplicate_sequences
order by order_id, anomaly_status, object_id;
```

## Reservation cleanup and inventory

Count cleanup-eligible reservations and report the oldest expiry and age. A
nonzero count should drain on the next scheduled run; a growing oldest age is
an incident signal.

```sql
select
  count(*)::bigint as cleanup_eligible_count,
  min(orders.reservation_expires_at) as oldest_eligible_at,
  coalesce(
    floor(extract(epoch from (
      statement_timestamp() - min(orders.reservation_expires_at)
    )))::bigint,
    0
  ) as oldest_eligible_age_seconds
from public.orders as orders
where orders.status in ('creating_checkout', 'checkout_open')
  and orders.reservation_expires_at <= statement_timestamp();
```

Review orders must remain in protected inventory counts. This query surfaces
their quantity explicitly and detects a protected total above tier capacity.

```sql
with protected_inventory as (
  select
    items.ticket_tier_id,
    tiers.quantity_total,
    coalesce(sum(items.quantity) filter (
      where orders.status = 'requires_review'
    ), 0)::bigint as review_quantity,
    coalesce(sum(items.quantity) filter (
      where orders.status in (
        'paid', 'payment_processing', 'requires_review', 'partially_refunded'
      ) or (
        orders.status in ('creating_checkout', 'checkout_open')
        and orders.reservation_expires_at > statement_timestamp()
      )
    ), 0)::bigint as protected_quantity
  from public.ticket_tiers as tiers
  join public.order_items as items on items.ticket_tier_id = tiers.id
  join public.orders as orders on orders.id = items.order_id
  group by items.ticket_tier_id, tiers.quantity_total
)
select
  ticket_tier_id,
  quantity_total,
  review_quantity,
  protected_quantity,
  (protected_quantity - quantity_total)::bigint as over_capacity_quantity
from protected_inventory
where review_quantity > 0
   or protected_quantity > quantity_total
order by ticket_tier_id;
```

## Refund integrity

Detect a fully refunded order with any missing or non-refunded ticket.

```sql
select
  orders.id as order_id,
  orders.status,
  orders.quantity as expected_ticket_count,
  count(tickets.id)::bigint as ticket_count,
  count(tickets.id) filter (where tickets.status = 'refunded')::bigint
    as refunded_ticket_count,
  orders.refunded_at
from public.orders as orders
left join public.tickets as tickets on tickets.order_id = orders.id
where orders.status = 'refunded'
group by orders.id, orders.status, orders.quantity, orders.refunded_at
having count(tickets.id) <> orders.quantity
    or count(tickets.id) filter (where tickets.status = 'refunded')
       <> orders.quantity
order by orders.id;
```

Detect succeeded partial refund money that is not held in review. Amounts are
aggregated per order; refund reasons and provider content are deliberately not
projected.

```sql
with succeeded_refunds as (
  select
    refunds.order_id,
    sum(refunds.amount_minor)::bigint as refunded_minor,
    min(refunds.currency) as currency,
    count(distinct refunds.currency)::bigint as currency_count
  from public.refunds as refunds
  where refunds.status = 'succeeded'
  group by refunds.order_id
)
select
  orders.id as order_id,
  orders.status,
  orders.reconciliation_status,
  orders.currency,
  orders.total_minor,
  succeeded_refunds.refunded_minor
from public.orders as orders
join succeeded_refunds on succeeded_refunds.order_id = orders.id
where succeeded_refunds.refunded_minor > 0
  and succeeded_refunds.refunded_minor < orders.total_minor
  and (
    orders.status <> 'requires_review'
    or orders.reconciliation_status <> 'requires_review'
    or succeeded_refunds.currency_count <> 1
    or succeeded_refunds.currency is distinct from orders.currency
  )
order by orders.id;
```

## Provider identity and webhook receipts

Detect a provider object identifier bound to more than one order. These
identifiers are non-secret reconciliation identities; no provider object body
is selected. Customer identifiers are intentionally excluded because one
Stripe Customer may validly be reused across multiple orders.

```sql
with provider_references as (
  select
    orders.id as order_id,
    provider_values.object_type,
    provider_values.object_id
  from public.orders as orders
  cross join lateral (values
    ('checkout_session', orders.stripe_checkout_session_id),
    ('payment_intent', orders.stripe_payment_intent_id),
    ('charge', orders.stripe_charge_id),
    ('transfer', orders.stripe_transfer_id),
    ('application_fee', orders.stripe_application_fee_id),
    ('balance_transaction', orders.stripe_balance_transaction_id)
  ) as provider_values(object_type, object_id)
  where provider_values.object_id is not null
  union all
  select
    refunds.order_id,
    provider_values.object_type,
    provider_values.object_id
  from public.refunds as refunds
  cross join lateral (values
    ('refund', refunds.stripe_refund_id),
    ('payment_intent', refunds.stripe_payment_intent_id),
    ('charge', refunds.stripe_charge_id),
    ('transfer_reversal', refunds.stripe_transfer_reversal_id),
    ('application_fee_refund', refunds.stripe_application_fee_refund_id)
  ) as provider_values(object_type, object_id)
  where provider_values.object_id is not null
)
select
  provider_references.object_type,
  provider_references.object_id,
  count(distinct provider_references.order_id)::bigint as order_count,
  array_agg(distinct provider_references.order_id
    order by provider_references.order_id) as order_ids
from provider_references
group by provider_references.object_type, provider_references.object_id
having count(distinct provider_references.order_id) > 1
order by provider_references.object_type, provider_references.object_id;
```

Detect receipts still eligible for retry after ten minutes. Do not add
`payload_sha256` or `error_code` to exported results.

```sql
select
  receipts.stripe_event_id,
  receipts.stripe_object_id,
  receipts.processing_status,
  receipts.delivery_attempt_count,
  receipts.first_received_at,
  receipts.last_received_at,
  floor(extract(epoch from (
    statement_timestamp() - receipts.last_received_at
  )))::bigint as last_attempt_age_seconds
from public.stripe_webhook_events as receipts
where receipts.processing_status in ('processing', 'failed')
  and receipts.last_received_at <= statement_timestamp() - interval '10 minutes'
order by receipts.last_received_at, receipts.stripe_event_id;
```

## Scheduler health

Confirm the cleanup job is active and inspect recent run status and duration.
Never select `return_message`, because extension/provider text is not an
approved operational export field.

```sql
select
  jobs.jobid,
  jobs.jobname,
  jobs.active
from cron.job as jobs
where jobs.jobname = 'whereto-expire-checkout-reservations';
```

```sql
select
  runs.runid,
  runs.jobid,
  runs.status,
  runs.start_time,
  runs.end_time,
  case
    when runs.start_time is null then null
    else floor(extract(epoch from (
      coalesce(runs.end_time, statement_timestamp()) - runs.start_time
    )))::bigint
  end as duration_seconds
from cron.job_run_details as runs
join cron.job as jobs on jobs.jobid = runs.jobid
where jobs.jobname = 'whereto-expire-checkout-reservations'
order by runs.start_time desc nulls last, runs.runid desc
limit 20;
```

## Unresolved review orders

```sql
select
  orders.id as order_id,
  orders.event_id,
  orders.status,
  orders.reconciliation_status,
  orders.currency,
  orders.quantity,
  orders.total_minor,
  orders.created_at,
  orders.updated_at,
  floor(extract(epoch from (
    statement_timestamp() - orders.updated_at
  )))::bigint as unresolved_age_seconds
from public.orders as orders
where orders.status = 'requires_review'
   or orders.reconciliation_status = 'requires_review'
order by orders.updated_at, orders.id;
```

## Checkout kill switch and rollback

Only the database owner/operator may change the private runtime control. There
is no public toggle RPC. To stop new checkout creation, execute exactly:

```sql
update private.checkout_runtime_control
set checkout_creation_enabled = false, updated_at = statement_timestamp()
where singleton;
```

The switch gates only new sales. Webhooks, reconciliation, fulfillment of
already-valid paid Sessions, cancellation, expiration, refunds, cleanup, and
confirmation must remain operational.

Checkout creation remains disabled at Task 15 and branch handoff, even after
all verification gates pass. Passing tests is not authorization to launch.
Only a separately authorized database owner may enable new sales after every
item in `Docs/testing/checkout-integrity-1-verification.md` passes in the
intended environment. That later owner-only operation uses the same narrow row:

```sql
update private.checkout_runtime_control
set checkout_creation_enabled = true, updated_at = statement_timestamp()
where singleton;
```

After any cart order or Checkout Session exists, safe rollback is
stop-new-sales and fix forward. Never delete, merge, collapse, or rewrite
orders, order items, tickets, refunds, receipts, or provider identifiers.

## Singular-contract removal and forward recovery

Migration `20260902010600_remove_single_ticket_checkout_contract.sql` removes
the obsolete UUID-tier reservation/preflight overloads, legacy reservation and
digest helpers, singular webhook snapshots, and old confirmation projection.
The canonical fulfillment function accepts only the complete cart digest;
quantity-one purchases still use the same JSON cart and item-array contract.
No normalized table, financial history, or lifecycle endpoint is removed.

Before applying this migration, finish the approved browser/financial proof,
confirm exact cleanup, and inspect any outstanding order or Session that still
depends on the legacy digest. Resolve such an outstanding lifecycle with its
compatible runtime before cleanup; do not rewrite historical frozen digests.
Review and commit the forward migration before the owner runs a linked dry-run
and apply. Regenerate database types only after application and verify that the
canonical service ACLs remain exact. Do not enable checkout as part of this step.

If a defect appears after removal:

1. Disable new checkout creation with the owner-only statement above.
2. Keep webhook, cancellation, expiry, refund, reconciliation, and confirmation
   processing available for existing orders.
3. Preserve every financial row and immutable snapshot. Do not revert migration
   `20260902010600` or deploy a singular runtime.
4. Review and ship a forward migration or compatible runtime correction, then
   reconcile affected existing orders through their guarded lifecycle.
5. Rerun the affected database, code, and transaction gates. Keep checkout
   disabled at handoff; any subsequent enablement requires separate owner action.
