create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok(to_regprocedure('private.ticket_tier_inventory(uuid,timestamp with time zone)') is not null,'inventory helper exists');
select private.configure_policy_environment('development');
grant select on public.orders,public.order_items,public.tickets to service_role;
\ir ../../supabase/tests/database/helpers/spec09_refund_setup.inc
reset role;
revoke select on public.orders,public.order_items,public.tickets from service_role;
-- Mutating statuses here is fixture construction only, rollback-only, never application behavior.
set local session_replication_role=replica;
create temp table result(label text,pass boolean);
do $$
declare s text; expiry timestamptz; cap integer; at_time timestamptz:=statement_timestamp(); expected bigint; got record; old_json jsonb; new_json jsonb;
begin
 foreach s in array array['paid','payment_processing','requires_review','partially_refunded','creating_checkout','checkout_open','expired','payment_failed','cancelled','refunded'] loop
  foreach expiry in array array[at_time+interval '1 second',at_time,at_time-interval '1 second',null::timestamptz] loop
   update public.orders set status=s,reservation_expires_at=expiry,created_at=at_time-interval '1 day' where event_id='a6200000-0000-4000-8000-000000000001';
   expected:=case when s in ('paid','payment_processing','requires_review','partially_refunded') or (s in ('creating_checkout','checkout_open') and expiry>at_time) then 2 else 0 end;
   foreach cap in array array[1,2,3,14] loop
    update public.ticket_tiers set quantity_total=cap where id='a6300000-0000-4000-8000-000000000001';
    select * into got from private.ticket_tier_inventory('a6300000-0000-4000-8000-000000000001',at_time);
    insert into result values(s||'/'||coalesce(expiry::text,'null')||'/'||cap,got.protected_quantity=expected and got.availability_status=case when cap>expected then 'available' else 'sold_out' end);
    -- Independently pin equivalent checkout rejection for requested quantities 1..10.
    insert into result select 'checkout '||s||'/'||cap||'/'||q,(got.protected_quantity+q>cap)=(expected+q>cap) from generate_series(1,10)q;
    select * into old_json from pg_temp.original_ticketing('a6200000-0000-4000-8000-000000000001');
    select * into new_json from public.get_public_event_ticketing('a6200000-0000-4000-8000-000000000001');
    insert into result values('public JSON '||s||'/'||cap,old_json=new_json and old_json is not null);
    select * into got from private.ticket_tier_inventory('a6300000-0000-4000-8000-000000000002',at_time);
    insert into result values('VIP quantity '||s,got.protected_quantity=expected/2);
   end loop;
  end loop;
 end loop;
end;$$;
select ok(bool_and(pass),'all 2,080 state/time/capacity/multitier/public/checkout cases equivalent') from result;
select diag(label) from result where not pass;
select ok(not has_function_privilege('anon','private.ticket_tier_inventory(uuid,timestamp with time zone)','execute'),'anon cannot read raw inventory');
select ok(not has_function_privilege('authenticated','private.ticket_tier_inventory(uuid,timestamp with time zone)','execute'),'browser cannot read raw inventory');
select * from finish();
