-- Read-only extraction; checkout, fulfillment, refunds and expiry are unchanged.
create function private.ticket_tier_inventory(p_tier_id uuid,p_as_of timestamptz)
returns table(tier_id uuid,event_id uuid,quantity_total integer,protected_quantity bigint,availability_status text)
language sql stable security definer set search_path='' as $$
 select t.id,t.event_id,t.quantity_total,
   coalesce(sum(i.quantity) filter(where o.status in ('paid','payment_processing','requires_review','partially_refunded')
     or (o.status in ('creating_checkout','checkout_open') and o.reservation_expires_at>p_as_of)),0)::bigint,
   case when t.quantity_total>coalesce(sum(i.quantity) filter(where o.status in ('paid','payment_processing','requires_review','partially_refunded')
     or (o.status in ('creating_checkout','checkout_open') and o.reservation_expires_at>p_as_of)),0)::bigint
     then 'available' else 'sold_out' end
 from public.ticket_tiers t left join public.order_items i on i.ticket_tier_id=t.id
 left join public.orders o on o.id=i.order_id
 where t.id=p_tier_id and t.status='active' and p_as_of is not null and isfinite(p_as_of)
 group by t.id;
$$;
revoke all on function private.ticket_tier_inventory(uuid,timestamptz) from public,anon,authenticated,service_role;

create or replace function public.get_public_event_ticketing(p_event_id uuid)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'event', private.public_event_projection(p_event_id),
    'tiers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tier_availability.id, 'name', tier_availability.name,
        'description', tier_availability.description,
        'unit_amount_minor', tier_availability.unit_amount_minor,
        'currency', tier_availability.currency,
        'availability_status', case when tier_availability.quantity_total > tier_availability.reserved_quantity
          then 'available' else 'sold_out' end
      ) order by tier_availability.sort_order)
      from (
        select tiers.id, tiers.name, tiers.description, tiers.unit_amount_minor,
          tiers.currency, tiers.quantity_total, tiers.sort_order,
          inventory.protected_quantity as reserved_quantity
        from public.ticket_tiers as tiers
        cross join lateral private.ticket_tier_inventory(tiers.id,pg_catalog.statement_timestamp()) inventory
        where tiers.event_id = p_event_id and tiers.status = 'active'
      ) as tier_availability
    ), '[]'::jsonb)
  )
  where private.event_is_publicly_eligible(p_event_id, pg_catalog.statement_timestamp());
$$;
