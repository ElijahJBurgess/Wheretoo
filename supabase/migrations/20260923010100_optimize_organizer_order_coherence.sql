-- Performance-only rewrite of the final anti-join. Every other predicate is unchanged.
-- NOT EXISTS ((A OR B) AND invalid) equals NOT EXISTS (A AND invalid)
-- AND NOT EXISTS (B AND invalid), including SQL NULL/UNKNOWN semantics.
-- Keep the LEFT JOIN for order-owned tickets with missing items. The item-owned
-- branch may use INNER JOIN: i.order_id=o.id cannot be TRUE for a missing item.
-- Both directions are essential: a foreign order's ticket can reference our item
-- without changing our ticket count. Existing indexes serve both branches.
create or replace function private.organizer_order_coherent(p_order_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select coalesce((select
   o.organizer_id=e.organizer_id and e.admission_type='paid' and not o.livemode
   and o.currency='usd'
   and (o.paid_at is null or o.status in ('paid','refunded','requires_review','partially_refunded'))
   and (o.status<>'paid' or (o.paid_at is not null and o.refunded_at is null
     and o.reconciliation_status='reconciled'))
   and (o.status<>'refunded' or o.refunded_at is not null)
   and not exists (select 1 from public.tickets t where t.order_id=o.id and (
     (o.status='paid' and not (t.status='used'
       or (e.status='cancelled' and t.status='cancelled')
       or (e.status<>'cancelled' and t.status='valid')))
     or (o.status='refunded' and t.status not in ('used','refunded'))
   ))
   and (select count(*) between 1 and 10 and sum(i.quantity)=o.quantity
     and sum(i.subtotal_minor)=o.subtotal_minor
     and bool_and(t.event_id=o.event_id and i.currency=o.currency
       and i.subtotal_minor=i.unit_amount_minor*i.quantity)
     from public.order_items i join public.ticket_tiers t on t.id=i.ticket_tier_id where i.order_id=o.id)
   and (select count(*) from public.tickets t where t.order_id=o.id)=
     case when private.is_payment_after_invalidation_without_tickets(o) then 0
       when o.paid_at is not null then o.quantity else 0 end
   and not exists (
     select 1 from public.tickets t left join public.order_items i on i.id=t.order_item_id
     where t.order_id=o.id and (
       i.id is null or t.order_id<>i.order_id or t.event_id<>o.event_id
       or t.organizer_id<>o.organizer_id or t.ticket_tier_id<>i.ticket_tier_id
       or t.admission_label<>i.tier_name or t.unit_sequence not between 1 and i.quantity
     )
   )
   and not exists (
     select 1 from public.tickets t join public.order_items i on i.id=t.order_item_id
     where i.order_id=o.id and (
       i.id is null or t.order_id<>i.order_id or t.event_id<>o.event_id
       or t.organizer_id<>o.organizer_id or t.ticket_tier_id<>i.ticket_tier_id
       or t.admission_label<>i.tier_name or t.unit_sequence not between 1 and i.quantity
     )
   )
 from public.orders o join public.events e on e.id=o.event_id where o.id=p_order_id),false);
$$;
revoke all on function private.organizer_order_coherent(uuid) from public,anon,authenticated,service_role;
