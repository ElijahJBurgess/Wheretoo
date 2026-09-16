#!/usr/bin/env python3
"""Synthetic browser order only, in the identity-checked Spec10 disposable DB."""
import importlib.util,json,pathlib,subprocess,uuid,hashlib,base64
ROOT=pathlib.Path(__file__).resolve().parents[2]
(ROOT/'.superpowers/spec10').mkdir(parents=True, exist_ok=True)
spec=importlib.util.spec_from_file_location('spec10db',ROOT/'tests/integration/spec10-database.py');db=importlib.util.module_from_spec(spec);spec.loader.exec_module(db)
def query(statement):
 return subprocess.run(['docker','exec','-i',db.verify(),'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],input=statement,text=True,capture_output=True,check=True).stdout.strip()
if __name__=='__main__':
 target=ROOT/'.superpowers/spec10/browser-fixture.json'
 namespace=uuid.uuid4().hex
 bearer_bytes=uuid.uuid4().bytes+uuid.uuid4().bytes
 paid_token=base64.urlsafe_b64encode(bearer_bytes).decode().rstrip("=")
 owner,event,tier,request=[uuid.uuid4().hex[:8] for _ in range(4)]
 s=db.expand(ROOT/'supabase/tests/database/helpers/spec09_refund_setup.inc').replace("now() + interval","date_trunc('minute',now()) + interval")
 for a,b in [('a6100000',owner),('a6200000',event),('a6300000',tier),('a6400000',request),('integrity','spec10browser'+namespace),('Integrity','Harbor'),('Checkout Harbor Fulfillment Event','Harbor Lights Live')]:s=s.replace(a,b)
 s=s.replace("repeat('1',64)","'"+hashlib.sha256(bearer_bytes).hexdigest()+"'")
 s='begin;\n'+s+"\nselect pg_temp.record_and_fulfill('spec10browserpaidPLACEHOLDER','spec10browserpaidPLACEHOLDER',f.id,f.session_id,(select jsonb_agg(jsonb_build_object('order_item_id',i.id,'unit_sequence',n,'admission_label',i.tier_name,'credential_hash',encode(extensions.digest('wta1_'||rtrim(translate(encode(extensions.hmac(convert_to('wheretoo:paid-admission:lite:v1'||chr(10)||i.id::text||chr(10)||n::text,'UTF8'),decode(repeat('07',32),'hex'),'sha256'),'base64'),'+/','-_'),'='),'sha256'),'hex')) order by i.id,n) from public.order_items i cross join lateral generate_series(1,i.quantity)n where i.order_id=f.id)) from fulfillment_orders f;\nreset role;\n"
 s+="""
select * from public.server_redeem_organizer_ticket('d9100000-0000-4000-8000-000000000001','d9200000-0000-4000-8000-000000000001',(select credential_hash from public.tickets where event_id='d9200000-0000-4000-8000-000000000001' order by id limit 1));
update public.organizers set onboarding_completed_at=now() where id='d9100000-0000-4000-8000-000000000001';
"""
 settings=(ROOT/'supabase/tests/database/spec07_email_fixture.inc').read_text();s+=settings[settings.index('update private.ticket_email_settings'):settings.index('create function pg_temp.envelope')]
 s+='commit;'
 s=s.replace('d9100000',owner).replace('d9200000',event).replace('PLACEHOLDER',namespace)
 query(s)
 fixture=json.loads(query("select jsonb_build_object('orderId',id,'eventId',event_id,'ownerId',organizer_id) from public.orders where client_request_id='"+request+"-0000-4000-8000-000000000001';"))
 fixture['paidToken']=paid_token
 # A separate real free event, with its existing deterministic credential contract.
 import hmac
 fs=db.expand(ROOT/'supabase/tests/database/free_registration_fixture.inc').replace("now()+interval","date_trunc('minute',now())+interval")
 fp={old:uuid.uuid4().hex[:8] for old in ['b6100000','b6200000','b6300000']}
 for old,new in fp.items():fs=fs.replace(old,new)
 fs=fs.replace('free-owner@example.invalid','free-'+namespace+'@example.invalid').replace('free-other@example.invalid','free-other-'+namespace+'@example.invalid')
 fo=fp['b6100000']+'-0000-4000-8000-000000000001';fe=fp['b6200000']+'-0000-4000-8000-000000000001'
 request_id=str(uuid.uuid4());free_bytes=uuid.uuid4().bytes+uuid.uuid4().bytes
 free_token=base64.urlsafe_b64encode(free_bytes).decode().rstrip('=')
 manifest=[]
 for unit in [1,2]:
  credential='wta1_'+base64.urlsafe_b64encode(hmac.new(bytes([7])*32,f'wheretoo:free-admission:v1\n{request_id}\n{unit}'.encode(),'sha256').digest()).decode().rstrip('=')
  manifest.append({'unit_sequence':unit,'credential_hash':hashlib.sha256(credential.encode()).hexdigest()})
 fs+=f"select public.server_confirm_free_registration('{request_id}','{fe}','Pat Guest','free-pat@example.invalid',2,'{hashlib.sha256(free_token.encode()).hexdigest()}','{json.dumps(manifest)}'::jsonb);"
 fs+=f"select public.server_redeem_organizer_ticket('{fo}','{fe}',decode('{manifest[0]['credential_hash']}','hex'));update public.organizers set onboarding_completed_at=now() where id='{fo}';"
 query('begin;'+fs+'commit;')
 assert query(f"select count(*) from public.tickets where event_id='{fe}' and status='used' and used_at is not null;")=='1', 'Free fixture check-in must be proven before browser cancellation'
 fixture.update({'freeOwnerId':fo,'freeEventId':fe,'freeToken':free_token,'freeRegistrationId':query(f"select id from public.free_registrations where event_id='{fe}';")})
 query('update private.ticket_email_settings set worker_enabled=false;update private.checkout_runtime_control set checkout_creation_enabled=false;')
 target.write_text(json.dumps(fixture)+'\n');print('Seeded separate paid and free synthetic admissions in verified Spec10 database.')
