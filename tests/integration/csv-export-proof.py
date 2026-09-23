#!/usr/bin/env python3
"""Synthetic-only fixtures and real PostgREST complete-or-fail proof. No payment/provider calls."""
import base64, hashlib, hmac, importlib.util, json, pathlib, time, urllib.request, urllib.error
ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('csvdb',ROOT/'tests/integration/csv-export-database.py')
db=importlib.util.module_from_spec(spec);spec.loader.exec_module(db)
OWNER='a6100000-0000-4000-8000-000000000001'; PAID='a6200000-0000-4000-8000-000000000001'
FREE_OWNER='b6100000-0000-4000-8000-000000000001'; FREE='b6200000-0000-4000-8000-000000000002'
def token(owner=OWNER,role='authenticated'):
 enc=lambda x:base64.urlsafe_b64encode(json.dumps(x).encode()).decode().rstrip('=')
 body=enc({'alg':'HS256','typ':'JWT'})+'.'+enc({'role':role,'sub':owner,'exp':int(time.time())+3600})
 return body+'.'+base64.urlsafe_b64encode(hmac.new(b'csv-export-local-only-jwt-secret-disposable-2026',body.encode(),hashlib.sha256).digest()).decode().rstrip('=')
def rpc(event=PAID,kind='orders',owner=OWNER,auth=True):
 db.verify()
 req=urllib.request.Request('http://127.0.0.1:55626/rpc/get_organizer_event_export',json.dumps({'p_event_id':event,'p_kind':kind}).encode(),{'Content-Type':'application/json',**({'Authorization':'Bearer '+token(owner)} if auth else {})})
 started=time.monotonic()
 try:
  with urllib.request.urlopen(req,timeout=35) as response:body=response.read();status=response.status
 except urllib.error.HTTPError as e:body=e.read();status=e.code
 elapsed=time.monotonic()-started
 return status,json.loads(body),len(body),round(elapsed,3)
def seed():
 # Refuse to overwrite any existing fixture or other application data.
 assert '0' in db.sql('select count(*) from public.orders;').split(),'Requires a fresh dedicated database'
 sql='begin;\n'+db.expand(ROOT/'supabase/tests/database/helpers/core_ticket_truth_lite_setup.inc')
 sql+="\nselect pg_temp.record_and_fulfill('csvbrowser','csvbrowser',id,session_id) from fulfillment_orders where kind='clean'; reset role;\n"
 sql+="create table public.csv_fixture_template as select to_jsonb(o) body from public.orders o where paid_at is null limit 1; revoke all on public.csv_fixture_template from public,anon,authenticated,service_role;\n"
 sql+="update public.ticket_tiers set quantity_total=30000 where event_id='"+PAID+"';\n"
 sql+=db.expand(ROOT/'supabase/tests/database/free_registration_fixture.inc')
 sql+="\nselect pg_temp.register(1,1,2,'Synthetic Registrant','registrant@example.invalid'); update public.organizers set onboarding_completed_at=now(); commit;"
 # The helper receipt payload and production writers establish coherent seeds.
 db.sql(sql)

def paid_count(total):
 # Privileged fixture loading only; every new record must pass the unchanged coherence authority.
 # Disable identity writers during synthetic construction, never during an export call.
 db.sql(f"""begin; set local session_replication_role=replica;
 delete from public.order_items where order_id in(select id from public.orders where order_number like 'CSV-%');
 delete from public.orders where order_number like 'CSV-%';
 insert into public.orders select (jsonb_populate_record(null::public.orders,body||jsonb_build_object(
 'id',('c5100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'order_number','CSV-'||n,
 'client_request_id',('c5200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'confirmation_token_hash',encode(extensions.digest('csv-order-proof-'||n,'sha256'),'hex'),
 'buyer_name','Synthetic','buyer_email','g@x.invalid','stripe_checkout_session_id',null))).*
 from public.csv_fixture_template cross join generate_series(1,{total-7}) n;
 insert into public.order_items select (jsonb_populate_record(null::public.order_items,to_jsonb(i)||jsonb_build_object(
 'id',gen_random_uuid(),'order_id',o.id))).*
 from public.orders o cross join public.csv_fixture_template seed
 join public.order_items i on i.order_id=(seed.body->>'id')::uuid where o.order_number like 'CSV-%';
 set local session_replication_role=origin; commit; analyze public.orders; analyze public.order_items; analyze public.free_registrations; analyze public.free_registration_requests; analyze public.tickets;""")
def free_count(total):
 db.sql(f"""begin; set local session_replication_role=replica;
 delete from public.tickets where registration_id in(select id from public.free_registrations where id::text like 'c5300000%');
 delete from public.free_registrations where id::text like 'c5300000%';
 delete from public.free_registration_requests where id::text like 'c5400000%';
 insert into public.free_registration_requests select (jsonb_populate_record(null::public.free_registration_requests,to_jsonb(q)||jsonb_build_object(
 'id',('c5400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'access_hash',encode(extensions.digest('csv-free-proof-'||n,'sha256'),'hex'),
 'result',jsonb_build_object('kind','confirmed','registrationId',('c5300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'eventId',q.event_id,'quantity',1)))).*
 from public.free_registration_requests q cross join generate_series(1,{total-1}) n where q.id='b6300000-0000-4000-8000-000000000001';
 insert into public.free_registrations select (jsonb_populate_record(null::public.free_registrations,to_jsonb(r)||jsonb_build_object(
 'id',('c5300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'request_id',('c5400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'access_hash',encode(extensions.digest('csv-free-proof-'||n,'sha256'),'hex')))).*
 from public.free_registrations r cross join generate_series(1,{total-1}) n where r.request_id='b6300000-0000-4000-8000-000000000001';
 insert into public.tickets select (jsonb_populate_record(null::public.tickets,to_jsonb(t)||jsonb_build_object(
 'id',gen_random_uuid(),'registration_id',r.id,'credential_hash','\\x'||encode(extensions.digest(r.id::text,'sha256'),'hex')))).*
 from public.free_registrations r cross join public.tickets t
 where r.id::text like 'c5300000%' and t.registration_id=(select id from public.free_registrations where request_id='b6300000-0000-4000-8000-000000000001');
 set local session_replication_role=origin; commit; analyze public.orders; analyze public.order_items; analyze public.free_registrations; analyze public.free_registration_requests; analyze public.tickets;""")

def main():
 import sys
 if '--resume' not in sys.argv: seed()
 results=[]
 def measure(kind,count,background):
  status,body,size,elapsed=rpc(FREE if kind=='registrations' else PAID,kind,FREE_OWNER if kind=='registrations' else OWNER)
  result={'kind':kind,'sources':count,'background':background,'http':status,'bytes':size,'seconds':elapsed,'rowCount':body.get('rowCount'),'error':body.get('message')}
  results.append(result)
  (ROOT/'.superpowers/csv-export/performance.json').write_text(json.dumps(results,indent=2)+'\n')
  print(result,flush=True)
  if status==200: assert body['rowCount']==len(body['rows'])==count
  return status
 free_count(1)
 for count in [55,2000,10000,10001]:
  paid_count(count)
  assert measure('orders',count,'one free admission')==(413 if count>10000 else 200)
  if count==10001: assert rpc(kind='admissions')[0]==413
 paid_count(2000)
 for count in [55,1001,10000,10001]:
  free_count(count)
  assert measure('registrations',count,'2000 paid orders / three paid admissions')==(413 if count>10000 else 200)
 free_count(55)
 # Actual JSON-byte overflow using a DB-valid title padded with spaces. No field truncation.
 before=db.sql("select title from public.events where id='"+PAID+"';")
 db.sql("begin;set local session_replication_role=replica;update public.events set title=repeat(' ',8388608)||'CSV' where id='"+PAID+"';commit;")
 try:
  assert rpc()[0]==413
 finally:
  db.sql("begin;set local session_replication_role=replica;update public.events set title='Checkout Integrity Fulfillment Event' where id='"+PAID+"';commit;")
 assert before==db.sql("select title from public.events where id='"+PAID+"';")
 assert rpc(owner='a6100000-0000-4000-8000-000000000002')[0]==403
 assert rpc(auth=False)[0] in [401,403]
 assert rpc(PAID,'registrations')[0]==403
 assert rpc(FREE,'orders',FREE_OWNER)[0]==403
 print('Authorization, admissions source cap, and real 8 MiB JSON overflow passed',flush=True)
 # Retain the mixed-event benchmark: existing coherence helpers may scan unrelated tickets.
 free_count(10000);paid_count(10000)
 mixed=measure('orders',10000,'10000 free admissions')
 free_count(55);paid_count(2000)
 assert mixed==200,'REVIEW BLOCKER: exact cap failed with mixed-event data; do not raise timeouts or bypass coherence'
if __name__=='__main__':main()
