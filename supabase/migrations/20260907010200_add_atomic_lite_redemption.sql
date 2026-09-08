-- One event lock serializes admission with payment/refund/review/cancellation.
create function public.server_redeem_paid_ticket(
  p_organizer_id uuid, p_event_id uuid, p_credential_hash bytea
) returns table(outcome text, admission_label text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_ticket public.tickets;
  v_order public.orders;
  v_coherent boolean;
begin
  perform public.lock_event_ticketing_operation(p_event_id);
  select * into v_event from public.events where id=p_event_id for update;
  if not found or p_organizer_id is null or v_event.organizer_id<>p_organizer_id then
    raise exception using errcode='42501', message='Admission forbidden';
  end if;
  if p_credential_hash is null or octet_length(p_credential_hash)<>32 then
    return query select 'invalid'::text,null::text; return;
  end if;

  -- Do not lock a foreign ticket while holding this event's advisory lock.
  -- A wrong-event result is read-only; same-event truth is re-read under row lock.
  select * into v_ticket from public.tickets where credential_hash=p_credential_hash;
  if not found then
    return query select 'invalid'::text,null::text; return;
  end if;
  if v_ticket.event_id=p_event_id then
    select * into v_ticket from public.tickets
      where credential_hash=p_credential_hash and event_id=p_event_id for update;
    if not found then
      return query select 'invalid'::text,null::text; return;
    end if;
  end if;
  select * into v_order from public.orders where id=v_ticket.order_id;

  -- Validate the complete purchased source-unit set, including foreign-order
  -- rows that claim one of its item sources. Financial state is checked below
  -- so a later refund/review cannot erase a coherent historical use.
  select exists (
    select 1 from public.orders o join public.events e on e.id=o.event_id
    where o.id=v_ticket.order_id and not o.livemode
      and e.admission_type='paid' and e.organizer_id=o.organizer_id
      and o.quantity between 1 and 10
      and (select count(*) between 1 and 10
        and sum(i.quantity)=o.quantity and sum(i.subtotal_minor)=o.subtotal_minor
        and bool_and(tier.id is not null and tier.event_id=o.event_id
          and i.currency=o.currency and i.quantity between 1 and 10
          and i.unit_amount_minor>0 and i.subtotal_minor=i.unit_amount_minor*i.quantity)
        from public.order_items i left join public.ticket_tiers tier on tier.id=i.ticket_tier_id
        where i.order_id=o.id)
      and (select count(*) from public.tickets t where t.order_id=o.id)=o.quantity
      and not exists (
        select 1 from public.order_items i cross join lateral generate_series(1,i.quantity) s(unit)
        where i.order_id=o.id and not exists (
          select 1 from public.tickets t where t.order_id=o.id
            and t.order_item_id=i.id and t.unit_sequence=s.unit
            and t.event_id=o.event_id and t.organizer_id=o.organizer_id
            and t.ticket_tier_id=i.ticket_tier_id and t.admission_label=i.tier_name
        )
      )
      and not exists (
        select 1 from public.tickets t left join public.order_items i on i.id=t.order_item_id
        where (t.order_id=o.id or i.order_id=o.id) and (
          i.id is null or i.order_id<>o.id or t.order_id<>o.id
          or t.event_id<>o.event_id or t.organizer_id<>o.organizer_id
          or t.ticket_tier_id<>i.ticket_tier_id or t.admission_label<>i.tier_name
          or t.unit_sequence not between 1 and i.quantity
          or t.credential_hash is null or octet_length(t.credential_hash)<>32
          or not (
            (t.status='valid' and t.used_at is null and t.cancelled_at is null and t.refunded_at is null)
            or (t.status='used' and t.used_at is not null and t.cancelled_at is null and t.refunded_at is null)
            or (t.status='refunded' and t.refunded_at is not null and t.used_at is null and t.cancelled_at is null)
            or (t.status='cancelled' and t.cancelled_at is not null and t.used_at is null and t.refunded_at is null)
          )
        )
      )
  ) into v_coherent;
  if not v_coherent then
    return query select 'invalid'::text,null::text; return;
  end if;
  if v_ticket.status in ('used','refunded','cancelled') then
    if v_ticket.event_id<>p_event_id then
      return query select 'wrong_event'::text,null::text; return;
    end if;
    return query select case when v_ticket.status='used' then 'already_used' else v_ticket.status end,v_ticket.admission_label;
    return;
  end if;
  if v_ticket.event_id<>p_event_id then
    -- Read foreign event state without acquiring its row/advisory lock. A
    -- contradictory valid credential must not be presented as coherent truth.
    select * into v_event from public.events where id=v_ticket.event_id;
  end if;
  if v_ticket.status<>'valid' or v_order.status<>'paid'
    or v_order.paid_at is null or v_order.refunded_at is not null
    or v_order.reconciliation_status<>'reconciled'
    or v_event.status<>'published'
    or v_event.starts_at is null or v_event.ends_at is null
    or not isfinite(v_event.starts_at) or not isfinite(v_event.ends_at)
    or v_event.ends_at<=v_event.starts_at or v_event.ends_at<=clock_timestamp()
    or exists(select 1 from public.tickets t where t.order_id=v_order.id and t.status not in ('valid','used')) then
    return query select 'invalid'::text,null::text; return;
  end if;
  if v_ticket.event_id<>p_event_id then
    return query select 'wrong_event'::text,null::text; return;
  end if;

  return query update public.tickets t set status='used',used_at=clock_timestamp()
    where t.id=v_ticket.id and t.status='valid' and t.used_at is null
      and t.cancelled_at is null and t.refunded_at is null
    returning 'admitted'::text,t.admission_label;
  if not found then
    return query select 'invalid'::text,null::text;
  end if;
end;
$$;
revoke all on function public.server_redeem_paid_ticket(uuid,uuid,bytea) from public,anon,authenticated;
grant execute on function public.server_redeem_paid_ticket(uuid,uuid,bytea) to service_role;
comment on function public.server_redeem_paid_ticket(uuid,uuid,bytea) is
  'Service-only organizer-authorized atomic paid admission; accepts only credential hash and returns safe outcome plus owned admission label.';
