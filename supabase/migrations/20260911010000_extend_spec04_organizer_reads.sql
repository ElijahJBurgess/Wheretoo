-- Additive Spec04 read contracts. Existing organizer read RPCs and all writer
-- boundaries remain unchanged.
create index orders_organizer_event_status_page_idx
on public.orders (organizer_id, event_id, status, created_at desc, id desc);

create function public.list_organizer_event_orders_filtered(
  p_event_id uuid,
  p_search text default '',
  p_status text default 'all',
  p_limit integer default 25,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_row public.orders;
  v_rows jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_cursor jsonb := null;
  v_next jsonb := null;
begin
  v_event := private.require_owned_paid_event(p_event_id);

  if p_limit is null
    or p_limit not between 1 and 50
    or p_search is null
    or length(p_search) > 320
    or p_status is null
    or p_status not in ('all', 'paid', 'refunded')
    or ((p_cursor_created_at is null) <> (p_cursor_id is null))
    or (p_cursor_created_at is not null and not isfinite(p_cursor_created_at)) then
    raise exception using errcode = '22023', message = 'Invalid order query';
  end if;

  for v_row in
    select orders.*
    from public.orders
    where orders.event_id = p_event_id
      and orders.organizer_id = v_event.organizer_id
      and (p_status = 'all' or orders.status = p_status)
      and (
        p_cursor_id is null
        or (orders.created_at, orders.id) < (p_cursor_created_at, p_cursor_id)
      )
      -- strpos keeps %, _ and backslashes literal, matching the original RPC.
      and (
        strpos(lower(orders.buyer_name), lower(trim(p_search))) > 0
        or strpos(lower(orders.buyer_email), lower(trim(p_search))) > 0
        or strpos(lower(orders.order_number), lower(trim(p_search))) > 0
      )
    order by orders.created_at desc, orders.id desc
    limit p_limit + 1
  loop
    v_count := v_count + 1;
    if v_count > p_limit then
      v_next := v_cursor;
      exit;
    end if;

    if not private.organizer_order_coherent(v_row.id) then
      raise exception using errcode = 'P0001', message = 'Operations data unavailable';
    end if;

    v_rows := v_rows || jsonb_build_array(private.organizer_order_summary(v_row));
    v_cursor := jsonb_build_object('createdAt', v_row.created_at, 'id', v_row.id);
  end loop;

  return jsonb_build_object('orders', v_rows, 'nextCursor', v_next);
end;
$$;

revoke all on function public.list_organizer_event_orders_filtered(
  uuid, text, text, integer, timestamptz, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.list_organizer_event_orders_filtered(
  uuid, text, text, integer, timestamptz, uuid
) to authenticated;

create function public.get_organizer_order_v2(p_event_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_base jsonb;
  v_items jsonb;
begin
  -- The existing detail boundary remains the authority for ownership,
  -- coherence, ticket ordering, refund state, and admission eligibility.
  v_base := public.get_organizer_order(p_event_id, p_order_id);

  select orders.* into strict v_order
  from public.orders
  where orders.id = p_order_id and orders.event_id = p_event_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'tierName', order_items.tier_name,
        'quantity', order_items.quantity,
        'subtotalMinor', order_items.subtotal_minor,
        'unitAmountMinor', order_items.unit_amount_minor
      )
      order by order_items.id
    ),
    '[]'::jsonb
  ) into v_items
  from public.order_items
  where order_items.order_id = v_order.id;

  return v_base || jsonb_build_object(
    'subtotalMinor', v_order.subtotal_minor,
    'taxMinor', v_order.tax_amount_minor,
    'items', v_items
  );
end;
$$;

revoke all on function public.get_organizer_order_v2(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_organizer_order_v2(uuid, uuid)
to authenticated;
