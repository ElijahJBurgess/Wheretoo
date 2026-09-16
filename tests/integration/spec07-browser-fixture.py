#!/usr/bin/env python3
"""Seed only the verified Spec 07 disposable DB with synthetic end-to-end fixtures."""
import base64, hashlib, importlib.util, json, pathlib, subprocess
ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('spec07db',ROOT/'tests/integration/spec08-spec09-database.py')
db=importlib.util.module_from_spec(spec); spec.loader.exec_module(db)
def query(sql):
    container=db.verify()
    return subprocess.run(['docker','exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],input=sql,text=True,capture_output=True,check=True).stdout.strip()
if __name__=='__main__':
    try:
        target=ROOT/'.superpowers/spec07/browser-fixture.json'
        if query("select count(*) from auth.users where id='c7100000-0000-4000-8000-000000000001';")!='0':
            raise RuntimeError('Browser fixture already exists. Rebuild only the verified disposable DB before reseeding.')
        paid=base64.urlsafe_b64encode(bytes([11])*32).decode().rstrip('=')
        free='rsvp_'+base64.urlsafe_b64encode(bytes([12])*32).decode().rstrip('=')
        fixture=db.expand(ROOT/'supabase/tests/database/spec07_email_fixture.inc')
        fixture=fixture.replace('b6100000','c7100000').replace('b6200000','c7200000').replace('b6300000','c7300000').replace('free-owner@example.invalid','spec07-browser-owner@example.invalid').replace('free-other@example.invalid','spec07-browser-other@example.invalid')
        paid_fixture=db.expand(ROOT/'supabase/tests/database/helpers/core_ticket_truth_lite_setup.inc')
        paid_fixture=paid_fixture.replace('a6100000','c8100000').replace('a6200000','c8200000').replace('a6300000','c8300000').replace('a6400000','c8400000').replace('integrity-owner@example.invalid','spec07-paid-owner@example.invalid').replace('integrity-other@example.invalid','spec07-paid-other@example.invalid').replace('synthetic-buyer@example.invalid','pat@example.invalid')
        paid_fixture=paid_fixture.replace("repeat('1', 64)","'"+hashlib.sha256(bytes([11])*32).hexdigest()+"'")
        sql='begin;\n'+fixture+'\n'+paid_fixture+"\nreset role;\n"
        sql+="""
update public.events set starts_at=now()+interval '60 days',ends_at=now()+interval '60 days 2 hours',title='Harbor Lights — Paid Tickets' where id='c8200000-0000-4000-8000-000000000001';
select pg_temp.record_and_fulfill('spec07browser','spec07browser',f.id,f.session_id,
 (select jsonb_agg(jsonb_build_object('order_item_id',i.id,'unit_sequence',n,'admission_label',i.tier_name,'credential_hash',encode(extensions.digest('wta1_'||rtrim(translate(encode(extensions.hmac(convert_to('wheretoo:paid-admission:lite:v1' || chr(10)||i.id::text||chr(10)||n::text,'UTF8'),decode(repeat('07',32),'hex'),'sha256'),'base64'),'+/','-_'),'='),'sha256'),'hex')) order by i.id,n) from public.order_items i cross join lateral generate_series(1,i.quantity)n where i.order_id=f.id))
from fulfillment_orders f where kind='clean';
update public.events set title='Community Night — Free RSVP' where id='c7200000-0000-4000-8000-000000000001';
"""
        freehash=hashlib.sha256(free[5:].encode()).hexdigest()
        sql+="select public.server_confirm_free_registration('c7300000-0000-4000-8000-000000000001','c7200000-0000-4000-8000-000000000001','Pat Guest','pat@example.invalid',2,'"+freehash+"',"+"""
 (select jsonb_agg(jsonb_build_object('unit_sequence',n,'credential_hash',encode(extensions.digest('wta1_'||rtrim(translate(encode(extensions.hmac(convert_to('wheretoo:free-admission:v1'||chr(10)||'c7300000-0000-4000-8000-000000000001'||chr(10)||n::text,'UTF8'),decode(repeat('07',32),'hex'),'sha256'),'base64'),'+/','-_'),'='),'sha256'),'hex')) order by n) from generate_series(1,2)n));
"""
        # Reuse the inherited shared admission writer to establish original Used history.
        # Spec07 delivery never invokes this writer; this call belongs only to fixture setup.
        sql+="""
select * from public.server_redeem_organizer_ticket('c7100000-0000-4000-8000-000000000001','c7200000-0000-4000-8000-000000000001',
 (select credential_hash from public.tickets where event_id='c7200000-0000-4000-8000-000000000001' and unit_sequence=1));
commit;
"""
        query(sql)
        query("update public.organizers set onboarding_completed_at=now() where id in ('c7100000-0000-4000-8000-000000000001','c8100000-0000-4000-8000-000000000001');")
        query("alter role authenticator with login password 'spec08-spec09-disposable-only'; NOTIFY pgrst, 'reload schema';")
        source=json.loads(query("select jsonb_build_object('paidOrder',(select id from public.orders where client_request_id='c8400000-0000-4000-8000-000000000001'),'registration',(select id from public.free_registrations where request_id='c7300000-0000-4000-8000-000000000001'),'tickets',(select jsonb_agg(to_jsonb(t) order by t.id) from public.tickets t where event_id in ('c7200000-0000-4000-8000-000000000001','c8200000-0000-4000-8000-000000000001')));").splitlines()[-1])
        source.update(paidToken=paid,freeToken=free,owner='c7100000-0000-4000-8000-000000000001',paidOwner='c8100000-0000-4000-8000-000000000001',freeEvent='c7200000-0000-4000-8000-000000000001',paidEvent='c8200000-0000-4000-8000-000000000001')
        target.write_text(json.dumps(source,indent=2)+'\n')
        print('Synthetic browser fixture seeded in verified own DB; five original admissions recorded.')
    except subprocess.CalledProcessError as error:
        print(error.stderr); raise
