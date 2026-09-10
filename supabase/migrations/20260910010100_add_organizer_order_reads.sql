-- Event-scoped keyset pagination; base table grants remain unchanged.
create index orders_organizer_event_page_idx on public.orders(organizer_id,event_id,created_at desc,id desc);
create function private.organizer_order_summary(p_order public.orders)
returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('id',p_order.id,'orderNumber',p_order.order_number,
 'buyerName',p_order.buyer_name,'buyerEmail',p_order.buyer_email,'createdAt',p_order.created_at,
 'paidAt',p_order.paid_at,'status',p_order.status,'quantity',p_order.quantity,
 'totalMinor',p_order.total_minor,'currency',p_order.currency,
 'items',(select coalesce(jsonb_agg(jsonb_build_object('tierName',i.tier_name,'quantity',i.quantity,
   'subtotalMinor',i.subtotal_minor) order by i.id),'[]'::jsonb) from public.order_items i where i.order_id=p_order.id));
$$;
revoke all on function private.organizer_order_summary(public.orders) from public,anon,authenticated,service_role;
create function public.list_organizer_event_orders(p_event_id uuid,p_search text default '',p_limit integer default 25,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_event public.events; v_row public.orders; v_rows jsonb='[]'; v_count integer=0; v_cursor jsonb=null; v_next jsonb=null;
begin
 v_event:=private.require_owned_paid_event(p_event_id);
 if p_limit is null or p_limit not between 1 and 50 or p_search is null or length(p_search)>320
   or ((p_cursor_created_at is null)<>(p_cursor_id is null))
   or (p_cursor_created_at is not null and not isfinite(p_cursor_created_at)) then
   raise exception using errcode='22023',message='Invalid order query';
 end if;
 for v_row in select o.* from public.orders o where o.event_id=p_event_id and o.organizer_id=v_event.organizer_id
   and (p_cursor_id is null or (o.created_at,o.id)<(p_cursor_created_at,p_cursor_id))
   -- strpos deliberately treats %, _ and backslashes as literal search characters.
   and (strpos(lower(o.buyer_name),lower(trim(p_search)))>0
     or strpos(lower(o.buyer_email),lower(trim(p_search)))>0
     or strpos(lower(o.order_number),lower(trim(p_search)))>0)
   order by o.created_at desc,o.id desc limit p_limit+1 loop
   v_count:=v_count+1;
   if v_count>p_limit then v_next:=v_cursor; exit; end if;
   if not private.organizer_order_coherent(v_row.id) then
     raise exception using errcode='P0001',message='Operations data unavailable';
   end if;
   v_rows:=v_rows||jsonb_build_array(private.organizer_order_summary(v_row));
   v_cursor:=jsonb_build_object('createdAt',v_row.created_at,'id',v_row.id);
 end loop;
 return jsonb_build_object('orders',v_rows,'nextCursor',v_next);
end;
$$;
revoke all on function public.list_organizer_event_orders(uuid,text,integer,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_organizer_event_orders(uuid,text,integer,timestamptz,uuid) to authenticated;
