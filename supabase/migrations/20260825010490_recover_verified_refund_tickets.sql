create function private.reconcile_verified_refund_ticket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('partially_refunded', 'refunded') then
    update public.tickets as tickets
    set status = 'refunded',
        refunded_at = coalesce(tickets.refunded_at, statement_timestamp()),
        cancelled_at = null
    where tickets.order_id = new.id
      and tickets.status in ('valid', 'cancelled');
  end if;
  return new;
end;
$$;

create trigger orders_reconcile_verified_refund_ticket
after update of status on public.orders
for each row
when (
  new.status in ('partially_refunded', 'refunded')
  and old.status is distinct from new.status
)
execute function private.reconcile_verified_refund_ticket();

revoke all on function private.reconcile_verified_refund_ticket() from public;
revoke all on function private.reconcile_verified_refund_ticket() from anon;
revoke all on function private.reconcile_verified_refund_ticket() from authenticated;
revoke all on function private.reconcile_verified_refund_ticket() from service_role;

comment on function private.reconcile_verified_refund_ticket() is
  'Converts a conservatively cancelled ticket to refunded when a later verified refund reconciles its order.';
