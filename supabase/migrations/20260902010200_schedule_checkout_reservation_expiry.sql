create or replace function private.expire_checkout_reservations(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_event_expired_count integer;
  v_expired_count integer := 0;
begin
  if p_now is null then
    raise exception using errcode = 'P0001', message = 'CHECKOUT_INPUT_INVALID';
  end if;

  -- Stable hierarchy: event advisory lock -> tier UUIDs -> event -> order UUIDs.
  for v_event_id in
    select distinct orders.event_id
    from public.orders as orders
    where orders.status in ('creating_checkout', 'checkout_open')
      and orders.reservation_expires_at <= p_now
    order by orders.event_id
  loop
    perform public.lock_event_ticketing_operation(v_event_id);

    perform tiers.id
    from public.ticket_tiers as tiers
    where tiers.event_id = v_event_id
    order by tiers.id
    for update;

    perform events.id
    from public.events as events
    where events.id = v_event_id
    for update;

    with stale_orders as (
      select orders.id
      from public.orders as orders
      where orders.event_id = v_event_id
        and orders.status in ('creating_checkout', 'checkout_open')
        and orders.reservation_expires_at <= p_now
      order by orders.id
      for update
    )
    update public.orders as orders
    set status = 'expired',
        expired_at = coalesce(orders.expired_at, p_now),
        failure_code = coalesce(orders.failure_code, 'CHECKOUT_EXPIRED')
    from stale_orders
    where orders.id = stale_orders.id;

    get diagnostics v_event_expired_count = row_count;
    v_expired_count := v_expired_count + v_event_expired_count;
  end loop;

  return v_expired_count;
end;
$$;

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'whereto-expire-checkout-reservations',
  '* * * * *',
  'select public.server_expire_checkout_reservations(clock_timestamp());'
);
