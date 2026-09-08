-- Read-only accountless access. The confirmation bearer is hashed by Edge;
-- only the service role can obtain source/hash material for verification.
create function public.server_lookup_lite_ticket_collection(p_token_hash text)
returns table (
  event_id uuid, event_title text, event_starts_at timestamptz,
  event_ends_at timestamptz, event_venue_name text, event_status text,
  order_status text, quantity integer, items jsonb, tickets jsonb
)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.title, e.starts_at, e.ends_at, e.venue_name, e.status,
    o.status, o.quantity,
    (select jsonb_agg(jsonb_build_object(
      'order_item_id', i.id, 'quantity', i.quantity, 'admission_label', i.tier_name
    ) order by i.id) from public.order_items i where i.order_id=o.id),
    (select jsonb_agg(jsonb_build_object(
      'id', t.id, 'order_item_id', t.order_item_id, 'unit_sequence', t.unit_sequence,
      'admission_label', t.admission_label, 'status', t.status,
      'credential_hash', encode(t.credential_hash,'hex')
    ) order by t.order_item_id,t.unit_sequence) from public.tickets t where t.order_id=o.id)
  from public.orders o join public.events e on e.id=o.event_id
  where p_token_hash ~ '^[a-f0-9]{64}$'
    and o.confirmation_token_hash=p_token_hash and not o.livemode
    and o.status in ('paid','refunded') and o.paid_at is not null
    and o.reconciliation_status='reconciled'
    and ((o.status='paid' and o.refunded_at is null)
      or (o.status='refunded' and o.refunded_at is not null))
    and e.status in ('published','cancelled') and e.admission_type='paid'
    and e.organizer_id=o.organizer_id and o.quantity between 1 and 10
    and (select count(*) between 1 and 10
      and sum(i.quantity)=o.quantity and sum(i.subtotal_minor)=o.subtotal_minor
      and bool_and(tier.id is not null and tier.event_id=o.event_id
        and i.currency=o.currency and i.quantity between 1 and 10
        and i.unit_amount_minor>0 and i.subtotal_minor=i.unit_amount_minor*i.quantity)
      from public.order_items i left join public.ticket_tiers tier on tier.id=i.ticket_tier_id
      where i.order_id=o.id)
    and (select count(*) from public.tickets t where t.order_id=o.id)=o.quantity
    -- Every purchased source unit must exist with its immutable identity intact.
    and not exists (
      select 1 from public.order_items i cross join lateral generate_series(1,i.quantity) s(unit)
      where i.order_id=o.id and not exists (
        select 1 from public.tickets t where t.order_id=o.id
          and t.order_item_id=i.id and t.unit_sequence=s.unit
          and t.event_id=o.event_id and t.organizer_id=o.organizer_id
          and t.ticket_tier_id=i.ticket_tier_id and t.admission_label=i.tier_name
      )
    )
    -- Inspect all tickets owned by the order OR referring to its item sources.
    and not exists (
      select 1 from public.tickets t left join public.order_items i on i.id=t.order_item_id
      where (t.order_id=o.id or i.order_id=o.id) and (
        i.id is null or i.order_id<>o.id or t.order_id<>o.id
        or t.event_id<>o.event_id or t.organizer_id<>o.organizer_id
        or t.ticket_tier_id<>i.ticket_tier_id or t.admission_label<>i.tier_name
        or t.unit_sequence not between 1 and i.quantity
        or t.credential_hash is null or octet_length(t.credential_hash)<>32
        or not (
          (t.status='used' and t.used_at is not null and t.cancelled_at is null and t.refunded_at is null)
          or (o.status='refunded' and t.status='refunded' and t.refunded_at is not null
            and t.used_at is null and t.cancelled_at is null)
          or (o.status='paid' and e.status='cancelled' and t.status='cancelled'
            and t.cancelled_at is not null and t.used_at is null and t.refunded_at is null)
          or (o.status='paid' and e.status='published' and t.status='valid'
            and t.used_at is null and t.cancelled_at is null and t.refunded_at is null)
        )
      )
    );
$$;

revoke all on function public.server_lookup_lite_ticket_collection(text) from public, anon, authenticated;
grant execute on function public.server_lookup_lite_ticket_collection(text) to service_role;
comment on function public.server_lookup_lite_ticket_collection(text) is
  'Service-only coherent paid/refunded ticket collection. Internal source/hash facts must be verified and stripped by Edge; no PII, Stripe IDs or raw credentials.';
