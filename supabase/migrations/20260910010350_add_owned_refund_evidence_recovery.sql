-- Expose only the existing policy-mismatch recovery case; no new refund writer.
create or replace function private.organizer_refund_state(p_order public.orders)
returns text language sql stable security definer set search_path='' as $$
select case when p_order.status='refunded' and p_order.refunded_at is not null then 'refunded'
 when exists(select 1 from public.refunds r where r.order_id=p_order.id and r.status in ('pending','requires_action')) then 'pending'
 when p_order.status='requires_review' and p_order.failure_code='REFUND_POLICY_MISMATCH' and p_order.paid_at is not null
  and (select count(*)=1 and bool_and(r.status='succeeded' and not r.policy_verified and r.policy_failure_code='REFUND_POLICY_MISMATCH') from public.refunds r where r.order_id=p_order.id) then 'recoverable'
 when p_order.status='paid' and p_order.paid_at is not null and p_order.refunded_at is null
  and p_order.reconciliation_status='reconciled' and not exists(select 1 from public.refunds r where r.order_id=p_order.id and r.status='succeeded') then 'available'
 else 'unavailable' end;
$$;
create or replace function public.server_get_organizer_refund_context(p_organizer_id uuid,p_event_id uuid,p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_order public.orders; v_state text; v_refund public.refunds;
begin
 select o.* into v_order from public.orders o join public.events e on e.id=o.event_id
 where o.id=p_order_id and o.event_id=p_event_id and o.organizer_id=p_organizer_id
 and e.organizer_id=p_organizer_id and e.admission_type='paid' and not o.livemode;
 if p_organizer_id is null or not found then raise exception using errcode='42501',message='Order unavailable'; end if;
 if not private.organizer_order_coherent(v_order.id) then raise exception using errcode='P0001',message='Operations data unavailable'; end if;
 v_state:=private.organizer_refund_state(v_order);
 if v_state='recoverable' then
  select * into strict v_refund from public.refunds where order_id=p_order_id;
  return jsonb_build_object('refundState',v_state,'recovery',jsonb_build_object(
   'orderId',v_order.id,'paymentIntentId',v_order.stripe_payment_intent_id,'chargeId',v_order.stripe_charge_id,
   'transferId',v_order.stripe_transfer_id,'applicationFeeId',v_order.stripe_application_fee_id,
   'connectedAccountId',v_order.stripe_destination_account_id,'totalMinor',v_order.total_minor,
   'applicationFeeAmountMinor',v_order.application_fee_amount_minor,'refundId',v_refund.stripe_refund_id,
   'reversalId',v_refund.stripe_transfer_reversal_id,'feeRefundId',v_refund.stripe_application_fee_refund_id));
 end if;
 return jsonb_build_object('refundState',v_state);
end;
$$;
