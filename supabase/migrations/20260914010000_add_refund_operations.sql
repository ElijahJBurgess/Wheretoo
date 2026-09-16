-- Post-purchase operation bookkeeping only. Existing refund/economics and
-- canonical Stripe reconciliation remain the only financial writer.
create table private.order_refund_operations (
 order_id uuid primary key references public.orders(id) on delete restrict,
 id uuid not null unique default gen_random_uuid(),
 idempotency_key text not null unique,
 snapshot jsonb not null,
 requested_at timestamptz not null default clock_timestamp(),
 first_possible_dispatch_at timestamptz not null default clock_timestamp(),
 state text not null default 'submitting' check(state in ('submitting','processing','unknown','failed','review','completed')),
 stripe_refund_id text check(stripe_refund_id ~ '^re_[A-Za-z0-9]+$'),
 completed_at timestamptz,
 updated_at timestamptz not null default clock_timestamp(),
 check(idempotency_key='whereto-refund-integrity-v1:'||order_id::text),
 check((state='completed')=(completed_at is not null))
);
revoke all on private.order_refund_operations from public,anon,authenticated,service_role;

create function private.protect_order_refund_operation() returns trigger language plpgsql set search_path='' as $$
begin
 if row(new.order_id,new.id,new.idempotency_key,new.snapshot,new.requested_at,new.first_possible_dispatch_at)
  is distinct from row(old.order_id,old.id,old.idempotency_key,old.snapshot,old.requested_at,old.first_possible_dispatch_at)
  or (old.stripe_refund_id is not null and new.stripe_refund_id is distinct from old.stripe_refund_id)
  or (old.completed_at is not null and row(new.state,new.completed_at) is distinct from row(old.state,old.completed_at)) then
  raise exception 'Immutable refund operation';
 end if;
 return new;
end;
$$;
create trigger order_refund_operation_immutable before update on private.order_refund_operations for each row execute function private.protect_order_refund_operation();

create function private.require_refund_order(p_organizer_id uuid,p_event_id uuid,p_order_id uuid)
returns public.orders language plpgsql stable security definer set search_path='' as $$
declare o public.orders;
begin
 select orders.* into o from public.orders orders join public.events e on e.id=orders.event_id
 where orders.id=p_order_id and orders.event_id=p_event_id and orders.organizer_id=p_organizer_id
 and e.organizer_id=p_organizer_id and e.admission_type='paid' and not orders.livemode;
 if p_organizer_id is null or not found then raise exception using errcode='42501',message='Order unavailable';end if;
 if not private.organizer_order_coherent(o.id) then raise exception using errcode='P0001',message='Order unavailable';end if;
 return o;
end;
$$;

create function private.order_refund_state(p_order public.orders) returns text language plpgsql stable security definer set search_path='' as $$
declare op private.order_refund_operations;
begin
 if p_order.status='refunded' and p_order.paid_at is not null and p_order.refunded_at is not null and p_order.reconciliation_status='reconciled' then return 'completed';end if;
 if p_order.status in ('requires_review','partially_refunded') then return 'review';end if;
 select * into op from private.order_refund_operations where order_id=p_order.id;
 if op.state in ('review','failed') then return op.state;end if;
 if exists(select 1 from public.refunds r where r.order_id=p_order.id and r.status='requires_action') then return 'review';end if;
 if exists(select 1 from public.refunds r where r.order_id=p_order.id and r.status='pending') then return 'processing';end if;
 if exists(select 1 from public.refunds r where r.order_id=p_order.id and r.status='succeeded') then return 'review';end if;
 if exists(select 1 from public.refunds r where r.order_id=p_order.id and r.status in ('failed','cancelled')) then return 'failed';end if;
 select * into op from private.order_refund_operations where order_id=p_order.id;
 if found then
  if op.state='submitting' and op.first_possible_dispatch_at<clock_timestamp()-interval '5 minutes' then return 'unknown';end if;
  return op.state;
 end if;
 if p_order.status='paid' and p_order.paid_at is not null and p_order.refunded_at is null and p_order.reconciliation_status='reconciled'
  and p_order.total_minor>0 and p_order.stripe_payment_intent_id is not null and p_order.stripe_charge_id is not null
  and p_order.stripe_transfer_id is not null and p_order.stripe_application_fee_id is not null then return 'eligible';end if;
 return 'ineligible';
end;
$$;

create function public.get_organizer_refund_status(p_event_id uuid,p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare o public.orders; s text; op private.order_refund_operations;
begin
 o:=private.require_refund_order(auth.uid(),p_event_id,p_order_id);
 s:=private.order_refund_state(o);
 select * into op from private.order_refund_operations where order_id=o.id;
 return jsonb_build_object('orderId',o.id,'eventId',o.event_id,'orderNumber',o.order_number,
 'eventName',(select title from public.events where id=o.event_id),'buyerName',o.buyer_name,'buyerEmail',o.buyer_email,
 'currency',o.currency,'totalMinor',o.total_minor,'quantity',o.quantity,
 'items',(select jsonb_agg(jsonb_build_object('tierName',i.tier_name,'quantity',i.quantity,'subtotalMinor',i.subtotal_minor) order by i.id) from public.order_items i where order_id=o.id),
 'tickets',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'admissionLabel',t.admission_label,'status',t.status,'usedAt',t.used_at) order by t.order_item_id,t.unit_sequence),'[]') from public.tickets t where t.order_id=o.id),
 'state',s,'action',case when s='eligible' then 'submit' when s in ('submitting','processing','unknown','review') then 'reconcile' else 'none' end,
 'requestedAt',op.requested_at,'completedAt',case when s='completed' then o.refunded_at end);
end;
$$;
revoke all on function public.get_organizer_refund_status(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_organizer_refund_status(uuid,uuid) to authenticated;

-- Claim is serialized with refund/check-in's existing event/order lock hierarchy.
-- A second call NEVER grants another create, even before webhook evidence exists.
create function public.server_claim_owned_refund(p_organizer_id uuid,p_event_id uuid,p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders; s text; snapshot jsonb; inserted uuid;
begin
 o:=private.require_refund_order(p_organizer_id,p_event_id,p_order_id);
 perform * from private.lock_payment_order(o.id);
 o:=private.require_refund_order(p_organizer_id,p_event_id,p_order_id);
 s:=private.order_refund_state(o);
 if s<>'eligible' then return jsonb_build_object('dispatch',false,'state',s);end if;
 -- Reuse the approved preparation checks and snapshot; no browser financial input.
 perform * from public.server_prepare_whole_order_refund(o.id,'requested_by_customer');
 snapshot:=jsonb_build_object('orderId',o.id,'paymentIntentId',o.stripe_payment_intent_id,'chargeId',o.stripe_charge_id,
 'transferId',o.stripe_transfer_id,'applicationFeeId',o.stripe_application_fee_id,'connectedAccountId',o.stripe_destination_account_id,
 'totalMinor',o.total_minor,'applicationFeeAmountMinor',o.application_fee_amount_minor,'currency',o.currency,'reason','requested_by_customer');
 insert into private.order_refund_operations(order_id,idempotency_key,snapshot)
 values(o.id,'whereto-refund-integrity-v1:'||o.id::text,snapshot) on conflict(order_id) do nothing returning id into inserted;
 return jsonb_build_object('dispatch',inserted is not null,'state','submitting');
end;
$$;

-- Every status observation remains service-side and cannot mark financial completion.
create function public.server_note_refund_observation(p_organizer_id uuid,p_event_id uuid,p_order_id uuid,p_state text,p_refund_id text default null) returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders; op private.order_refund_operations;
begin
 o:=private.require_refund_order(p_organizer_id,p_event_id,p_order_id);
 if p_state is null or p_state not in ('processing','unknown','failed','review') or (p_refund_id is not null and p_refund_id !~ '^re_[A-Za-z0-9]+$') then
  raise exception using errcode='22023',message='Invalid refund observation';end if;
 perform * from private.lock_payment_order(o.id);
 select * into op from private.order_refund_operations where order_id=o.id for update;
 if not found or op.state='completed' then return;end if;
 update private.order_refund_operations set state=case when op.state='review' or (op.stripe_refund_id is not null and p_refund_id is not null and op.stripe_refund_id<>p_refund_id) then 'review' when op.state='failed' then 'failed' else p_state end,
 stripe_refund_id=coalesce(op.stripe_refund_id,p_refund_id),updated_at=clock_timestamp() where order_id=o.id;
end;
$$;

create function public.server_read_owned_refund_operation(p_organizer_id uuid,p_event_id uuid,p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare o public.orders; op private.order_refund_operations; snapshot jsonb; r public.refunds; s text;
begin
 o:=private.require_refund_order(p_organizer_id,p_event_id,p_order_id);s:=private.order_refund_state(o);
 select * into op from private.order_refund_operations where order_id=o.id;
 select * into r from public.refunds where order_id=o.id order by created_at desc limit 1;
 -- Recover legacy approved refunds as well as operations with no received webhook.
 snapshot:=coalesce(op.snapshot,jsonb_build_object('orderId',o.id,'paymentIntentId',o.stripe_payment_intent_id,'chargeId',o.stripe_charge_id,
 'transferId',o.stripe_transfer_id,'applicationFeeId',o.stripe_application_fee_id,'connectedAccountId',o.stripe_destination_account_id,
 'totalMinor',o.total_minor,'applicationFeeAmountMinor',o.application_fee_amount_minor,'currency',o.currency,'reason','requested_by_customer'));
 return jsonb_build_object('state',s,'hasOperation',op.order_id is not null,'canRecover',((op.order_id is not null and o.status='paid' and o.reconciliation_status='reconciled') or private.organizer_refund_state(o)='recoverable'),'snapshot',snapshot||jsonb_build_object('refundId',coalesce(op.stripe_refund_id,r.stripe_refund_id),'reversalId',r.stripe_transfer_reversal_id,'feeRefundId',r.stripe_application_fee_refund_id));
end;
$$;

create function private.complete_refund_operation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='refunded' and new.refunded_at is not null and new.paid_at is not null and new.reconciliation_status='reconciled' then
  update private.order_refund_operations set state='completed',completed_at=new.refunded_at,updated_at=clock_timestamp() where order_id=new.id and state<>'completed';
 end if;
 return new;
end;
$$;
create trigger orders_complete_refund_operation after update of status,reconciliation_status on public.orders for each row execute function private.complete_refund_operation();

-- Preserve Spec07's source resolver; layer only post-purchase refund eligibility.
alter function private.ticket_email_source(text,uuid) rename to ticket_email_source_before_spec09;
create function private.ticket_email_source(p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare source jsonb; o public.orders;
begin
 source:=private.ticket_email_source_before_spec09(p_kind,p_id);
 if p_kind='paid_order' and source is not null then
  select * into o from public.orders where id=p_id;
  if private.order_refund_state(o)<>'eligible' then source:=source||jsonb_build_object('eligible',false,'reason','financially_unresolved');end if;
 end if;
 return source;
end;
$$;
revoke all on function private.protect_order_refund_operation(),private.require_refund_order(uuid,uuid,uuid),private.order_refund_state(public.orders),private.complete_refund_operation(),private.ticket_email_source(text,uuid),private.ticket_email_source_before_spec09(text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.server_claim_owned_refund(uuid,uuid,uuid),public.server_note_refund_observation(uuid,uuid,uuid,text,text),public.server_read_owned_refund_operation(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.server_claim_owned_refund(uuid,uuid,uuid),public.server_note_refund_observation(uuid,uuid,uuid,text,text),public.server_read_owned_refund_operation(uuid,uuid,uuid) to service_role;
