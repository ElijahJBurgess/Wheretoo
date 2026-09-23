"""Seed only the disposable storefront stack with canonical, synthetic browser fixtures."""
import importlib.util,json,urllib.request,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('proof',ROOT/'tests/integration/storefront-identity-proof.py');p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
email='storefront-browser@example.invalid';password='LocalStorefrontBrowserOnly123!'
code,user=p.http('/auth/v1/admin/users',p.CONFIG['SERVICE_ROLE_KEY'],{'email':email,'password':password,'email_confirm':True});assert code in (200,201)
code,session=p.http('/auth/v1/token?grant_type=password',body={'email':email,'password':password});assert code==200
token=session['access_token'];owner=user['id']
s=(ROOT/'supabase/tests/database/spec13_fixture.inc').read_text();s=s[s.index('insert into public.organizers'):];s=s[:s.index('create function pg_temp')];s=s.replace('d1300000-0000-4000-8000-000000000001',owner).replace('Discovery fixture owner','Night Sessions').replace('generate_series(1,64)','generate_series(1,26)').replace("'Discovery fixture '||n","case when n=1 then 'After Hours: Oakland Sessions' when n=2 then 'Night Market & Live Music' else 'Community Sessions '||n end")
s=s.replace("statement_timestamp()+interval '1 day',statement_timestamp()+interval '1 day 2 hours'", "statement_timestamp()+interval '1 day'*n,statement_timestamp()+interval '1 day'*n+interval '2 hours'")
p.local.sql('begin;'+s+'commit;')
assets=[]
for name in ['logo','merch']:
 code,data=p.http('/functions/v1/organizer-media',token,(ROOT/f'.superpowers/storefront/screenshots/{name}.png').read_bytes(),mime='image/png');assert code==201,(code,data);assets.append(data['id'])
code,data=p.http('/rest/v1/rpc/confirm_owned_storefront_handle',token,{'p_handle':'night-sessions','p_logo_id':assets[0]});assert code==200
for n in range(1,7):
 event=f'd1310000-0000-4000-8000-{n:012}'
 req=urllib.request.Request(p.BASE+'/functions/v1/event-images',method='POST',data=(ROOT/'.superpowers/storefront/screenshots/flyer.png').read_bytes(),headers={'apikey':p.CONFIG['ANON_KEY'],'Authorization':'Bearer '+token,'content-type':'image/png','Origin':'http://127.0.0.1:3070','x-event-id':event,'x-cover-revision':'0','x-request-id':str(uuid.uuid4())})
 with urllib.request.urlopen(req) as response:assert response.status in (200,201)
# Artwork changes use the canonical publication review; fixture re-accepts and republishes.
p.local.sql("begin;select set_config('request.jwt.claim.sub','"+owner+"',true);set local role authenticated;select public.accept_current_event_policies(id) from public.events;select public.publish_event(id) from public.events;reset role;commit;")
code,editor=p.http('/rest/v1/rpc/get_owned_storefront_editor',token,{})
value={key:editor[key] for key in ['name','bio','city','websiteUrl','logoId','coverId','accent','links','featuredEventId']};value.update({'bio':'Independent music, neighborhood gatherings, and nights worth going out for.','city':'Oakland, CA','links':{'instagram':'https://www.instagram.com/night-sessions'},'websiteUrl':'https://example.org','featuredEventId':'d1310000-0000-4000-8000-000000000002'})
code,editor=p.http('/rest/v1/rpc/save_owned_storefront',token,{'p_input':value,'p_expected_updated_at':editor['updatedAt']});assert code==200,(code,editor)
merch=[{'id':str(uuid.uuid4()),'imageId':assets[1],'title':title,'price':'$25','url':'https://example.org/store'} for title in ['Night Sessions tee','City nights tote','Sessions poster']]
code,editor=p.http('/rest/v1/rpc/save_owned_storefront_merch',token,{'p_items':merch,'p_store_url':'https://example.org','p_expected_updated_at':editor['updatedAt']});assert code==200
code,editor=p.http('/rest/v1/rpc/set_owned_storefront_published',token,{'p_published':True,'p_expected_updated_at':editor['updatedAt']});assert code==200,(code,editor)
(ROOT/'.env.local').write_text('VITE_SUPABASE_URL='+p.BASE+'\nVITE_SUPABASE_PUBLISHABLE_KEY='+p.CONFIG['ANON_KEY']+'\nVITE_MAPBOX_ACCESS_TOKEN=storefront-local-disabled\nVITE_STRIPE_PUBLISHABLE_KEY=pk_test_storefront_disabled\n')
(ROOT/'.superpowers/storefront/browser-fixture.json').write_text(json.dumps({'owner':owner,'email':email,'password':password,'handle':'night-sessions'}))
print('Seeded dedicated local storefront: 26 canonical events, real private Storage assets, owner identity and 3 merch links.')
