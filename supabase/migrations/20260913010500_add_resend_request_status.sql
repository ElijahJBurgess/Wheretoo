create function public.get_ticket_email_resend_status(p_event_id uuid,p_source_kind text,p_source_id uuid,p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.get_ticket_email_delivery(p_event_id,p_source_kind,p_source_id);
 select jsonb_build_object('id',q.id,'state',case when q.state='sending' and q.lease_until<=clock_timestamp() then 'unknown' else q.state end,
 'observation',q.observation,'createdAt',q.created_at,'stoppedReason',q.dispatch_stopped_reason) into result
 from private.ticket_email_outbox q where q.purpose='resend' and q.request_id=p_request_id and q.requested_by=auth.uid()
 and ((p_source_kind='paid_order' and q.order_id=p_source_id) or (p_source_kind='free_registration' and q.registration_id=p_source_id));
 return result;
end;
$$;
revoke all on function public.get_ticket_email_resend_status(uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_ticket_email_resend_status(uuid,text,uuid,uuid) to authenticated;
