begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select private.configure_policy_environment('development');
grant select on public.orders,public.order_items,public.tickets to service_role;
\ir ../../supabase/tests/database/helpers/spec09_refund_setup.inc
reset role;
revoke select on public.orders,public.order_items,public.tickets from service_role;
select public.server_configure_waitlist('{"acceptingJoins":true,"observerEnabled":true,"deliveryEnabled":true,"senderEmail":"notify@example.invalid","replyTo":"support@example.invalid","appOrigin":"https://example.invalid","capacityMinute":10000,"capacityDay":10000,"capacityMonth":10000}');
select public.server_acknowledge_waitlist_worker();
update public.ticket_tiers set quantity_total=2 where id='a6300000-0000-4000-8000-000000000001';

select public.server_join_waitlist('a6200000-0000-4000-8000-000000000001','a6300000-0000-4000-8000-000000000001','Budget Buyer','budget@example.invalid',gen_random_uuid(),repeat('b',64));
create temp table member as select id from private.waitlist_enrollments where normalized_email='budget@example.invalid';
update public.ticket_tiers set quantity_total=3 where id='a6300000-0000-4000-8000-000000000001';
-- Three previous possible dispatches (including Unknown) consume the rolling budget.
insert into private.waitlist_availability_cycles(tier_id,sequence,opened_at,completed_at) select 'a6300000-0000-4000-8000-000000000001',n,clock_timestamp()-interval '1 hour',clock_timestamp() from generate_series(1,4)n;
update private.waitlist_tier_state set cycle=4,observed_state='available' where tier_id='a6300000-0000-4000-8000-000000000001';
insert into private.waitlist_deliveries(enrollment_id,purpose,cycle_id,state,first_possible_dispatch_at,dispatch_count) select (select id from member),'restock',id,'unknown',clock_timestamp()-interval '1 hour',1 from private.waitlist_availability_cycles where tier_id='a6300000-0000-4000-8000-000000000001' and sequence<4;
insert into private.waitlist_deliveries(enrollment_id,purpose,cycle_id,lease_id,lease_until) select (select id from member),'restock',id,'a6400000-0000-4000-8000-000000000099',clock_timestamp()+interval '2 minutes' from private.waitlist_availability_cycles where tier_id='a6300000-0000-4000-8000-000000000001' and sequence=4;
create temp table latest as select d.id from private.waitlist_deliveries d join private.waitlist_availability_cycles c on c.id=d.cycle_id where enrollment_id=(select id from member) and c.sequence=4;
select is(private.waitlist_delivery_reason((select id from latest)),'restock_limit','three unknown outcomes count toward daily cap');
select ok(public.server_prepare_waitlist_delivery((select id from latest),'a6400000-0000-4000-8000-000000000099') is null,'fourth cycle suppressed before payload preparation');
select is((select state from private.waitlist_deliveries where id=(select id from latest)),'suppressed','skipped cycle cannot burst later');
select ok(not has_table_privilege('anon','private.waitlist_enrollments','select'),'anon cannot read private PII');
select ok(not has_table_privilege('authenticated','private.waitlist_enrollments','select'),'authenticated cannot read private PII');
select ok(not has_function_privilege('authenticated','public.server_join_waitlist(uuid,uuid,text,text,uuid,text)','execute'),'browser cannot forge trusted IP via RPC');
select ok(not has_function_privilege('anon','public.server_begin_waitlist_dispatch(uuid,uuid)','execute'),'browser cannot dispatch email');
select is((select count(*) from private.waitlist_rate_events where lane='dispatch' and identity_hash=(select id::text from latest)),0::bigint,'blocked cycle never consumes provider capacity');
select * from finish();rollback;
