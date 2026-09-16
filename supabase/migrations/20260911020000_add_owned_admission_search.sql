-- Spec 05 read projection only. All admission transitions remain unchanged.
create function public.list_organizer_event_admissions(
 p_event_id uuid, p_search text default '', p_limit integer default 25, p_cursor jsonb default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_event public.events; v_row record; v_count integer:=0;
 v_rows jsonb:='[]'; v_next jsonb:=null; v_last jsonb:=null;
 v_created timestamptz; v_order uuid; v_item uuid; v_unit integer;
begin
 v_event:=private.require_owned_paid_event(p_event_id);
 if p_search is null or length(p_search)>320 or p_limit is null or p_limit not between 1 and 50 then
  raise exception using errcode='22023',message='Invalid admission query';
 end if;
 if p_cursor is not null then
  begin
   if jsonb_typeof(p_cursor)<>'object' or (select count(*) from jsonb_object_keys(p_cursor))<>4
    or not (p_cursor ?& array['createdAt','orderId','orderItemId','unitSequence'])
    or jsonb_typeof(p_cursor->'createdAt')<>'string' or jsonb_typeof(p_cursor->'orderId')<>'string'
    or jsonb_typeof(p_cursor->'orderItemId')<>'string' or jsonb_typeof(p_cursor->'unitSequence')<>'number' then
    raise exception 'Invalid cursor';
   end if;
   v_created:=(p_cursor->>'createdAt')::timestamptz; v_order:=(p_cursor->>'orderId')::uuid;
   v_item:=(p_cursor->>'orderItemId')::uuid; v_unit:=(p_cursor->>'unitSequence')::integer;
   if not isfinite(v_created) or v_unit not between 1 and 10 or not exists(
    select 1 from public.orders o join public.tickets t on t.order_id=o.id
    where o.id=v_order and o.created_at=v_created and o.event_id=p_event_id and o.organizer_id=v_event.organizer_id
     and t.event_id=p_event_id and t.organizer_id=v_event.organizer_id and t.order_item_id=v_item and t.unit_sequence=v_unit
   ) then raise exception 'Invalid cursor'; end if;
  exception when others then
   raise exception using errcode='22023',message='Invalid admission query';
  end;
 end if;
 -- No automatic directory on the initial search screen.
 if btrim(p_search)='' then return jsonb_build_object('admissions',v_rows,'nextCursor',null); end if;
 for v_row in
  select q.* from (
   select o.id as order_id,o.created_at,o.order_number,o.buyer_name,o.buyer_email,o.quantity,
    t.id as ticket_id,t.order_item_id,t.unit_sequence,t.admission_label,t.status,t.used_at,
    row_number() over(partition by o.id order by t.order_item_id,t.unit_sequence) as position
   from public.orders o join public.tickets t on t.order_id=o.id
   where o.event_id=p_event_id and o.organizer_id=v_event.organizer_id
    and t.event_id=p_event_id and t.organizer_id=v_event.organizer_id
    and (strpos(lower(o.buyer_name),lower(btrim(p_search)))>0 or strpos(lower(o.buyer_email),lower(btrim(p_search)))>0)
  ) q where p_cursor is null or (q.created_at,q.order_id)<(v_created,v_order)
   or (q.created_at=v_created and q.order_id=v_order and (q.order_item_id,q.unit_sequence)>(v_item,v_unit))
  order by q.created_at desc,q.order_id desc,q.order_item_id,q.unit_sequence limit p_limit+1
 loop
  v_count:=v_count+1;
  if v_count>p_limit then v_next:=v_last; exit; end if;
  if not private.organizer_order_coherent(v_row.order_id) then
   raise exception using errcode='P0001',message='Operations data unavailable';
  end if;
  v_rows:=v_rows||jsonb_build_array(jsonb_build_object(
   'ticketId',v_row.ticket_id,'orderId',v_row.order_id,'orderNumber',v_row.order_number,
   'buyerName',v_row.buyer_name,'buyerEmail',v_row.buyer_email,'admissionLabel',v_row.admission_label,
   'ticketPosition',v_row.position,'ticketTotal',v_row.quantity,'status',v_row.status,'usedAt',v_row.used_at));
  v_last:=jsonb_build_object('createdAt',v_row.created_at,'orderId',v_row.order_id,'orderItemId',v_row.order_item_id,'unitSequence',v_row.unit_sequence);
 end loop;
 return jsonb_build_object('admissions',v_rows,'nextCursor',v_next);
end;
$$;
revoke all on function public.list_organizer_event_admissions(uuid,text,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.list_organizer_event_admissions(uuid,text,integer,jsonb) to authenticated;
