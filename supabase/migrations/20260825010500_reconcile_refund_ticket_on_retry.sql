drop trigger orders_reconcile_verified_refund_ticket on public.orders;

create trigger orders_reconcile_verified_refund_ticket
after update of status on public.orders
for each row
when (new.status in ('partially_refunded', 'refunded'))
execute function private.reconcile_verified_refund_ticket();

comment on trigger orders_reconcile_verified_refund_ticket on public.orders is
  'Makes verified refund ticket recovery idempotent, including webhook retries after the order is already terminal.';
