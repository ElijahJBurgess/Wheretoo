begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
-- Own synthetic rollback-only fixture. No historical J08g source or receipt is read or changed.
insert into auth.users (id, email) values
  ('ad100000-0000-4000-8000-000000000001', 'integrity-owner@example.invalid'),
  ('ad100000-0000-4000-8000-000000000002', 'integrity-other@example.invalid');

insert into public.organizers (id, display_name) values
  ('ad100000-0000-4000-8000-000000000001', 'Checkout Integrity Fulfillment'),
  ('ad100000-0000-4000-8000-000000000002', 'Checkout Integrity Other');

insert into public.events (
  id, organizer_id, status, moderation_status, title, description, category,
  starts_at, ends_at, venue_name, address_line1, city, region, postal_code,
  country_code, mapbox_feature_id, latitude, longitude, admission_type, published_at
) values (
  'ad200000-0000-4000-8000-000000000001',
  'ad100000-0000-4000-8000-000000000001',
  'published', 'clear', 'Checkout Integrity Fulfillment Event',
  'A synthetic event for rollback-only multi-item fulfillment verification.',
  'community', now() + interval '2 days', now() + interval '2 days 2 hours',
  'Integrity Hall', '1 Integrity Street', 'San Francisco', 'CA', '94105', 'US',
  'mapbox.checkout-integrity-fulfillment', 37.7936, -122.3958, 'paid', now()
), (
  'ad200000-0000-4000-8000-000000000002',
  'ad100000-0000-4000-8000-000000000002',
  'draft', 'clear', 'Checkout Integrity Other Event',
  'A reference-only event for incoherent ticket fixtures.',
  'community', now() + interval '3 days', now() + interval '3 days 2 hours',
  'Other Hall', '2 Integrity Street', 'San Francisco', 'CA', '94105', 'US',
  'mapbox.checkout-integrity-other', 37.7937, -122.3959, 'paid', null
);

insert into public.ticket_tiers (
  id, event_id, name, unit_amount_minor, currency, quantity_total, status, sort_order
) values
  (
    'ad300000-0000-4000-8000-000000000001',
    'ad200000-0000-4000-8000-000000000001',
    'General Admission', 1001, 'usd', 200, 'active', 1
  ),
  (
    'ad300000-0000-4000-8000-000000000002',
    'ad200000-0000-4000-8000-000000000001',
    'VIP', 999, 'usd', 200, 'active', 2
  ),
  (
    'ad300000-0000-4000-8000-000000000004',
    'ad200000-0000-4000-8000-000000000001',
    'Alternate General Admission', 1001, 'usd', 2, 'active', 3
  ),
  (
    'ad300000-0000-4000-8000-000000000003',
    'ad200000-0000-4000-8000-000000000002',
    'Other Admission', 1500, 'usd', 10, 'active', 1
  );

insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, transfers_status, payouts_status,
  requirements_status, requirements_currently_due_count,
  requirements_past_due_count, last_synced_at
) values (
  'ad100000-0000-4000-8000-000000000001', 'acct_integrityfulfillment',
  'active', 'active', 'clear', 0, 0, now()
);

insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present,
  explicit_adult_content, gambling_present, weapons_present, high_risk_activity
) values (
  'ad200000-0000-4000-8000-000000000001', 'all_ages',
  false, false, false, false, false, false
);

select set_config('request.jwt.claim.sub', 'ad100000-0000-4000-8000-000000000001', true);
set local role authenticated;
select public.accept_current_event_policies('ad200000-0000-4000-8000-000000000001');
select public.publish_event('ad200000-0000-4000-8000-000000000001');
reset role;

update private.checkout_runtime_control
set checkout_creation_enabled = true
where singleton;


create temporary table forward_fixture(order_id uuid, session_id text, stripe_event_id text, snapshot jsonb) on commit drop;
insert into forward_fixture
select order_id, 'cs_test_ForwardUnattachedOwn', 'evt_ForwardUnattachedOwn', null
from public.server_reserve_checkout(
 'ad200000-0000-4000-8000-000000000001',
 '[{"tier_id":"ad300000-0000-4000-8000-000000000001","quantity":2},{"tier_id":"ad300000-0000-4000-8000-000000000002","quantity":1}]',
 'Forward Control', 'forward-control@example.invalid',
 'ad400000-0000-4000-8000-000000000001', repeat('7',64));
insert into public.stripe_webhook_events(stripe_event_id,event_type,livemode,stripe_object_id,api_version,stripe_created_at,payload_sha256)
select stripe_event_id,'checkout.session.completed',false,session_id,'2026-07-29.dahlia',now(),repeat('8',64) from forward_fixture;
select is((select count(*) from public.tickets t join forward_fixture f on f.order_id=t.order_id),0::bigint,'forward control starts with no ticket history');
select ok((select o.status='creating_checkout' and o.stripe_checkout_session_id is null from public.orders o join forward_fixture f on f.order_id=o.id),'forward control preserves original unattached reservation');
-- Dynamic invocation lets RED retain TAP output and reach explicit rollback while the endpoint is absent.
do $$ begin
 if to_regprocedure('public.server_get_unattached_checkout_review_snapshot(uuid,text,text)') is not null then
   execute 'update forward_fixture f set snapshot=(select to_jsonb(s) from public.server_get_unattached_checkout_review_snapshot(f.order_id,f.session_id,f.stripe_event_id) s)';
 end if;
end $$;
select ok((select snapshot is not null from forward_fixture),'claimed original Session obtains a complete immutable forward candidate');


alter table forward_fixture add column kind text not null default 'eligible';
alter table forward_fixture add column payment jsonb;
alter table forward_fixture add column manifest jsonb;
create function pg_temp.forward_inputs(p_kind text) returns void language plpgsql as $$
begin
 update forward_fixture f set
 snapshot=(select to_jsonb(s) from public.server_get_unattached_checkout_review_snapshot(f.order_id,f.session_id,f.stripe_event_id) s),
 payment=(select jsonb_build_object('payment_intent_id','pi_Forward'||p_kind,'charge_id','ch_Forward'||p_kind,
   'transfer_id','tr_Forward'||p_kind,'application_fee_id','fee_Forward'||p_kind,
   'balance_transaction_id','txn_Forward'||p_kind,'customer_id',null,'mode','payment','payment_status','paid',
   'currency',o.currency,'subtotal_minor',o.subtotal_minor,'total_minor',o.total_minor,
   'application_fee_amount_minor',o.application_fee_amount_minor,'destination_account_id',o.stripe_destination_account_id,
   'checkout_expires_at',extract(epoch from o.checkout_expires_at)::bigint,'payment_affected',false)
   from public.orders o where o.id=f.order_id),
 manifest=(select jsonb_agg(jsonb_build_object('order_item_id',i.id,'unit_sequence',u.seq,
   'admission_label',i.tier_name,'credential_hash',encode(extensions.digest(i.id::text||':'||u.seq::text,'sha256'),'hex')) order by i.id,u.seq)
   from public.order_items i cross join lateral generate_series(1,i.quantity) u(seq) where i.order_id=f.order_id)
 where f.kind=p_kind;
end $$;
create function pg_temp.forward_new(p_kind text) returns void language plpgsql as $$
begin
 insert into forward_fixture(order_id,session_id,stripe_event_id,kind)
 select order_id,'cs_test_Forward'||p_kind,'evt_Forward'||p_kind,p_kind from public.server_reserve_checkout(
 'ad200000-0000-4000-8000-000000000001',
 '[{"tier_id":"ad300000-0000-4000-8000-000000000001","quantity":2},{"tier_id":"ad300000-0000-4000-8000-000000000002","quantity":1}]',
 'Forward Control','forward-'||lower(p_kind)||'@example.invalid',md5('forward-request-'||p_kind)::uuid,
 encode(extensions.digest('forward-bearer-'||p_kind,'sha256'),'hex'));
 insert into public.stripe_webhook_events(stripe_event_id,event_type,livemode,stripe_object_id,api_version,stripe_created_at,payload_sha256)
 select stripe_event_id,'checkout.session.completed',false,session_id,'2026-07-29.dahlia',now(),repeat('9',64) from forward_fixture where kind=p_kind;
 perform pg_temp.forward_inputs(p_kind);
end $$;
create function pg_temp.forward_apply(p_kind text,p_patch jsonb default '{}'::jsonb,p_digest text default null,p_session text default null)
returns jsonb language sql as $$
 select to_jsonb(r) from forward_fixture f cross join lateral public.server_reconcile_unattached_paid_checkout(
 f.order_id,coalesce(p_session,f.session_id),f.stripe_event_id,coalesce(p_digest,f.snapshot->>'snapshot_digest'),f.payment||p_patch,f.manifest) r where f.kind=p_kind;
$$;
select pg_temp.forward_inputs('eligible');
select ok(not has_function_privilege('anon','public.server_get_unattached_checkout_review_snapshot(uuid,text,text)','execute')
 and not has_function_privilege('authenticated','public.server_get_unattached_checkout_review_snapshot(uuid,text,text)','execute')
 and has_function_privilege('service_role','public.server_get_unattached_checkout_review_snapshot(uuid,text,text)','execute')
 and not has_function_privilege('anon','public.server_reconcile_unattached_paid_checkout(uuid,text,text,text,jsonb,jsonb)','execute')
 and not has_function_privilege('authenticated','public.server_reconcile_unattached_paid_checkout(uuid,text,text,text,jsonb,jsonb)','execute')
 and has_function_privilege('service_role','public.server_reconcile_unattached_paid_checkout(uuid,text,text,text,jsonb,jsonb)','execute'),
 'candidate reader and atomic writer are service only');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 where n.nspname='private' and p.proname in ('unattached_checkout_snapshot','reconcile_unattached_paid_checkout') and a.grantee<>p.proowner),0::bigint,'private implementations have no non-owner grants');
select ok((select bool_and(p.prosecdef and (p.proconfig COLLATE "C")=(array['search_path=""']::text[] COLLATE "C"))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('unattached_checkout_snapshot','reconcile_unattached_paid_checkout','server_get_unattached_checkout_review_snapshot','server_reconcile_unattached_paid_checkout')),
 'all four new functions use security definer and empty search path');
select throws_ok($$select pg_temp.forward_apply('eligible','{}',repeat('f',64))$$,'P0001','PAYMENT_SNAPSHOT_MISMATCH','stale digest has zero authority');
select throws_ok($$select pg_temp.forward_apply('eligible','{}',null,'cs_test_OtherForward')$$,'P0001','WEBHOOK_RECEIPT_MISMATCH','wrong Session cannot claim receipt');
select throws_ok($$select pg_temp.forward_apply('eligible','{"payment_status":"unpaid"}')$$,'P0001','PAYMENT_SNAPSHOT_MISMATCH','unpaid snapshot cannot attach');
select throws_ok($$select pg_temp.forward_apply('eligible','{"total_minor":1}')$$,'P0001','PAYMENT_SNAPSHOT_MISMATCH','wrong amount cannot attach');
select throws_ok($$select pg_temp.forward_apply('eligible','{"checkout_expires_at":1}')$$,'P0001','PAYMENT_SNAPSHOT_MISMATCH','changed expiry cannot attach');
select throws_ok($$select pg_temp.forward_apply('eligible','{"destination_account_id":"acct_Other"}')$$,'P0001','PAYMENT_SNAPSHOT_MISMATCH','wrong destination cannot attach');
select ok((select o.stripe_checkout_session_id is null and o.status='creating_checkout' from public.orders o join forward_fixture f on f.order_id=o.id where f.kind='eligible'),'all invalid inputs preserve reservation');
select is(pg_temp.forward_apply('eligible')->>'disposition','fulfilled','original eligible Session attaches and fulfills atomically');
select results_eq($$select t.unit_sequence,i.tier_name from public.tickets t join public.order_items i on i.id=t.order_item_id join forward_fixture f on f.order_id=t.order_id where f.kind='eligible' order by i.tier_name,t.unit_sequence$$,
 $$values(1,'General Admission'::text),(2,'General Admission'::text),(1,'VIP'::text)$$,'exact three immutable source units issued');
create temporary table first_ticket_history as select t.* from public.tickets t join forward_fixture f on f.order_id=t.order_id where f.kind='eligible';
select is(pg_temp.forward_apply('eligible')->>'disposition','replay','lost response replay keeps successful receipt closed');
update forward_fixture set stripe_event_id='evt_ForwardDuplicate' where kind='eligible';
insert into public.stripe_webhook_events(stripe_event_id,event_type,livemode,stripe_object_id,api_version,stripe_created_at,payload_sha256)
select stripe_event_id,'checkout.session.async_payment_succeeded',false,session_id,'2026-07-29.dahlia',now(),repeat('1',64) from forward_fixture where kind='eligible';
select is(pg_temp.forward_apply('eligible')->>'disposition','replay','different claimed receipt for same Session cannot issue twice');
select results_eq($$select to_jsonb(t) from public.tickets t join forward_fixture f on f.order_id=t.order_id where f.kind='eligible' order by t.id$$,$$select to_jsonb(t) from first_ticket_history t order by t.id$$,'all ticket bytes unchanged after both replays');
select is((select count(*) from private.ticket_email_outbox e join forward_fixture f on f.order_id=e.order_id where f.kind='eligible' and e.purpose='initial'),1::bigint,'existing fulfillment enqueues initial email exactly once');
select pg_temp.forward_new('AttachRace');
select public.server_attach_checkout_session(f.order_id,f.session_id,o.checkout_expires_at) from forward_fixture f join public.orders o on o.id=f.order_id where f.kind='AttachRace';
select is((select count(*) from forward_fixture f cross join lateral public.server_get_unattached_checkout_review_snapshot(f.order_id,f.session_id,f.stripe_event_id) s where f.kind='AttachRace'),1::bigint,'candidate resolves same-Session attachment after ordinary snapshot miss');
select is(pg_temp.forward_apply('AttachRace')->>'disposition','replay','same-Session UI attach between read and write uses current canonical order');
select is((select count(*) from public.tickets t join forward_fixture f on f.order_id=t.order_id where f.kind='AttachRace'),3::bigint,'UI attach race fulfills once');
select pg_temp.forward_new('Conflict');
select public.server_attach_checkout_session(f.order_id,'cs_test_ConflictingSession',o.checkout_expires_at) from forward_fixture f join public.orders o on o.id=f.order_id where f.kind='Conflict';
select throws_ok($$select pg_temp.forward_apply('Conflict')$$,'P0001','PAYMENT_SNAPSHOT_MISMATCH','different Session attachment cannot be replaced');
select pg_temp.forward_new('Expired');
update public.orders set status='expired',failure_code='CHECKOUT_EXPIRED' where id=(select order_id from forward_fixture where kind='Expired');
select is(pg_temp.forward_apply('Expired')->>'disposition','review','expired original reservation is quarantined');
select ok((select o.status='expired' and o.stripe_checkout_session_id is null and o.reconciliation_status='requires_review' and o.failure_code='UNATTACHED_PAID_CHECKOUT' from public.orders o join forward_fixture f on f.order_id=o.id where f.kind='Expired'),'quarantine preserves expired state and null Session');
select is((select c.confirmation_status from public.server_lookup_checkout_integrity_confirmation(encode(extensions.digest('forward-bearer-Expired','sha256'),'hex')) c),'requires_review','buyer projection shows received-payment review instead of expired checkout');
create temporary table quarantine_before as select o.* from public.orders o join forward_fixture f on f.order_id=o.id where f.kind='Expired';
insert into public.stripe_webhook_events(stripe_event_id,event_type,livemode,stripe_object_id,api_version,stripe_created_at,payload_sha256)
values('evt_ForwardReviewSwitched','checkout.session.completed',false,'cs_test_ForwardReviewSwitched','2026-07-29.dahlia',now(),repeat('2',64));
select is((select count(*) from forward_fixture f cross join lateral public.server_get_unattached_checkout_review_snapshot(f.order_id,'cs_test_ForwardReviewSwitched','evt_ForwardReviewSwitched') s where f.kind='Expired'),0::bigint,'review candidate refuses different Session than original review receipt');
select throws_ok($$select r.* from forward_fixture f cross join lateral public.server_reconcile_unattached_paid_checkout(f.order_id,'cs_test_ForwardReviewSwitched','evt_ForwardReviewSwitched',f.snapshot->>'snapshot_digest',f.payment,f.manifest) r where f.kind='Expired'$$,'P0001','PAYMENT_SNAPSHOT_MISMATCH','different Session cannot overwrite review anchor');
select results_eq($$select to_jsonb(o) from public.orders o join forward_fixture f on f.order_id=o.id where f.kind='Expired'$$,$$select to_jsonb(o) from quarantine_before o$$,'review order and original receipt pointer remain unchanged');
select pg_temp.forward_new('Cancelled');
update public.orders set status='cancelled' where id=(select order_id from forward_fixture where kind='Cancelled');
select is(pg_temp.forward_apply('Cancelled')->>'order_status','cancelled','cancel race preserves cancellation');
select pg_temp.forward_new('Ineligible');
update public.ticket_tiers set status='archived' where id='ad300000-0000-4000-8000-000000000001';
select is(pg_temp.forward_apply('Ineligible')->>'disposition','review','current tier ineligibility rolls back tentative attach');
update public.ticket_tiers set status='active' where id='ad300000-0000-4000-8000-000000000001';
select pg_temp.forward_new('Reused');
update forward_fixture set payment=jsonb_set(payment,'{charge_id}',to_jsonb('ch_Forwardeligible'::text)) where kind='Reused';
select throws_ok($$select pg_temp.forward_apply('Reused')$$,'P0001','PAYMENT_OBJECT_ALREADY_USED','reused provider charge cannot poison another order');
select pg_temp.forward_new('ReviewedReuse');
update forward_fixture set session_id=(select session_id from forward_fixture where kind='Expired') where kind='ReviewedReuse';
update public.stripe_webhook_events set stripe_object_id=(select session_id from forward_fixture where kind='Expired') where stripe_event_id='evt_ForwardReviewedReuse';
select pg_temp.forward_inputs('ReviewedReuse');
select throws_ok($$select pg_temp.forward_apply('ReviewedReuse')$$,'P0001','PAYMENT_OBJECT_ALREADY_USED','quarantined Session cannot be claimed for another order');
select pg_temp.forward_new('Permanent');
update public.stripe_webhook_events set processing_status='processed',processed_at=now(),error_code='PAYMENT_SNAPSHOT_MISMATCH' where stripe_event_id='evt_ForwardPermanent';
create temporary table permanent_before as select r.* from public.stripe_webhook_events r where r.stripe_event_id='evt_ForwardPermanent';
select throws_ok($$select pg_temp.forward_apply('Permanent')$$,'P0001','WEBHOOK_RECEIPT_MISMATCH','permanently failed receipt is not reopened');
select results_eq($$select to_jsonb(r) from public.stripe_webhook_events r where stripe_event_id='evt_ForwardPermanent'$$,$$select to_jsonb(r) from permanent_before r$$,'permanent receipt remains byte-identical');
select is((select count(*) from public.tickets t join forward_fixture f on f.order_id=t.order_id where f.kind not in ('eligible','AttachRace')),0::bigint,'quarantine and rejection issue no tickets');
select is((select count(*) from private.ticket_email_outbox e join forward_fixture f on f.order_id=e.order_id where f.kind not in ('eligible','AttachRace')),0::bigint,'ineligible savepoint also rolls back initial email enqueue');
select ok((select bool_and(o.stripe_checkout_session_id is null) from public.orders o join forward_fixture f on f.order_id=o.id where f.kind in ('Expired','Cancelled','Ineligible','Reused','Permanent')),'all unsuccessful unattached sources remain unattached');
-- Later lifecycle history belongs to the same tickets and cannot be regenerated.
update public.tickets set status='used',used_at=now() where id=(select min(t.id::text)::uuid from public.tickets t join forward_fixture f on f.order_id=t.order_id where f.kind='eligible');
create temporary table used_before as select t.* from public.tickets t join forward_fixture f on f.order_id=t.order_id where f.kind='eligible';
select is(pg_temp.forward_apply('eligible')->>'disposition','replay','processed receipt replay does not undo Used');
select results_eq($$select to_jsonb(t) from public.tickets t join forward_fixture f on f.order_id=t.order_id where f.kind='eligible' order by t.id$$,$$select to_jsonb(t) from used_before t order by t.id$$,'all Used ticket identity/timestamps remain exact');
update public.tickets set status='refunded',refunded_at=now() where order_id=(select order_id from forward_fixture where kind='AttachRace');
update public.orders set status='refunded' where id=(select order_id from forward_fixture where kind='AttachRace');
create temporary table refunded_before as select t.* from public.tickets t join forward_fixture f on f.order_id=t.order_id where f.kind='AttachRace';
select is(pg_temp.forward_apply('AttachRace')->>'order_status','refunded','processed receipt retains later full refund');
select results_eq($$select to_jsonb(t) from public.tickets t join forward_fixture f on f.order_id=t.order_id where f.kind='AttachRace' order by t.id$$,$$select to_jsonb(t) from refunded_before t order by t.id$$,'all refunded ticket bytes remain exact');
select pg_temp.forward_new('CanonicalReview');
select public.server_attach_checkout_session(f.order_id,f.session_id,o.checkout_expires_at) from forward_fixture f join public.orders o on o.id=f.order_id where f.kind='CanonicalReview';
update public.orders set status='requires_review' where id=(select order_id from forward_fixture where kind='CanonicalReview');
select is(pg_temp.forward_apply('CanonicalReview')->>'disposition','review','current attached canonical review is never labelled replay or fulfilled');
select pg_temp.forward_new('CanonicalHistory');
select is(pg_temp.forward_apply('CanonicalHistory')->>'disposition','fulfilled','history review fixture starts with original paid units');
update public.tickets set status='cancelled',cancelled_at=now() where order_id=(select order_id from forward_fixture where kind='CanonicalHistory');
update public.orders set status='requires_review' where id=(select order_id from forward_fixture where kind='CanonicalHistory');
update forward_fixture set stripe_event_id='evt_ForwardCanonicalHistoryReview' where kind='CanonicalHistory';
insert into public.stripe_webhook_events(stripe_event_id,event_type,livemode,stripe_object_id,api_version,stripe_created_at,payload_sha256)
select stripe_event_id,'checkout.session.completed',false,session_id,'2026-07-29.dahlia',now(),repeat('6',64) from forward_fixture where kind='CanonicalHistory';
create temporary table canonical_history_before as select t.* from public.tickets t join forward_fixture f on f.order_id=t.order_id where f.kind='CanonicalHistory';
select is(pg_temp.forward_apply('CanonicalHistory')->>'disposition','review','attached review retains a full original ticket history as review');
select results_eq($$select to_jsonb(t) from public.tickets t join forward_fixture f on f.order_id=t.order_id where f.kind='CanonicalHistory' order by t.id$$,$$select to_jsonb(t) from canonical_history_before t order by t.id$$,'canonical review preserves all cancelled ticket bytes');
select * from finish();
rollback;
