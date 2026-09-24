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
select is(public.server_join_waitlist('a6200000-0000-4000-8000-000000000001','a6300000-0000-4000-8000-000000000001','Buyer','synthetic-buyer@example.invalid',gen_random_uuid(),repeat('c',64))->>'kind','joined','buyer joins without account');
select private.waitlist_reconcile(id) from private.waitlist_enrollments where normalized_email='synthetic-buyer@example.invalid';
select is((select lifecycle from private.waitlist_enrollments where normalized_email='synthetic-buyer@example.invalid'),'active','real checkout_open reservation is not a purchase');
select pg_temp.record_and_fulfill('waitlistpurchase','waitlistpurchase',id,session_id) from fulfillment_orders where kind='clean';
select ok((select private.organizer_order_coherent(id) from fulfillment_orders where kind='clean'),'real fulfilled multi-tier purchase coherent');
select private.waitlist_reconcile(id) from private.waitlist_enrollments where normalized_email='synthetic-buyer@example.invalid';
select is((select lifecycle from private.waitlist_enrollments where normalized_email='synthetic-buyer@example.invalid'),'purchased','later authoritative fulfillment stops enrollment');
select is(public.server_join_waitlist('a6200000-0000-4000-8000-000000000001','a6300000-0000-4000-8000-000000000001','Buyer','synthetic-buyer@example.invalid',gen_random_uuid(),repeat('c',64))->>'kind','joined','explicit rejoin after purchase creates new lifecycle');
select is((select count(*) from private.waitlist_enrollments where normalized_email='synthetic-buyer@example.invalid'),2::bigint,'new enrollment UUID rather than resurrection');
select private.waitlist_reconcile(id) from private.waitlist_enrollments where normalized_email='synthetic-buyer@example.invalid';
select is((select count(*) from private.waitlist_enrollments where normalized_email='synthetic-buyer@example.invalid' and lifecycle='active'),1::bigint,'purchase predating new join never closes new lifecycle');
update private.waitlist_enrollments set lifecycle='removed',removed_at=clock_timestamp() where normalized_email='synthetic-buyer@example.invalid' and lifecycle='active';
-- Controlled historical membership fixtures isolate matching semantics against a real fulfilled order.
create function pg_temp.member(p_tier uuid,p_email text,p_join timestamptz) returns uuid language plpgsql as $$declare result uuid;begin
 insert into private.waitlist_enrollments(event_id,tier_id,name,normalized_email,recipient_hash,joined_at) values('a6200000-0000-4000-8000-000000000001',p_tier,'Matrix Buyer',p_email,private.ticket_email_fingerprint(p_email),p_join) returning id into result;return result;end;$$;
create temp table cases(label text,id uuid);
insert into cases values('wrong email',pg_temp.member('a6300000-0000-4000-8000-000000000001','different@example.invalid',clock_timestamp()-interval '1 hour'));
insert into cases values('wrong tier',pg_temp.member('a6300000-0000-4000-8000-000000000004','synthetic-buyer@example.invalid',clock_timestamp()-interval '1 hour'));
insert into cases values('matching',pg_temp.member('a6300000-0000-4000-8000-000000000002','synthetic-buyer@example.invalid',clock_timestamp()-interval '1 hour'));
select private.waitlist_reconcile(id) from cases where label<>'matching';
select is((select lifecycle from private.waitlist_enrollments where id=(select id from cases where label='wrong email')),'active','different email does not qualify');
select is((select lifecycle from private.waitlist_enrollments where id=(select id from cases where label='wrong tier')),'active','different tier does not qualify');
-- Enumerate rejected financial states without changing application writers.
create function pg_temp.financial_matrix() returns integer language plpgsql as $$declare state text;n integer:=0;oid uuid;wid uuid;begin
 select id into oid from fulfillment_orders where kind='clean';select id into wid from cases where label='matching';

 foreach state in array array['creating_checkout','checkout_open','payment_processing','payment_failed','expired','requires_review','partially_refunded'] loop
  update public.orders set status=state where id=oid;
  perform private.waitlist_reconcile(wid);
  if (select lifecycle from private.waitlist_enrollments where id=wid)<>'active' then raise exception 'False purchase %',state;end if;n:=n+1;
 end loop;
 update public.orders set status='paid',reconciliation_status='requires_review' where id=oid;
 perform private.waitlist_reconcile(wid);
 if (select lifecycle from private.waitlist_enrollments where id=wid)<>'active' then raise exception 'Unreconciled purchase';end if;
 update public.orders set reconciliation_status='reconciled' where id=oid;
 return n+1;
end;$$;
set local session_replication_role=replica;
select is(pg_temp.financial_matrix(),8,'financial states excluded observationally');
set local session_replication_role=origin;
-- Ticket usage must not erase an otherwise coherent purchase.
set local session_replication_role=replica;
update public.tickets set status='used',used_at=clock_timestamp() where order_id=(select id from fulfillment_orders where kind='clean');
set local session_replication_role=origin;
select private.waitlist_reconcile(id) from cases where label='matching';
select is((select lifecycle from private.waitlist_enrollments where id=(select id from cases where label='matching')),'purchased','used tickets still qualify as purchase');
set local session_replication_role=replica;
update public.orders set status='refunded',refunded_at=clock_timestamp() where id=(select id from fulfillment_orders where kind='clean');
set local session_replication_role=origin;
select private.waitlist_reconcile(id) from cases;
select is((select lifecycle from private.waitlist_enrollments where id=(select id from cases where label='matching')),'purchased','later refund never resurrects purchased enrollment');
select * from finish();
rollback;
