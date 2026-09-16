begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/spec09_refund_setup.inc
select pg_temp.record_and_fulfill('spec10collection','spec10collection',id,session_id) from fulfillment_orders;
reset role;
create function pg_temp.collection() returns jsonb language sql as $$select to_jsonb(p) from public.server_lookup_paid_ticket_collection(repeat('1',64)) p$$;
select * from public.server_redeem_paid_ticket('a6100000-0000-4000-8000-000000000001','a6200000-0000-4000-8000-000000000001',(select credential_hash from public.tickets order by id limit 1));
select is(pg_temp.collection()->>'event_facts_available','true','old paid bearer now reads proven event facts');
select is((select count(*) from jsonb_array_elements(pg_temp.collection()->'tickets') t where t->>'status'='used' and t->>'used_at' is not null),1::bigint,'paid projection retains check-in timestamp');
select public.save_owned_event_revision('a6200000-0000-4000-8000-000000000001',(private.event_change_facts('a6200000-0000-4000-8000-000000000001')-'disclosures')||'{"venue_name":"Unapproved private venue"}');
select is(pg_temp.collection()->>'event_venue_name','Integrity Hall','private buyer never receives unpublished mutable venue');
select public.cancel_owned_event('a6200000-0000-4000-8000-000000000001');
select is(pg_temp.collection()->>'event_status','cancelled','event cancelled independently of used ticket history');
select is(pg_temp.collection()->>'event_venue_name','Integrity Hall','cancelled original bearer retains last approved venue');
select is((select count(*) from jsonb_array_elements(pg_temp.collection()->'tickets') t where t->>'status'='used'),1::bigint,'Used remains Used after cancellation');
select * from finish();rollback;
