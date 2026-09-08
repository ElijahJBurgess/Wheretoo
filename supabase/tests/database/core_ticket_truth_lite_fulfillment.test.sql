begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/core_ticket_truth_lite_setup.inc

reset role;
create function pg_temp.snapshot_after_tier_rename() returns text language plpgsql as $$
declare v_label text;
begin
  update public.ticket_tiers set name='Renamed Current Tier' where id='a6300000-0000-4000-8000-000000000001';
  select snapshot.order_items->0->>'tier_name' into v_label
  from public.server_get_checkout_integrity_order_snapshot((select id from fulfillment_orders where kind='clean'),'cs_test_integrityclean') snapshot;
  raise exception using errcode='PT001';
exception when sqlstate 'PT001' then return v_label;
end;
$$;
select is(pg_temp.snapshot_after_tier_rename(),'General Admission','snapshot label comes from purchased order_items after mutable tier rename');
set local role service_role;
select results_eq($$ select value->>'order_status', (value->>'ticket_count')::bigint from (
select pg_temp.record_and_fulfill('liteclean','liteclean',id,session_id) value from fulfillment_orders where kind='clean') q $$,
$$ values ('paid'::text,3::bigint) $$,'two GA plus one VIP issue exactly three paid tickets');
select results_eq($$ select admission_label, count(*), count(distinct credential_hash), bool_and(octet_length(credential_hash)=32)
from public.tickets where order_id=(select id from fulfillment_orders where kind='clean') group by admission_label order by admission_label $$,
$$ values ('General Admission'::text,2::bigint,2::bigint,true),('VIP'::text,1::bigint,1::bigint,true) $$,'ticket labels and unique hashes match each purchased unit');
create temp table original_tickets as select * from public.tickets where order_id=(select id from fulfillment_orders where kind='clean');
select is(pg_temp.record_and_fulfill('literetry','liteclean',(select id from fulfillment_orders where kind='clean'),'cs_test_integrityclean')->>'order_status','paid','duplicate fulfillment stays paid');
select results_eq($$ select id, issued_at, credential_hash from public.tickets where order_id=(select id from fulfillment_orders where kind='clean') order by id $$,
$$ select id, issued_at, credential_hash from original_tickets order by id $$,'retry preserves every identity and hash');
update public.tickets set status='used', used_at=statement_timestamp() where id=(select id from original_tickets order by id limit 1);
create temp table used_identity as select id,used_at from public.tickets where status='used';
select is(pg_temp.record_and_fulfill('liteused','liteclean',(select id from fulfillment_orders where kind='clean'),'cs_test_integrityclean')->>'order_status','paid','paid retry after check-in remains paid');
select results_eq($$ select status,count(*) from public.tickets where order_id=(select id from fulfillment_orders where kind='clean') group by status order by status $$,
$$ values ('used'::text,1::bigint),('valid'::text,2::bigint) $$,'used plus valid admission set survives duplicate paid webhook');
select results_eq($$ select id,used_at from public.tickets where status='used' $$,$$ select id,used_at from used_identity $$,'retry retains original use timestamp');

-- Every malformed entry fails before any paid/ticket/receipt mutation.
create function pg_temp.reject_manifest(p_manifest jsonb) returns text language plpgsql as $$
begin
  perform pg_temp.record_and_fulfill('liteinvalid','liteinvalid',(select id from fulfillment_orders where kind='atomic'),'cs_test_integrityatomic',p_manifest);
  return 'ACCEPTED';
exception when others then return sqlerrm;
end;
$$;
select is(pg_temp.reject_manifest(null),'TICKET_MANIFEST_INVALID','null manifest rejected');
select is(pg_temp.reject_manifest('{}'::jsonb),'TICKET_MANIFEST_INVALID','non-array manifest rejected');
select is(pg_temp.reject_manifest('[]'::jsonb),'TICKET_MANIFEST_INVALID','missing units rejected');
select is(pg_temp.reject_manifest(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')) || '[{}]'::jsonb),'TICKET_MANIFEST_INVALID','extra entry rejected');
select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{1}',pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic'))->0)),'TICKET_MANIFEST_INVALID','duplicate source rejected');
select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{0,admission_label}','"Wrong"')),'TICKET_MANIFEST_INVALID','snapshot label mismatch rejected');
select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{0,unit_sequence}','"1"')),'TICKET_MANIFEST_INVALID','string sequence rejected');
select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{0,credential_hash}','"AB"')),'TICKET_MANIFEST_INVALID','malformed hash rejected');
select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{0,extra}','true')),'TICKET_MANIFEST_INVALID','unexpected key rejected');
select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{0,credential_hash}',pg_temp.ticket_manifest((select id from fulfillment_orders where kind='clean'))->0->'credential_hash')),'TICKET_MANIFEST_INVALID','cross-order hash collision rejected');
select results_eq($$ select status,paid_at,(select count(*) from public.tickets where order_id=o.id) from public.orders o where id=(select id from fulfillment_orders where kind='atomic') $$,
$$ values ('checkout_open'::text,null::timestamptz,0::bigint) $$,'invalid manifests leave no partial paid state or tickets');


select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{0,order_item_id}','"ffffffff-ffff-4fff-8fff-ffffffffffff"')),'TICKET_MANIFEST_INVALID','unknown order item rejected');
select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{0,unit_sequence}','3')),'TICKET_MANIFEST_INVALID','out-of-range source unit rejected');
select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{0,unit_sequence}','1.0')),'TICKET_MANIFEST_INVALID','noncanonical decimal sequence rejected');
select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{0,admission_label}','12')),'TICKET_MANIFEST_INVALID','non-string label rejected');
select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{0,credential_hash}',to_jsonb(repeat('A',64)))),'TICKET_MANIFEST_INVALID','uppercase 64-hex rejected');
select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{1,credential_hash}',pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic'))->0->'credential_hash')),'TICKET_MANIFEST_INVALID','duplicate manifest hashes rejected');
select is(pg_temp.reject_manifest(jsonb_set(pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')),'{0}','null')),'TICKET_MANIFEST_INVALID','null manifest entry rejected');
select is(pg_temp.reject_manifest((pg_temp.ticket_manifest((select id from fulfillment_orders where kind='atomic')) #- '{0,credential_hash}')),'TICKET_MANIFEST_INVALID','missing required key rejected');
select is((select count(*) from public.stripe_webhook_events where stripe_event_id='evt_liteinvalid'),0::bigint,'invalid manifest rolls back its receipt creation');

reset role;
-- Elevated corruption probes roll their complete mutations back after observing review.
create function pg_temp.probe_ticket_corruption(p_assignment text) returns text language plpgsql as $$
declare v_result text;
begin
  alter table public.tickets disable trigger tickets_identity_and_transition;
  execute format('update public.tickets set %s where id=(select id from public.tickets where status=''valid'' and order_id=(select id from fulfillment_orders where kind=''clean'') order by id limit 1)',p_assignment);
  alter table public.tickets enable trigger tickets_identity_and_transition;
  v_result := pg_temp.record_and_fulfill('litecorrupt','liteclean',(select id from fulfillment_orders where kind='clean'),'cs_test_integrityclean')->>'order_status';
  if (select count(*) from public.tickets where order_id=(select id from fulfillment_orders where kind='clean')) <> 3
     or exists(select 1 from used_identity u left join public.tickets t on t.id=u.id where t.status is distinct from 'used' or t.used_at is distinct from u.used_at) then
    v_result := 'HISTORY_CHANGED';
  end if;
  raise exception using errcode='PT001';
exception when sqlstate 'PT001' then return v_result;
end;
$$;
select is(pg_temp.probe_ticket_corruption($$admission_label='Wrong Label'$$),'requires_review','persisted label mismatch reviews without repair or loss of used history');
select is(pg_temp.probe_ticket_corruption($$credential_hash=extensions.digest('wrong-persisted-hash','sha256')$$),'requires_review','persisted hash mismatch reviews without repair or loss of used history');
select is(pg_temp.probe_ticket_corruption($$status='cancelled',cancelled_at=statement_timestamp()$$),'requires_review','unexplained cancelled ticket under published paid order reviews');
select is(pg_temp.probe_ticket_corruption($$status='refunded',refunded_at=statement_timestamp()$$),'requires_review','unexplained refunded ticket under published paid order reviews');

select set_config('request.jwt.claim.sub','a6100000-0000-4000-8000-000000000001',true);
update public.events set status='cancelled' where id='a6200000-0000-4000-8000-000000000001';
-- Task 5 owns the cancellation API. Arrange its stipulated coherent state here.
update public.tickets set status='cancelled',cancelled_at=statement_timestamp()
where order_id=(select id from fulfillment_orders where kind='clean') and status='valid';
reset role;
set local role service_role;
select is(pg_temp.record_and_fulfill('litecancelled','liteclean',(select id from fulfillment_orders where kind='clean'),'cs_test_integrityclean')->>'order_status','paid','coherent owning-event cancellation preserves paid duplicate reconciliation');
select results_eq($$ select status,count(*) from public.tickets where order_id=(select id from fulfillment_orders where kind='clean') group by status order by status $$,
$$ values ('cancelled'::text,2::bigint),('used'::text,1::bigint) $$,'event cancellation and paid retry preserve used history');
select results_eq($$ select id,used_at from public.tickets where status='used' $$,$$ select id,used_at from used_identity $$,'cancellation never erases original use time');
reset role;
select * from finish();
rollback;
