#!/usr/bin/env python3
import importlib.util,json,uuid,hashlib,time,statistics
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
spec=importlib.util.spec_from_file_location('p',Path(__file__).with_name('event-import-proof.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
f=json.loads((p.ROOT/'.superpowers/event-import-proof/browser.json').read_text());a=f['actors'];admin=a['admin'];source=p.row(0,uuid.uuid4().hex);source['input']['capacity']=1;b=p.upload(admin,[source]);r=p.verify(admin,b);p.select(admin,b,[r]);event=p.imported(admin,b,r)['eventId'];s=p.Session()
requirements=dict(minimum_age='all_ages',alcohol_present=False,cannabis_present=False,explicit_adult_content=False,gambling_present=False,weapons_present=False,high_risk_activity=False)
s.sql(f"begin;select private.configure_policy_environment('development');select set_config('request.jwt.claim.sub','{a['owner']}',true);set local role authenticated;select public.save_owned_event_requirements('{event}',{p.j(requirements)});select public.accept_current_event_policies('{event}');select public.publish_event('{event}');commit;")
s.sql(f"begin;select id from public.events where id='{event}' for update;")
def register(n):
 request=str(uuid.uuid4());proof=hashlib.sha256(request.encode()).hexdigest();manifest=[dict(unit_sequence=1,credential_hash=hashlib.sha256((request+'credential').encode()).hexdigest())]
 return p.value(f"set application_name='import-finite-{n}';select public.server_confirm_free_registration('{request}','{event}','Pat Guest','guest{n}@example.invalid',1,'{proof}',{p.j(manifest)});")
with ThreadPoolExecutor(max_workers=2) as pool:
 jobs=[pool.submit(register,n) for n in range(2)]
 for _ in range(100):
  if p.sql("select count(*) from pg_stat_activity where application_name like 'import-finite-%' and wait_event_type='Lock';")=='2':break
  time.sleep(.05)
 else:raise AssertionError('Both real connections must be observed waiting')
 s.sql('commit;');results=[job.result() for job in jobs]
assert sum(x['kind']=='confirmed' for x in results)==1,results;assert sum(x.get('reason')=='full' for x in results)==1,results;assert p.sql(f"select count(*) from public.tickets where event_id='{event}';")=='1'
# 1000 independent replay transactions of the imported source.
times=[]
for _ in range(1000):
 start=time.monotonic();got=json.loads(s.sql(f"select public.server_import_event_row('{admin}','{b}','{r}');"));assert got['eventId']==event;times.append((time.monotonic()-start)*1000)
result={'finiteLastSlotTwoConnections':True,'registrations':1,'tickets':1,'replayTransactions':1000,'replayMeanMs':statistics.mean(times),'replayP95Ms':sorted(times)[949]};(p.EVIDENCE/'finite-race.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));s.close()
