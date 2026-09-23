begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_function('public','get_organizer_event_export',array['uuid','text'],'event export has one narrow authenticated contract');
select ok(not has_function_privilege('anon','public.get_organizer_event_export(uuid,text)','execute'),'anonymous cannot call export');
select ok(not has_function_privilege('service_role','public.get_organizer_event_export(uuid,text)','execute'),'no service-role bypass');
select ok(has_function_privilege('authenticated','public.get_organizer_event_export(uuid,text)','execute'),'authenticated may invoke owner-checked RPC');
select ok((select prosecdef and provolatile='s' and proconfig=array['search_path=""'] from pg_proc where oid='public.get_organizer_event_export(uuid,text)'::regprocedure),'stable definer with empty search path');
\ir helpers/core_ticket_truth_lite_setup.inc
select pg_temp.record_and_fulfill('csvpaid','csvpaid',id,session_id) from fulfillment_orders where kind='clean';
reset role;
-- Synthetic historical read states; writers remain covered by their regression suites.
set local session_replication_role=replica;
update public.orders o set status=v.status from fulfillment_orders f join (values
 ('partial','payment_failed'),('extra','expired'),('refs','payment_processing'),('aggregate','cancelled'),('atomic','creating_checkout')) v(kind,status) on v.kind=f.kind where o.id=f.id;
set local session_replication_role=origin;
create function pg_temp.export(kind text) returns jsonb language sql as $$select public.get_organizer_event_export('a6200000-0000-4000-8000-000000000001',kind)$$;
grant select on fulfillment_orders to authenticated;
set local role authenticated;
select is((pg_temp.export('orders')->>'rowCount')::int,7,'all statuses, beyond issued-only orders');
select is((select count(distinct r->>'status') from jsonb_array_elements(pg_temp.export('orders')->'rows') r),7::bigint,'all seven seeded canonical statuses exported');
select is((pg_temp.export('admissions')->>'rowCount')::int,3,'three actual issued admissions');
select is(pg_temp.export('orders')->>'schemaVersion','1','versioned response');
select ok(not pg_temp.export('orders')::text ~ 'credential|confirmation|stripe_|access_hash|idempotency|SENTINEL','no private keys or source material');
select is((select count(*) from jsonb_array_elements(pg_temp.export('orders')->'rows') r where r->>'paidAt' is null),6::bigint,'no invented purchase date');
select is((select count(*) from jsonb_array_elements(pg_temp.export('orders')->'rows') r where jsonb_array_length(r->'items')=2),7::bigint,'all multi-tier orders remain one row');
select is((select sum((r->>'ticketPosition')::int) from jsonb_array_elements(pg_temp.export('admissions')->'rows') r),6::bigint,'positions span the whole purchased order');
select throws_ok($$select pg_temp.export('registrations')$$,'42501','Event unavailable','paid-free mismatch');
select throws_ok($$select pg_temp.export('bogus')$$,'22023','Invalid export kind','unknown kind denied');
select set_config('request.jwt.claim.sub','a6100000-0000-4000-8000-000000000002',true);
select throws_ok($$select pg_temp.export('orders')$$,'42501','Event unavailable','unrelated organizer denied');
select set_config('request.jwt.claim.sub','a6100000-0000-4000-8000-000000000099',true);
select throws_ok($$select pg_temp.export('orders')$$,'42501','Event unavailable','non-organizer denied');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select pg_temp.export('orders')$$,'42501','Event unavailable','absent identity denied even under authenticated SQL role');
reset role;
select set_config('request.jwt.claim.sub','a6100000-0000-4000-8000-000000000001',true);
set local session_replication_role=replica;
update public.orders set status='requires_review',reconciliation_status='requires_review',failure_code='PAYMENT_AFTER_INVALIDATION',paid_at=now() where id=(select id from fulfillment_orders where kind='snapshot');
set local session_replication_role=origin;
select is((select count(*) from jsonb_array_elements(pg_temp.export('orders')->'rows') r where r->>'status'='requires_review' and r->>'paidAt' is not null),1::bigint,'payment after invalidation remains a paid review source with no invented tickets');
select is(pg_temp.export('admissions')->>'rowCount','3','review exception creates no admissions');
\ir free_registration_fixture.inc
select pg_temp.register(n,1,2,'CSV Guest '||n,'guest'||n||'@example.invalid') from generate_series(1,55) n;
select pg_temp.register(56,3,2,'Group Guest','group@example.invalid');
select is(pg_temp.register(57,4,1)->>'kind','rejected','real capacity rejection creates a receipt only');
select is(public.get_organizer_event_export('b6200000-0000-4000-8000-000000000001','registrations')->>'rowCount','0','rejected request never becomes an exported registration');
select ok(not exists(select 1 from public.free_registrations r where position(r.access_hash in public.get_organizer_event_export(r.event_id,'registrations')::text)>0),'free access-hash sentinels never occur in export');
set constraints all immediate;
set constraints all deferred;
set local role authenticated;
select is((public.get_organizer_event_export('b6200000-0000-4000-8000-000000000002','registrations')->>'rowCount')::int,58,'55 registrations plus a 3-person group export all admissions');
select is((select count(distinct r->>'registrationReference') from jsonb_array_elements(public.get_organizer_event_export('b6200000-0000-4000-8000-000000000002','registrations')->'rows') r),56::bigint,'registration grouping is complete');
select is((public.get_organizer_free_admissions('b6200000-0000-4000-8000-000000000002')->'admissions')::text,'[]','existing blank guest search remains unchanged');
select throws_ok($$select public.get_organizer_event_export('b6200000-0000-4000-8000-000000000002','orders')$$,'42501','Event unavailable','free-paid mismatch denied');
select ok(not has_table_privilege('authenticated','public.free_registrations','select'),'free table still private');
reset role;
-- Real admission and cancellation writers prove that exports preserve their history.
select set_config('request.jwt.claim.sub','b6100000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.redeem_owned_ticket('b6200000-0000-4000-8000-000000000002',(select (public.get_organizer_free_registration_detail('b6200000-0000-4000-8000-000000000002',r))->'tickets'->0->>'ticketId')::uuid)
from (select (public.get_organizer_free_admissions('b6200000-0000-4000-8000-000000000002','Group Guest')->'admissions'->0->>'registrationId')::uuid r) s;
select public.cancel_owned_event('b6200000-0000-4000-8000-000000000002');
select is((select count(*) from jsonb_array_elements(public.get_organizer_event_export('b6200000-0000-4000-8000-000000000002','registrations')->'rows') r where r->>'admissionStatus'='used' and r->>'usedAt' is not null),1::bigint,'used history survives cancellation');
select is((select count(*) from jsonb_array_elements(public.get_organizer_event_export('b6200000-0000-4000-8000-000000000002','registrations')->'rows') r where r->>'registrationStatus'='cancelled'),58::bigint,'cancelled history remains exportable');
reset role;
select * from finish();
rollback;
