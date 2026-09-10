-- Additive organizer read boundary. Payment, inventory and admission writers are unchanged.
create or replace function private.require_owned_paid_event(p_event_id uuid)
returns public.events language plpgsql stable security definer set search_path = '' as $$
declare v_event public.events;
begin
  select * into v_event from public.events
  where id=p_event_id and organizer_id=auth.uid() and admission_type='paid';
  if auth.uid() is null or not found then
    raise exception using errcode='42501',message='Event unavailable';
  end if;
  return v_event;
end;
$$;
revoke all on function private.require_owned_paid_event(uuid) from public,anon,authenticated,service_role;

-- Read-time coherence protects operational totals without introducing new lifecycle semantics.
create or replace function private.organizer_order_coherent(p_order_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select coalesce((select
   o.organizer_id=e.organizer_id and e.admission_type='paid' and not o.livemode
   and o.currency='usd'
   and (o.paid_at is null or o.status in ('paid','refunded','requires_review','partially_refunded'))
   and (o.status<>'paid' or o.paid_at is not null)
   and (select count(*) between 1 and 10 and sum(i.quantity)=o.quantity
     and sum(i.subtotal_minor)=o.subtotal_minor
     and bool_and(t.event_id=o.event_id and i.currency=o.currency
       and i.subtotal_minor=i.unit_amount_minor*i.quantity)
     from public.order_items i join public.ticket_tiers t on t.id=i.ticket_tier_id where i.order_id=o.id)
   and (select count(*) from public.tickets t where t.order_id=o.id)=
     case when o.paid_at is not null then o.quantity else 0 end
   and not exists (
     select 1 from public.tickets t left join public.order_items i on i.id=t.order_item_id
     where (t.order_id=o.id or i.order_id=o.id) and (
       i.id is null or t.order_id<>i.order_id or t.event_id<>o.event_id
       or t.organizer_id<>o.organizer_id or t.ticket_tier_id<>i.ticket_tier_id
       or t.admission_label<>i.tier_name or t.unit_sequence not between 1 and i.quantity
     )
   )
 from public.orders o join public.events e on e.id=o.event_id where o.id=p_order_id),false);
$$;
revoke all on function private.organizer_order_coherent(uuid) from public,anon,authenticated,service_role;

create or replace function public.get_organizer_event_metrics(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
 v_event public.events; v_now timestamptz := statement_timestamp();
 v_tiers jsonb; v_capacity bigint; v_gross bigint; v_sold bigint;
 v_orders bigint; v_issued bigint; v_used bigint;
begin
 v_event := private.require_owned_paid_event(p_event_id);
 if exists(select 1 from public.orders o where (o.event_id=p_event_id
   or exists(select 1 from public.order_items i join public.ticket_tiers t on t.id=i.ticket_tier_id where i.order_id=o.id and t.event_id=p_event_id)
   or exists(select 1 from public.tickets t where t.order_id=o.id and t.event_id=p_event_id))
   and not private.organizer_order_coherent(o.id)) then
   raise exception using errcode='P0001',message='Operations data unavailable';
 end if;
 select coalesce(sum(o.subtotal_minor),0),coalesce(sum(o.quantity),0),count(*)
 into v_gross,v_sold,v_orders from public.orders o
 where o.event_id=p_event_id and o.paid_at is not null;
 select count(*),count(*) filter(where status='used' and used_at is not null)
 into v_issued,v_used from public.tickets where event_id=p_event_id;
 with tier_metrics as (
   select t.id,t.name,t.status,t.sort_order,t.quantity_total,
     coalesce(sum(i.quantity) filter(where o.paid_at is not null),0) sold,
     coalesce(sum(i.subtotal_minor) filter(where o.paid_at is not null),0) gross,
     t.quantity_total - coalesce(sum(i.quantity) filter(where
       o.status in ('paid','payment_processing','requires_review','partially_refunded')
       or (o.status in ('creating_checkout','checkout_open') and o.reservation_expires_at>v_now)),0) remaining
   from public.ticket_tiers t left join public.order_items i on i.ticket_tier_id=t.id
   left join public.orders o on o.id=i.order_id
   where t.event_id=p_event_id
   group by t.id
 ) select jsonb_agg(jsonb_build_object('id',id,'name',name,'status',status,
   'capacity',quantity_total,'sold',sold,'remaining',remaining,'grossSalesMinor',gross)
   order by sort_order,id),sum(quantity_total) into v_tiers,v_capacity from tier_metrics;
 if exists(select 1 from jsonb_array_elements(v_tiers) t where (t->>'remaining')::bigint<0) then
   raise exception using errcode='P0001',message='Operations data unavailable';
 end if;
 return jsonb_build_object(
   'event',jsonb_build_object('id',v_event.id,'title',v_event.title,'startsAt',v_event.starts_at,
     'endsAt',v_event.ends_at,'venueName',v_event.venue_name,'city',v_event.city,
     'status',v_event.status,'artworkPath',v_event.artwork_path),
   'grossSalesMinor',v_gross,'sold',v_sold,'orderCount',v_orders,
   'issued',v_issued,'checkedIn',v_used,'capacity',v_capacity,'tiers',coalesce(v_tiers,'[]'::jsonb),
   'admissionEligible',coalesce(v_event.status='published' and isfinite(v_event.starts_at)
     and isfinite(v_event.ends_at) and v_event.ends_at>v_event.starts_at and v_event.ends_at>v_now,false));
end;
$$;
revoke all on function public.get_organizer_event_metrics(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_organizer_event_metrics(uuid) to authenticated;
