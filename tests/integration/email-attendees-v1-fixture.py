#!/usr/bin/env python3
"""Create synthetic attendees ONLY on the dedicated local Email Attendees stack.
Writes local-only credentials to ignored .superpowers/email-proof/browser.json.
Run existing SQL regressions before this persistent fixture; no provider calls.
"""
import base64, hashlib, hmac, importlib.util, json, pathlib, subprocess, sys, time, uuid
ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('proof',ROOT/'tests/integration/email-attendees-v1-concurrency.py')
proof=importlib.util.module_from_spec(spec);spec.loader.exec_module(proof)
def main():
    status=json.loads(subprocess.check_output(['pnpm','exec','supabase','status','--workdir',str(ROOT/'.supabase/email-attendees'),'-o','json'],cwd=ROOT,text=True,stderr=subprocess.DEVNULL))
    assert status['API_URL']=='http://127.0.0.1:61321'
    prefixes={p:str(uuid.uuid4())[:8] for p in ['b6100000','b6200000','b6300000','a6100000','a6200000','a6300000','a6400000']}
    salt=str(uuid.uuid4())
    free=proof.expand(ROOT/'supabase/tests/database/free_registration_fixture.inc')
    paid=proof.expand(ROOT/'supabase/tests/database/helpers/spec09_refund_setup.inc')
    statement="begin;select private.configure_policy_environment('development');"+free+"select pg_temp.register(1,3,2);select pg_temp.register(2,1,2,'Another Guest','other-guest@example.invalid');select pg_temp.register(3,1,2,'Same Guest','pat@example.invalid');grant select on public.orders,public.order_items,public.tickets to service_role;"+paid+"select pg_temp.record_and_fulfill('emailproof','emailproof',id,session_id) from fulfillment_orders;reset role;revoke select on public.orders,public.order_items,public.tickets from service_role;"
    if '--bulk' in sys.argv:
        statement=statement.replace('grant select on public.orders',"select pg_temp.register(n,1,2,'Bulk Guest','bulk-'||n||'@example.invalid') from generate_series(4,1001)n;grant select on public.orders")
    for old,new in prefixes.items():statement=statement.replace(old,new)
    for old in ['free-owner','free-other','integrity-owner','integrity-other','synthetic-buyer','pat','other-guest']:statement=statement.replace(old+'@',old+'-'+salt+'@')
    statement=statement.replace("'proof:'","'"+salt+":'").replace('p_number::text));',"'"+salt+":'||p_number::text));")
    for old in ['cs_test_integrityclean','acct_integrityfulfillment','emailproof']:statement=statement.replace(old,old+salt.replace('-',''))
    # Fixture helpers use fixed hashes/credential seeds; randomize for repeatability.
    statement=statement.replace("repeat('1',64)","'"+hashlib.sha256(salt.encode()).hexdigest()+"'")
    statement=statement.replace("'spec09-ticket:'","'"+salt+":'")
    owners=[prefixes[p]+'-0000-4000-8000-'+str(n).zfill(12) for p in ['b6100000','a6100000'] for n in [1,2]]
    statement+="update public.organizers set onboarding_completed_at=clock_timestamp(),organizer_type='Community organizer' where id in ("+','.join("'"+o+"'" for o in owners)+");"
    config={'acceptingSends':True,'workerEnabled':True,'senderEmail':'notify@example.invalid','replyTo':'support@example.invalid','appOrigin':'https://email-proof.example.invalid','capacityPerMinute':10000,'capacityPerDay':10000,'capacityPerMonth':10000,'healthMaxAgeSeconds':3600}
    statement+="update private.organizer_message_recipients set lease_until=null,dispatch_stopped_reason='fixture-isolation';update private.ticket_email_outbox set dispatch_stopped_reason='fixture-isolation';update private.ticket_email_settings set enabled_at=null,worker_enabled=false;select public.server_configure_organizer_messages('"+json.dumps(config)+"');select public.server_acknowledge_organizer_message_worker();commit;"
    marker=ROOT/'.supabase/email-attendees/.proof-fixtures-present';marker.write_text('Persistent synthetic fixture. Reset dedicated local stack before legacy suites.\n')
    proof.sql(statement)
    def id(p,n):return prefixes[p]+'-0000-4000-8000-'+str(n).zfill(12)
    def token(owner):
        enc=lambda x:base64.urlsafe_b64encode(json.dumps(x,separators=(',',':')).encode()).decode().rstrip('=')
        body=enc({'alg':'HS256','typ':'JWT'})+'.'+enc({'sub':owner,'role':'authenticated','aud':'authenticated','iss':status['API_URL']+'/auth/v1','iat':int(time.time()),'exp':int(time.time())+14400})
        return body+'.'+base64.urlsafe_b64encode(hmac.new(status['JWT_SECRET'].encode(),body.encode(),hashlib.sha256).digest()).decode().rstrip('=')
    data={'api':status['API_URL'],'anon':status['ANON_KEY'],'service':status['SERVICE_ROLE_KEY'],'origin':'http://127.0.0.1:3077','edge':'http://127.0.0.1:61330','free':{'owner':id('b6100000',1),'event':id('b6200000',2),'emptyEvent':id('b6200000',1),'registration':proof.sql("select id from public.free_registrations where request_id='"+id('b6300000',1)+"';").strip()},'paid':{'owner':id('a6100000',1),'event':id('a6200000',1),'tier':id('a6300000',1),'order':proof.sql("select id from public.orders where event_id='"+id('a6200000',1)+"';").strip()},'other':{'owner':id('b6100000',2)}}
    for key in ['free','paid','other']:data[key]['token']=token(data[key]['owner'])
    target=ROOT/'.superpowers/email-proof/browser.json';target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(data));target.chmod(0o600)
    print('Synthetic paid/free fixture ready; local credentials saved only in ignored browser.json. No provider calls.')
if __name__=='__main__':main()
