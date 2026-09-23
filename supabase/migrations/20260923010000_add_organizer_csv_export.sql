-- Read-only projection. Existing owner, integrity and refund authorities remain unchanged.
create function public.get_organizer_event_export(p_event_id uuid, p_kind text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  e public.events;
  source_count bigint;
  output_count bigint;
  rows jsonb;
  result jsonb;
begin
  if p_kind is null or p_kind not in ('orders','admissions','registrations') then
    raise exception using errcode='22023', message='Invalid export kind';
  end if;
  -- This is the bulk-export authorization seam, distinct from admission permission.
  if p_kind='registrations' then
    e:=private.require_owned_free_event(p_event_id);
    select count(*) into source_count from public.free_registrations r where r.event_id=e.id;
  else
    e:=private.require_owned_paid_event(p_event_id);
    select count(*) into source_count from public.orders o where o.event_id=e.id;
  end if;
  if p_kind='orders' then output_count:=source_count;
  else select count(*) into output_count from public.tickets t where t.event_id=e.id;
  end if;
  if source_count>10000 or output_count>10000 then
    raise exception using errcode='PT413', message='EXPORT_LIMIT_EXCEEDED';
  end if;
  if p_kind='registrations' then
    if exists(select 1 from public.free_registrations r where r.event_id=e.id
      and not private.free_registration_is_coherent(r.id))
      or exists(select 1 from public.tickets t left join public.free_registrations r on r.id=t.registration_id
        where t.event_id=e.id and (r.id is null or r.event_id<>e.id or t.organizer_id<>e.organizer_id)) then
      raise exception using errcode='P0001', message='Operations data unavailable';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'registrationReference','RSVP-'||r.id::text,'registrantName',r.name,'registrantEmail',r.email,
      'registeredAt',r.created_at,'registrationStatus',r.status,'registrationQuantity',r.quantity,
      'admissionPosition',t.unit_sequence,'admissionLabel',t.admission_label,'admissionStatus',t.status,
      'issuedAt',t.issued_at,'usedAt',t.used_at
    ) order by r.created_at desc,r.id desc,t.unit_sequence),'[]'::jsonb) into rows
    from public.free_registrations r join public.tickets t on t.registration_id=r.id where r.event_id=e.id;
  else
    if exists(select 1 from public.orders o where o.event_id=e.id and not private.organizer_order_coherent(o.id))
      or exists(select 1 from public.tickets t left join public.orders o on o.id=t.order_id
        where t.event_id=e.id and (o.id is null or o.event_id<>e.id or t.organizer_id<>e.organizer_id)) then
      raise exception using errcode='P0001', message='Operations data unavailable';
    end if;
    if p_kind='orders' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'orderNumber',o.order_number,'buyerName',o.buyer_name,'buyerEmail',o.buyer_email,
        'createdAt',o.created_at,'paidAt',o.paid_at,'status',o.status,
        'refundWorkflowState',private.order_refund_state(o),'quantity',o.quantity,
        'currency',o.currency,'subtotalMinor',o.subtotal_minor,'taxMinor',o.tax_amount_minor,'totalMinor',o.total_minor,
        'items',(select jsonb_agg(jsonb_build_object('tierName',i.tier_name,'quantity',i.quantity,
          'unitAmountMinor',i.unit_amount_minor,'subtotalMinor',i.subtotal_minor,'currency',i.currency) order by i.id)
          from public.order_items i where i.order_id=o.id)
      ) order by o.created_at desc,o.id desc),'[]'::jsonb) into rows from public.orders o where o.event_id=e.id;
    else
      select coalesce(jsonb_agg(jsonb_build_object(
        'orderNumber',q.order_number,'ticketPosition',q.position,'ticketsInOrder',q.quantity,
        'buyerName',q.buyer_name,'buyerEmail',q.buyer_email,'ticketTier',q.admission_label,
        'orderStatus',q.order_status,'ticketStatus',q.ticket_status,'issuedAt',q.issued_at,'usedAt',q.used_at
      ) order by q.created_at desc,q.order_id desc,q.order_item_id,q.unit_sequence),'[]'::jsonb) into rows
      from (select o.id order_id,o.created_at,o.order_number,o.quantity,o.buyer_name,o.buyer_email,o.status order_status,
        t.order_item_id,t.unit_sequence,t.admission_label,t.status ticket_status,t.issued_at,t.used_at,
        row_number() over(partition by o.id order by t.order_item_id,t.unit_sequence) position
        from public.orders o join public.tickets t on t.order_id=o.id where o.event_id=e.id) q;
    end if;
  end if;
  if jsonb_array_length(rows)<>output_count then
    raise exception using errcode='P0001', message='Operations data unavailable';
  end if;
  result:=jsonb_build_object('schemaVersion',1,'kind',p_kind,'event',jsonb_build_object(
    'id',e.id,'title',e.title,'status',e.status,'startsAt',e.starts_at,'endsAt',e.ends_at,'timezone',e.timezone),
    'exportedAt',statement_timestamp(),'rowCount',output_count,'rows',rows);
  if octet_length(result::text)>8388608 then
    raise exception using errcode='PT413', message='EXPORT_LIMIT_EXCEEDED';
  end if;
  return result;
end;
$$;
revoke all on function public.get_organizer_event_export(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_organizer_event_export(uuid,text) to authenticated;
comment on function public.get_organizer_event_export(uuid,text) is
  'Owner-only complete-or-fail CSV source projection; 10000 sources/rows and 8 MiB, no credentials, no lifecycle writes.';
