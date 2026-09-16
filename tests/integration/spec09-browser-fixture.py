#!/usr/bin/env python3
"""Synthetic browser order only, in the identity-checked Spec09 disposable DB."""
import importlib.util,json,pathlib,subprocess,uuid,hashlib,base64
ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('spec09db',ROOT/'tests/integration/spec08-spec09-database.py');db=importlib.util.module_from_spec(spec);spec.loader.exec_module(db)
def query(statement):
 return subprocess.run(['docker','exec','-i',db.verify(),'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],input=statement,text=True,capture_output=True,check=True).stdout.strip()
if __name__=='__main__':
 target=ROOT/'.superpowers/spec08-spec09/browser-fixture.json'
 namespace=uuid.uuid4().hex
 bearer_bytes=uuid.uuid4().bytes+uuid.uuid4().bytes
 paid_token=base64.urlsafe_b64encode(bearer_bytes).decode().rstrip("=")
 owner,event,tier,request=[uuid.uuid4().hex[:8] for _ in range(4)]
 s=db.expand(ROOT/'supabase/tests/database/helpers/spec09_refund_setup.inc')
 for a,b in [('a6100000',owner),('a6200000',event),('a6300000',tier),('a6400000',request),('integrity','spec09browser'+namespace),('Integrity','Harbor'),('Checkout Harbor Fulfillment Event','Harbor Lights Live')]:s=s.replace(a,b)
 s=s.replace("repeat('1',64)","'"+hashlib.sha256(bearer_bytes).hexdigest()+"'")
 s='begin;\n'+s+"\nselect pg_temp.record_and_fulfill('spec09browserpaidPLACEHOLDER','spec09browserpaidPLACEHOLDER',f.id,f.session_id,(select jsonb_agg(jsonb_build_object('order_item_id',i.id,'unit_sequence',n,'admission_label',i.tier_name,'credential_hash',encode(extensions.digest('wta1_'||rtrim(translate(encode(extensions.hmac(convert_to('wheretoo:paid-admission:lite:v1'||chr(10)||i.id::text||chr(10)||n::text,'UTF8'),decode(repeat('07',32),'hex'),'sha256'),'base64'),'+/','-_'),'='),'sha256'),'hex')) order by i.id,n) from public.order_items i cross join lateral generate_series(1,i.quantity)n where i.order_id=f.id)) from fulfillment_orders f;\nreset role;\n"
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
 target.write_text(json.dumps(fixture)+'\n');print('Seeded three synthetic admissions in verified Spec09 database.')
