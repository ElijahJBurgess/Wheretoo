#!/usr/bin/env python3
import importlib.util,json,uuid,time
from pathlib import Path
spec=importlib.util.spec_from_file_location('p',Path(__file__).with_name('event-import-proof.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
s=p.Session();f=json.loads((p.ROOT/'.superpowers/event-import-proof/browser.json').read_text());owner=f['actors']['owner'];salt=uuid.uuid4().hex
started=time.monotonic();s.sql('begin;')
try:
 s.sql(f"insert into public.events(organizer_id,title,starts_at,ends_at,mapbox_feature_id,address_line1,city,postal_code,region,country_code,latitude,longitude) select '{owner}','Unrelated {salt} '||n,now()+interval '30 days',now()+interval '30 days 1 hour','local.perf.'||n,n||' Market St','San Francisco','94105','CA','US',37.7936,-122.3958 from generate_series(1,10000) n;analyze public.events;")
 q=f"select e.id from public.events e where private.import_normalize(e.title)=private.import_normalize('Unrelated {salt} 5000') and starts_at between now()+interval '30 days'-interval '30 minutes' and now()+interval '30 days 30 minutes' and (mapbox_feature_id='local.perf.5000' or private.import_address(address_line1,address_line2,city,postal_code,region,country_code)=private.import_address('5000 Market St',null,'San Francisco','94105','CA','US'))"
 plan=json.loads(s.sql('explain (analyze,buffers,format json) '+q+';'));assert 'event_import_match_' in json.dumps(plan),plan
 result={'unrelatedEvents':10000,'plan':plan,'elapsedIncludingSeedingSeconds':round(time.monotonic()-started,3)};(p.EVIDENCE/'query-plan.json').write_text(json.dumps(result,indent=2));print(json.dumps({'executionMs':plan[0]['Execution Time'],'planningMs':plan[0]['Planning Time'],'indexUsed':True,'seedSeconds':result['elapsedIncludingSeedingSeconds']}))
finally:s.sql('rollback;');s.close()
