begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
select has_column('public', 'tickets', 'admission_label', 'tickets persist the immutable admission label');
select has_column('public', 'tickets', 'credential_hash', 'tickets persist only a credential hash');
select has_column('public', 'tickets', 'used_at', 'tickets preserve admission use time');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and p.proname in ('server_fulfill_paid_order','fulfill_paid_order') and p.pronargs = 16), 0::bigint, 'no manifest-free fulfillment overload remains');
\ir helpers/core_ticket_truth_lite_setup.inc

select pg_temp.record_and_fulfill('liteschema','liteschema',id,session_id) from fulfillment_orders where kind='clean';
reset role;
create temporary table schema_ticket as select * from public.tickets where order_id=(select id from fulfillment_orders where kind='clean') order by id limit 1;

-- Each probe performs real DML then rolls back its subtransaction, including successful probes.
create function pg_temp.probe_insert(p_status text, p_used timestamptz, p_refunded timestamptz, p_cancelled timestamptz,
  p_hash bytea default extensions.digest('schema-probe','sha256'), p_label text default 'Admission')
returns text language plpgsql as $$
begin
  insert into public.tickets(order_id,order_item_id,event_id,organizer_id,ticket_tier_id,unit_sequence,status,used_at,refunded_at,cancelled_at,credential_hash,admission_label)
  select order_id,order_item_id,event_id,organizer_id,ticket_tier_id,9,p_status,p_used,p_refunded,p_cancelled,p_hash,p_label from schema_ticket;
  raise exception using errcode='PT001';
exception when sqlstate 'PT001' then return 'OK'; when others then return sqlstate;
end;
$$;
create function pg_temp.probe_update(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  raise exception using errcode='PT001';
exception when sqlstate 'PT001' then return 'OK'; when others then return sqlerrm;
end;
$$;

select col_not_null('public','tickets','admission_label','admission label is required');
select col_not_null('public','tickets','credential_hash','hash is required');
select col_type_is('public','tickets','credential_hash','bytea','hash is binary');
select col_type_is('public','tickets','used_at','timestamp with time zone','use time is timezone-aware');
select is(pg_temp.probe_insert('valid',null,null,null),'OK','valid admission has no lifecycle timestamp');
select is(pg_temp.probe_insert('used',now(),null,null),'OK','used admission has only used_at');
select is(pg_temp.probe_insert('refunded',null,now(),null),'OK','refunded admission has only refunded_at');
select is(pg_temp.probe_insert('cancelled',null,null,now()),'OK','cancelled admission has only cancelled_at');
select is(pg_temp.probe_insert('unknown',null,null,null),'23514','unknown ticket status rejected');
select is(pg_temp.probe_insert('valid',now(),null,null),'23514','valid cannot already be used');
select is(pg_temp.probe_insert('valid',null,now(),null),'23514','valid cannot already be refunded');
select is(pg_temp.probe_insert('valid',null,null,now()),'23514','valid cannot already be cancelled');
select is(pg_temp.probe_insert('used',null,null,null),'23514','used requires used_at');
select is(pg_temp.probe_insert('used',now(),now(),null),'23514','used forbids refund timestamp');
select is(pg_temp.probe_insert('used',now(),null,now()),'23514','used forbids cancellation timestamp');
select is(pg_temp.probe_insert('refunded',null,null,null),'23514','refunded requires refunded_at');
select is(pg_temp.probe_insert('refunded',now(),now(),null),'23514','refunded forbids use timestamp');
select is(pg_temp.probe_insert('refunded',null,now(),now()),'23514','refunded forbids cancellation timestamp');
select is(pg_temp.probe_insert('cancelled',null,null,null),'23514','cancelled requires cancelled_at');
select is(pg_temp.probe_insert('cancelled',now(),null,now()),'23514','cancelled forbids use timestamp');
select is(pg_temp.probe_insert('cancelled',null,now(),now()),'23514','cancelled forbids refund timestamp');
select is(pg_temp.probe_insert('valid',null,null,null,null),'23502','null hash rejected');
select is(pg_temp.probe_insert('valid',null,null,null,decode(repeat('11',31),'hex')),'23514','31-byte hash rejected');
select is(pg_temp.probe_insert('valid',null,null,null,decode(repeat('11',33),'hex')),'23514','33-byte hash rejected');
select is(pg_temp.probe_insert('valid',null,null,null,(select credential_hash from schema_ticket)),'23505','duplicate hash rejected');
select is(pg_temp.probe_insert('valid',null,null,null,extensions.digest('probe','sha256'),null),'23502','null label rejected');
select is(pg_temp.probe_insert('valid',null,null,null,extensions.digest('probe','sha256'),''),'23514','empty label rejected');
select is(pg_temp.probe_insert('valid',null,null,null,extensions.digest('probe','sha256'),' Admission '),'23514','untrimmed label rejected');
select is(pg_temp.probe_insert('valid',null,null,null,extensions.digest('probe','sha256'),repeat('x',81)),'23514','oversize label rejected');
select is(pg_temp.probe_insert('valid',null,null,null,extensions.digest('probe','sha256'),repeat('x',80)),'OK','80-character label accepted');

select is(pg_temp.probe_update(format('update public.tickets set %s where id=(select id from schema_ticket)', assignment)),
'TICKET_IDENTITY_IMMUTABLE','immutable ticket field: ' || field)
from (values
('id','id=gen_random_uuid()'),('order_id','order_id=gen_random_uuid()'),
('order_item_id','order_item_id=gen_random_uuid()'),('event_id','event_id=gen_random_uuid()'),
('organizer_id','organizer_id=gen_random_uuid()'),('ticket_tier_id','ticket_tier_id=gen_random_uuid()'),
('unit_sequence','unit_sequence=8'),('issued_at', $$issued_at=issued_at+interval '1 second'$$),
('admission_label',$$admission_label='Changed'$$),
('credential_hash',$$credential_hash=extensions.digest('changed','sha256')$$)) changes(field,assignment);

select is(pg_temp.probe_update($$update public.tickets set status='used',used_at=statement_timestamp() where id=(select id from schema_ticket)$$),'OK','valid to used allowed');
select is(pg_temp.probe_update($$update public.tickets set status='refunded',refunded_at=statement_timestamp() where id=(select id from schema_ticket)$$),'OK','valid to refunded allowed');
select is(pg_temp.probe_update($$update public.tickets set status='cancelled',cancelled_at=statement_timestamp() where id=(select id from schema_ticket);
update public.tickets set status='valid',cancelled_at=null where id=(select id from schema_ticket)$$),'TICKET_TRANSITION_INVALID','cancelled cannot return to valid');
select is(pg_temp.probe_update($$update public.tickets set status='refunded',refunded_at=statement_timestamp() where id=(select id from schema_ticket);
update public.tickets set status='cancelled',refunded_at=null,cancelled_at=statement_timestamp() where id=(select id from schema_ticket)$$),'TICKET_TRANSITION_INVALID','refunded cannot return to cancelled');
select is(pg_temp.probe_update($$update public.tickets set status='cancelled',cancelled_at=statement_timestamp() where id=(select id from schema_ticket);
update public.tickets set status='refunded',cancelled_at=null,refunded_at=statement_timestamp() where id=(select id from schema_ticket)$$),'OK','cancelled to refunded recovery allowed');

update public.tickets set status='used',used_at=statement_timestamp() where id=(select id from schema_ticket);
create temporary table original_used as select id,used_at from public.tickets where id=(select id from schema_ticket);
select is(pg_temp.probe_update(format('update public.tickets set status=%L,used_at=null,refunded_at=%s,cancelled_at=%s where id=(select id from schema_ticket)',
  target,case when target='refunded' then 'now()' else 'null' end,case when target='cancelled' then 'now()' else 'null' end)),
'TICKET_TRANSITION_INVALID','used is terminal: '||target) from (values ('valid'),('refunded'),('cancelled')) states(target);
select is(pg_temp.probe_update($$update public.tickets set used_at=used_at+interval '1 second' where id=(select id from schema_ticket)$$),'TICKET_TRANSITION_INVALID','original used_at is immutable');
select lives_ok($$update public.tickets set status=status where id=(select id from schema_ticket)$$,'used no-op is allowed');
select results_eq($$select id,used_at from public.tickets where id=(select id from schema_ticket)$$,$$select id,used_at from original_used$$,'used history is retained');

select ok((select relrowsecurity from pg_class where oid='public.tickets'::regclass),'ticket RLS stays enabled');
select is(has_table_privilege('anon','public.tickets','SELECT'),false,'anonymous has no ticket reads');
select is(has_table_privilege('authenticated','public.tickets','SELECT'),false,'authenticated has no direct ticket reads');
select is(has_table_privilege('authenticated','public.tickets','UPDATE'),false,'authenticated cannot redeem by direct update');
select is(has_table_privilege('service_role','public.tickets','SELECT'),true,'service role retains ticket reads');
select is((select count(*) from pg_tables where schemaname in ('public','private') and tablename ~ '(admission|redemption|collection|keyring)'),0::bigint,'no admission collection redemption ledger or keyring added');
select is((select count(*) from pg_trigger where tgrelid='public.tickets'::regclass and not tgisinternal and tgtype::int & 8 = 8 and tgname <> 'tickets_free_source_identity'),0::bigint,'no additional delete guard changes paid cleanup');
with removed as (delete from public.tickets where id=(select id from schema_ticket) returning id) select is(count(*),1::bigint,'paid ticket cleanup remains allowed with free-source protection') from removed;
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname in ('server_fulfill_paid_order','fulfill_paid_order') and p.pronargs=17 and p.pronargdefaults=0),2::bigint,'only required seventeen-argument wrappers exist');
select is(has_function_privilege('anon','public.server_fulfill_paid_order(text,uuid,text,text,text,text,text,text,text,text,text,text,bigint,bigint,bigint,text,jsonb)','EXECUTE'),false,'anonymous cannot fulfill');
select is(has_function_privilege('authenticated','public.server_fulfill_paid_order(text,uuid,text,text,text,text,text,text,text,text,text,text,bigint,bigint,bigint,text,jsonb)','EXECUTE'),false,'authenticated cannot fulfill');
select is(has_function_privilege('service_role','public.server_fulfill_paid_order(text,uuid,text,text,text,text,text,text,text,text,text,text,bigint,bigint,bigint,text,jsonb)','EXECUTE'),true,'service wrapper can fulfill');
select is(has_function_privilege('service_role','private.fulfill_paid_order(text,uuid,text,text,text,text,text,text,text,text,text,text,bigint,bigint,bigint,text,jsonb)','EXECUTE'),false,'private fulfillment cannot be called directly');

select * from finish();
rollback;
