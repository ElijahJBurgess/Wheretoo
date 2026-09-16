begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir free_registration_fixture.inc
select pg_temp.register(1);
set constraints all immediate;
set constraints all deferred;
create function pg_temp.constraint_probe(p_sql text) returns text language plpgsql as $$
begin
 execute p_sql;
 set constraints all immediate;
 raise exception using errcode='PT001';
exception when sqlstate 'PT001' then return 'OK'; when others then return sqlstate||':'||sqlerrm;
end;
$$;
select is(pg_temp.constraint_probe($$insert into public.tickets(registration_id,event_id,organizer_id,unit_sequence,admission_label,credential_hash) select id,event_id,organizer_id,3,'General Admission',digest('extra','sha256') from public.free_registrations where event_id='b6200000-0000-4000-8000-000000000001' limit 1$$),'P0001:FREE_TICKET_SET_MISMATCH','extra free unit fails deferred exact-set guard');
select is(pg_temp.constraint_probe($$insert into public.free_registration_requests(id,event_id,name,email,quantity,access_hash) values('b6300000-0000-4000-8000-000000000099','b6200000-0000-4000-8000-000000000002','Pat Guest','pat@example.invalid',1,repeat('c',64))$$),'P0001:FREE_RECEIPT_INCOMPLETE','receipt cannot commit without durable outcome');
select is(pg_temp.constraint_probe($$update public.free_registrations set status='cancelled',cancelled_at=now() where event_id='b6200000-0000-4000-8000-000000000001'$$),'P0001:FREE_TICKET_SET_MISMATCH','registration cancellation cannot leave valid tickets');
select matches(pg_temp.constraint_probe($$update public.tickets set status='refunded',refunded_at=now() where registration_id is not null and event_id='b6200000-0000-4000-8000-000000000001'$$),'^23514:','free ticket cannot be refunded');
select matches(pg_temp.constraint_probe($$insert into public.free_registrations(request_id,event_id,organizer_id,name,email,quantity,access_hash)
 select 'b6300000-0000-4000-8000-000000000098',event_id,organizer_id,'Guest','guest@-invalid.example',1,repeat('d',64) from public.free_registrations where event_id='b6200000-0000-4000-8000-000000000001' limit 1$$),'^23514:','table constraint rejects invalid email domain before source linkage');
select throws_ok($$delete from public.free_registrations where event_id='b6200000-0000-4000-8000-000000000001'$$,'P0001','FREE_SOURCE_IMMUTABLE','registration cannot be deleted');
select throws_ok($$delete from public.free_registration_requests where event_id='b6200000-0000-4000-8000-000000000001'$$,'P0001','FREE_SOURCE_IMMUTABLE','receipt cannot be deleted');
select throws_ok($$update public.free_registration_requests set result='{"kind":"rejected","reason":"full"}' where event_id='b6200000-0000-4000-8000-000000000001'$$,'P0001','FREE_SOURCE_IMMUTABLE','committed result immutable');
create function pg_temp.manifest_attempt(p_manifest jsonb) returns jsonb language sql as $$
 select public.server_confirm_free_registration('b6300000-0000-4000-8000-000000000090','b6200000-0000-4000-8000-000000000002',
 'Manifest Guest','manifest@example.invalid',2,repeat('9',64),p_manifest);
$$;
select throws_ok($$select pg_temp.manifest_attempt(jsonb_set(pg_temp.free_manifest(2,'malformed'),'{1,unit_sequence}','1'))$$,'P0001','FREE_MANIFEST_INVALID','duplicate manifest unit rejected');
select throws_ok($$select pg_temp.manifest_attempt(jsonb_set(pg_temp.free_manifest(2,'malformed'),'{1,credential_hash}',pg_temp.free_manifest(2,'malformed')->0->'credential_hash'))$$,'P0001','FREE_MANIFEST_INVALID','duplicate manifest credential rejected');
select throws_ok($$select pg_temp.manifest_attempt(jsonb_set(pg_temp.free_manifest(2,'malformed'),'{1,unit_sequence}','1.5'))$$,'P0001','FREE_MANIFEST_INVALID','fractional manifest unit rejected');
select throws_ok($$select pg_temp.manifest_attempt(jsonb_set(pg_temp.free_manifest(2,'malformed'),'{1,unit_sequence}','3'))$$,'P0001','FREE_MANIFEST_INVALID','manifest sequence beyond quantity rejected');
select throws_ok($$select pg_temp.manifest_attempt(jsonb_set(pg_temp.free_manifest(2,'malformed'),'{1,unit_sequence}','0'))$$,'P0001','FREE_MANIFEST_INVALID','manifest sequence zero rejected');
select throws_ok($$select pg_temp.manifest_attempt(jsonb_set(pg_temp.free_manifest(2,'malformed'),'{0,extra}','true'))$$,'P0001','FREE_MANIFEST_INVALID','unknown manifest entry key rejected');
select throws_ok($$select pg_temp.manifest_attempt(jsonb_set(pg_temp.free_manifest(2,'malformed'),'{0,credential_hash}','"not-a-hash"'))$$,'P0001','FREE_MANIFEST_INVALID','malformed manifest hash rejected');
select throws_ok($$select pg_temp.manifest_attempt(jsonb_set(pg_temp.free_manifest(2,'malformed'),'{0,credential_hash}',to_jsonb(repeat('g',64))))$$,'P0001','FREE_MANIFEST_INVALID','correct-length nonhex manifest hash rejected');
select throws_ok($$select pg_temp.manifest_attempt(pg_temp.free_manifest(1,'malformed'))$$,'P0001','FREE_MANIFEST_INVALID','otherwise valid manifest with wrong length rejected');
select throws_ok($$select pg_temp.manifest_attempt(jsonb_set(pg_temp.free_manifest(2,'malformed'),'{0,credential_hash}',to_jsonb(encode(digest('1:1','sha256'),'hex'))))$$,'23505',null,'credential collision rolls back whole transaction');
select is((select count(*)::integer from public.free_registration_requests where id='b6300000-0000-4000-8000-000000000090'),0,'all invalid manifests leave no receipt');
select is((select count(*)::integer from public.free_registrations where request_id='b6300000-0000-4000-8000-000000000090'),0,'all invalid manifests leave no registration');
select is((select count(*)::integer from public.tickets where event_id='b6200000-0000-4000-8000-000000000002'),0,'all invalid manifests leave no tickets');
select is(private.free_reserved_admissions('b6200000-0000-4000-8000-000000000002'),0::bigint,'all invalid manifests consume no capacity');
create function pg_temp.revise(p_patch jsonb) returns public.events language sql as $$
 select public.save_owned_event_revision(e.id,(select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(e)) where key=any(array[
 'title','description','category','starts_at','ends_at','timezone','venue_name','address_line1','address_line2','city','region','postal_code','country_code','mapbox_feature_id','latitude','longitude','admission_type','capacity']))||p_patch)
 from public.events e where e.id='b6200000-0000-4000-8000-000000000001';
$$;
select throws_ok($$select pg_temp.revise('{"capacity":1}')$$,'P0001','FREE_CAPACITY_BELOW_RESERVED','public revision cannot reduce capacity below registrations');
select throws_ok($$select pg_temp.revise('{"admission_type":"paid"}')$$,'P0001','FREE_REGISTRATION_EVENT_IMMUTABLE','public revision cannot convert registered free event');
-- Corruption probes intentionally disable triggers only within a rolled-back
-- subtransaction, proving read/writer coherence also fails closed on bad history.
create function pg_temp.corrupt_probe(p_sql text,p_action text) returns text language plpgsql as $$
declare result text;
begin
 set local session_replication_role=replica;
 execute p_sql;
 set local session_replication_role=origin;
 if p_action='collection' then result:=coalesce(public.server_lookup_free_ticket_collection(encode(digest('proof:1','sha256'),'hex'))::text,'NULL');
 else select outcome into result from public.server_redeem_organizer_ticket('b6100000-0000-4000-8000-000000000001','b6200000-0000-4000-8000-000000000001',digest('1:1','sha256'));
 end if;
 raise exception using errcode='PT001';
exception when sqlstate 'PT001' then return result;
end;
$$;
select is(pg_temp.corrupt_probe($$delete from public.tickets where unit_sequence=2 and event_id='b6200000-0000-4000-8000-000000000001'$$,'collection'),'NULL','incomplete source collection unavailable');
select is(pg_temp.corrupt_probe($$delete from public.tickets where unit_sequence=2 and event_id='b6200000-0000-4000-8000-000000000001'$$,'scan'),'invalid','incomplete source cannot admit');
select is(pg_temp.corrupt_probe($$update public.tickets set admission_label='Wrong' where unit_sequence=2 and event_id='b6200000-0000-4000-8000-000000000001'$$,'collection'),'NULL','wrong label source unavailable');
select is(pg_temp.corrupt_probe($$update public.tickets set organizer_id='b6100000-0000-4000-8000-000000000002' where unit_sequence=2 and event_id='b6200000-0000-4000-8000-000000000001'$$,'scan'),'invalid','wrong organizer source cannot admit');
select is(pg_temp.corrupt_probe($$update public.free_registration_requests set quantity=9 where event_id='b6200000-0000-4000-8000-000000000001'$$,'collection'),'NULL','request payload mismatch unavailable');
select is(pg_temp.corrupt_probe($$update public.events set status='draft' where id='b6200000-0000-4000-8000-000000000001'$$,'collection'),'NULL','draft event private admission unavailable');
select is(pg_temp.corrupt_probe($$update public.events set ends_at=now()-interval '1 hour',starts_at=now()-interval '2 hours' where id='b6200000-0000-4000-8000-000000000001'$$,'scan'),'invalid','ended event cannot admit');
update public.events set ends_at=now()-interval '1 hour',starts_at=now()-interval '2 hours' where id='b6200000-0000-4000-8000-000000000001';
select is(public.get_public_free_rsvp('b6200000-0000-4000-8000-000000000001'),null::jsonb,'ended event public RSVP unavailable');
select is(jsonb_array_length(public.server_lookup_free_ticket_collection(encode(digest('proof:1','sha256'),'hex'))->'tickets'),2,'ended event private history retained');
select is(pg_temp.register(2)->>'reason','unavailable','ended event rejects new request');
select is(pg_temp.register(1)->>'kind','confirmed','ended event replay unchanged');
select * from finish();
rollback;
