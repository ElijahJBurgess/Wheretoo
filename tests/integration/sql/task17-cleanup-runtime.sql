begin;

create temporary table task17_cleanup_lock_target on commit drop as
select events.id as event_id
from public.organizers as organizers
join public.events as events on events.organizer_id = organizers.id
where organizers.display_name = '__TASK17_FIXTURE_PREFIX__'
  and events.title = '__TASK17_FIXTURE_PREFIX__ transaction';

do $cleanup_scope$
begin
  if (select count(*) from task17_cleanup_lock_target) > 1 then
    raise exception using errcode = 'P0001', message = 'TASK17_CLEANUP_SCOPE';
  end if;
end
$cleanup_scope$;

select public.lock_event_ticketing_operation(event_id)
from task17_cleanup_lock_target
order by event_id;

lock table
  auth.users,
  public.organizers,
  public.events,
  private.checkout_runtime_control,
  private.staff_roles,
  private.event_moderation_evaluations,
  private.event_public_eligibility_intervals,
  private.event_moderation_actions,
  private.event_policy_acceptances,
  private.event_reports,
  private.moderation_review_requests,
  public.ticket_tiers,
  public.organizer_stripe_accounts,
  public.orders,
  public.order_items,
  public.tickets,
  public.refunds,
  public.disputes,
  public.stripe_webhook_events
in share row exclusive mode;

create temporary table task17_cleanup_namespace on commit drop as
select organizers.display_name as prefix
from public.organizers as organizers
where organizers.display_name ~ '^task17_[a-z0-9]{12}$'
union
select split_part(users.email, '@', 1) as prefix
from auth.users as users
where users.email ~ '^task17_[a-z0-9]{12}@example[.]invalid$'
union
select regexp_replace(events.title, ' transaction$', '') as prefix
from public.events as events
where events.title ~ '^task17_[a-z0-9]{12} transaction$';

create temporary table task17_cleanup_fixture on commit drop as
select events.id as event_id, organizers.id as organizer_id
from public.organizers as organizers
join public.events as events on events.organizer_id = organizers.id
where organizers.display_name = '__TASK17_FIXTURE_PREFIX__'
  and events.title = '__TASK17_FIXTURE_PREFIX__ transaction';

create temporary table task17_cleanup_orders on commit drop as
select orders.id, orders.stripe_checkout_session_id,
  orders.stripe_payment_intent_id, orders.stripe_charge_id,
  orders.last_stripe_event_id
from public.orders as orders
join task17_cleanup_fixture as fixture on fixture.event_id = orders.event_id;

create temporary table task17_cleanup_refunds on commit drop as
select refunds.id, refunds.stripe_refund_id, refunds.stripe_event_id
from public.refunds as refunds
where refunds.order_id in (select id from task17_cleanup_orders);

create temporary table task17_cleanup_receipts on commit drop as
select receipts.stripe_event_id
from public.stripe_webhook_events as receipts
where receipts.stripe_event_id in (
    select last_stripe_event_id from task17_cleanup_orders
    union select stripe_event_id from task17_cleanup_refunds
  )
  or receipts.stripe_object_id in (
    select stripe_checkout_session_id from task17_cleanup_orders
    union select stripe_payment_intent_id from task17_cleanup_orders
    union select stripe_charge_id from task17_cleanup_orders
    union select stripe_refund_id from task17_cleanup_refunds
  );

do $cleanup_admission$
begin
  if exists (
    select 1 from public.disputes
    where order_id in (select id from task17_cleanup_orders)
  ) then
    raise exception using errcode = 'P0001', message = 'TASK17_CLEANUP_DISPUTE';
  end if;

  if '__TASK13_CLEANUP_ONLY__' = '1' and (
    (select count(*) from task17_cleanup_namespace
      where prefix = '__TASK17_FIXTURE_PREFIX__') <> 1
    or (select count(*) from task17_cleanup_fixture) <> 1
    or (select count(*) from task17_cleanup_orders) <> 1
    or (select count(*) from public.organizers
      where display_name = '__TASK17_FIXTURE_PREFIX__') <> 1
    or (select count(*) from auth.users as owner
      join task17_cleanup_fixture as fixture on fixture.organizer_id = owner.id
      where owner.email = '__TASK17_FIXTURE_PREFIX__@example.invalid'
        and owner.banned_until > statement_timestamp()) <> 1
    or exists (
      select 1 from task17_cleanup_fixture as fixture
      join public.events as events on events.id = fixture.event_id
      where events.status <> 'published'
        or events.publicly_authorized_action_id is not null
        or not (
          events.moderation_status = 'clear'
          or (
            events.moderation_status = 'under_review'
            and exists (
              select 1
              from private.event_moderation_evaluations as evaluations
              where evaluations.event_id = events.id
                and evaluations.content_revision = events.content_revision
                and evaluations.queued_moderation_version = events.moderation_version
                and evaluations.status = 'queued'
                and evaluations.source = 'contextual'
            )
          )
        )
    )
    or exists (
      select 1 from public.events as events
      join task17_cleanup_fixture as fixture
        on fixture.organizer_id = events.organizer_id
      where events.id <> fixture.event_id
    )
    or exists (
      select 1 from task17_cleanup_fixture as fixture
      cross join lateral public.get_public_event(fixture.event_id)
    )
    or not exists (
      select 1 from private.event_public_eligibility_intervals as intervals
      join task17_cleanup_fixture as fixture on fixture.event_id = intervals.event_id
    )
    or exists (
      select 1 from private.event_public_eligibility_intervals as intervals
      join task17_cleanup_fixture as fixture on fixture.event_id = intervals.event_id
      where intervals.eligibility_state = 'eligible' and intervals.ended_at is null
    )
    or (select count(*)
      from private.event_public_eligibility_intervals as intervals
      join task17_cleanup_fixture as fixture on fixture.event_id = intervals.event_id
      where intervals.eligibility_state = 'ineligible' and intervals.ended_at is null) <> 1
    or not exists (
      select 1 from private.event_moderation_actions as actions
      join task17_cleanup_fixture as fixture on fixture.event_id = actions.event_id
    )
    or not exists (
      select 1 from private.event_policy_acceptances as acceptances
      join task17_cleanup_fixture as fixture on fixture.event_id = acceptances.event_id
    )
    or exists (
      select 1 from private.staff_roles as roles
      join task17_cleanup_fixture as fixture on fixture.organizer_id = roles.user_id
    )
    or exists (
      select 1 from private.event_reports as reports
      join task17_cleanup_fixture as fixture on fixture.event_id = reports.event_id
    )
    or exists (
      select 1 from private.moderation_review_requests as reviews
      join task17_cleanup_fixture as fixture on fixture.event_id = reviews.event_id
    )
    or (select count(*) from public.ticket_tiers as tiers
      join task17_cleanup_fixture as fixture on fixture.event_id = tiers.event_id) <> 2
    or (select count(*) from public.ticket_tiers as tiers
      join task17_cleanup_fixture as fixture on fixture.event_id = tiers.event_id
      where tiers.name = 'General Admission' and tiers.unit_amount_minor = 1500
        and tiers.currency = 'usd' and tiers.quantity_total = 10
        and tiers.status = 'active' and tiers.sort_order = 1) <> 1
    or (select count(*) from public.ticket_tiers as tiers
      join task17_cleanup_fixture as fixture on fixture.event_id = tiers.event_id
      where tiers.name = 'VIP' and tiers.unit_amount_minor = 2500
        and tiers.currency = 'usd' and tiers.quantity_total = 10
        and tiers.status = 'active' and tiers.sort_order = 2) <> 1
    or (select count(*) from public.organizer_stripe_accounts as accounts
      join task17_cleanup_fixture as fixture on fixture.organizer_id = accounts.organizer_id
      where accounts.livemode = false
        and accounts.stripe_account_id = '__TASK17_CONNECTED_ACCOUNT_ID__'
        and accounts.transfers_status = 'active'
        and accounts.payouts_status = 'active'
        and accounts.requirements_status = 'clear') <> 1
    or (select count(*) from public.organizer_stripe_accounts as accounts
      join task17_cleanup_fixture as fixture on fixture.organizer_id = accounts.organizer_id) <> 1
    or (select count(*) from public.orders as orders
      join task17_cleanup_fixture as fixture on fixture.event_id = orders.event_id) <> 1
    or exists (
      select 1 from public.orders as orders
      join task17_cleanup_orders as cleanup_orders on cleanup_orders.id = orders.id
      where orders.livemode <> false or orders.status <> 'checkout_open'
        or orders.reconciliation_status <> 'pending' or orders.quantity <> 3
        or orders.currency <> 'usd' or orders.subtotal_minor <> 5500
        or orders.tax_amount_minor <> 0 or orders.total_minor <> 5500
        or orders.application_fee_amount_minor <> 425
        or orders.stripe_destination_account_id <> '__TASK17_CONNECTED_ACCOUNT_ID__'
        or orders.stripe_checkout_session_id !~ '^cs_test_[A-Za-z0-9]+$'
        or orders.stripe_payment_intent_id is not null
        or orders.stripe_charge_id is not null
        or orders.stripe_transfer_id is not null
        or orders.stripe_application_fee_id is not null
        or orders.stripe_balance_transaction_id is not null
        or orders.stripe_customer_id is not null
        or orders.last_stripe_event_id is not null
        or orders.paid_at is not null or orders.failed_at is not null
        or orders.expired_at is not null or orders.refunded_at is not null
    )
    or (select count(*) from public.order_items
      where order_id in (select id from task17_cleanup_orders)) <> 2
    or (select count(*) from public.order_items as items
      join public.ticket_tiers as tiers on tiers.id = items.ticket_tier_id
      where items.order_id in (select id from task17_cleanup_orders)
        and tiers.name = 'General Admission' and items.tier_name = tiers.name
        and items.tier_version = tiers.version and items.quantity = 2
        and items.unit_amount_minor = 1500 and items.subtotal_minor = 3000
        and items.currency = 'usd') <> 1
    or (select count(*) from public.order_items as items
      join public.ticket_tiers as tiers on tiers.id = items.ticket_tier_id
      where items.order_id in (select id from task17_cleanup_orders)
        and tiers.name = 'VIP' and items.tier_name = tiers.name
        and items.tier_version = tiers.version and items.quantity = 1
        and items.unit_amount_minor = 2500 and items.subtotal_minor = 2500
        and items.currency = 'usd') <> 1
    or exists (
      select 1 from public.tickets
      where order_id in (select id from task17_cleanup_orders)
    )
    or exists (
      select 1 from public.refunds
      where order_id in (select id from task17_cleanup_orders)
    )
    or (select count(*) from task17_cleanup_receipts) <> 1
    or not exists (
      select 1 from public.stripe_webhook_events as receipts
      join task17_cleanup_receipts as cleanup_receipts using (stripe_event_id)
      where receipts.event_type = 'checkout.session.completed'
        and receipts.livemode = false
        and receipts.processing_status = 'processed'
        and receipts.processed_at is not null
        and receipts.error_code = 'STRIPE_OBJECT_INVALID'
    )
    or exists (
      select 1 from private.checkout_runtime_control
      where singleton and checkout_creation_enabled
    )
  ) then
    raise exception using errcode = 'P0001', message = 'TASK17_CLEANUP_SCOPE';
  end if;

  if '__TASK13_CLEANUP_ONLY__' = '0'
    and (select count(*) from task17_cleanup_fixture) = 1
    and (
      (select count(*) from auth.users as owner
        join task17_cleanup_fixture as fixture on fixture.organizer_id = owner.id
        where owner.email = '__TASK17_FIXTURE_PREFIX__@example.invalid'
          and owner.banned_until > statement_timestamp()) <> 1
      or exists (
        select 1 from task17_cleanup_fixture as fixture
        join public.events as events on events.id = fixture.event_id
        where events.status <> 'published'
          or events.publicly_authorized_action_id is not null
          or not (
            events.moderation_status = 'clear'
            or (
              events.moderation_status = 'under_review'
              and exists (
                select 1
                from private.event_moderation_evaluations as evaluations
                where evaluations.event_id = events.id
                  and evaluations.content_revision = events.content_revision
                  and evaluations.queued_moderation_version = events.moderation_version
                  and evaluations.status = 'queued'
                  and evaluations.source = 'contextual'
              )
            )
          )
      )
      or exists (
        select 1 from private.staff_roles as roles
        join task17_cleanup_fixture as fixture on fixture.organizer_id = roles.user_id
      )
      or exists (
        select 1 from private.event_reports as reports
        join task17_cleanup_fixture as fixture on fixture.event_id = reports.event_id
      )
      or exists (
        select 1 from private.moderation_review_requests as reviews
        join task17_cleanup_fixture as fixture on fixture.event_id = reviews.event_id
      )
      or exists (
        select 1 from task17_cleanup_fixture as fixture
        cross join lateral public.get_public_event(fixture.event_id)
      )
      or (select count(*) from public.ticket_tiers as tiers
        join task17_cleanup_fixture as fixture on fixture.event_id = tiers.event_id) > 2
      or (select count(*) from public.organizer_stripe_accounts as accounts
        join task17_cleanup_fixture as fixture on fixture.organizer_id = accounts.organizer_id) > 1
      or (select count(*) from task17_cleanup_orders) > 2
      or (select count(*) from public.order_items
        where order_id in (select id from task17_cleanup_orders)) > 4
      or (select count(*) from public.tickets
        where order_id in (select id from task17_cleanup_orders)) > 3
      or (select count(*) from task17_cleanup_receipts) > 100
      or (select count(*) from task17_cleanup_refunds) > 1
    ) then
    raise exception using errcode = 'P0001', message = 'TASK17_CLEANUP_SCOPE';
  end if;
end
$cleanup_admission$;

delete from public.tickets
where order_id in (select id from task17_cleanup_orders);

delete from public.refunds
where id in (select id from task17_cleanup_refunds);

delete from public.order_items
where order_id in (select id from task17_cleanup_orders);

delete from public.orders
where id in (select id from task17_cleanup_orders);

delete from public.stripe_webhook_events
where stripe_event_id in (select stripe_event_id from task17_cleanup_receipts);

delete from public.ticket_tiers
where event_id in (select event_id from task17_cleanup_fixture);

delete from public.organizer_stripe_accounts
where organizer_id in (select organizer_id from task17_cleanup_fixture);

do $cleanup_residue$
begin
  if exists (select 1 from public.orders where id in (select id from task17_cleanup_orders))
    or exists (select 1 from public.order_items where order_id in (select id from task17_cleanup_orders))
    or exists (select 1 from public.tickets where order_id in (select id from task17_cleanup_orders))
    or exists (select 1 from public.refunds where id in (select id from task17_cleanup_refunds))
    or exists (select 1 from public.disputes where order_id in (select id from task17_cleanup_orders))
    or exists (select 1 from public.stripe_webhook_events where stripe_event_id in (select stripe_event_id from task17_cleanup_receipts))
    or exists (select 1 from public.ticket_tiers where event_id in (select event_id from task17_cleanup_fixture))
    or exists (select 1 from public.organizer_stripe_accounts where organizer_id in (select organizer_id from task17_cleanup_fixture)) then
    raise exception using errcode = 'P0001', message = 'TASK17_CLEANUP_RESIDUE';
  end if;
end
$cleanup_residue$;

commit;
