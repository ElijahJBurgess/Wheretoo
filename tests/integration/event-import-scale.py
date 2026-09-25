#!/usr/bin/env python3
"""Real local SQL row/lease/receipt scale proof with deterministic provider outcomes."""
import importlib.util,json,uuid,time,subprocess
from pathlib import Path
spec=importlib.util.spec_from_file_location('p',Path(__file__).with_name('event-import-proof.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
connection=p.Session();p.sql=connection.sql
a=p.seed();emails_before=int(p.sql('select count(*) from private.ticket_email_outbox;'));salt=uuid.uuid4().hex[:10];start=time.monotonic()
rs=[p.row(n,f'{salt} clean {n}') for n in range(500)]
for n in range(350,400):rs[n]['input']['category']='unknown';rs[n]['errors']=[dict(field='category',code='INVALID_CATEGORY',message='Unknown category')]
for n in range(400,425):rs[n]['input']['title']=rs[n-400]['input']['title']
for n in range(425,450):rs[n]['input']['title']=f'{salt} existing {n}'
# Existing other-organizer drafts deliberately remain candidates.
for n in range(425,450):
 i=rs[n]['input'];p.sql(f"insert into public.events(organizer_id,title,starts_at,ends_at,address_line1,city,postal_code,region,country_code,mapbox_feature_id,latitude,longitude) values('{a['other']}',{p.quote(i['title'])},{p.quote(i['starts_at'])},{p.quote(i['ends_at'])},'1 Market St','San Francisco','94105','CA','US','import.fixture.0',37.7936,-122.3958);")
(p.EVIDENCE/'scale-input.json').write_text(json.dumps(rs))
subprocess.run(['pnpm','exec','deno','run','--allow-read='+str(p.EVIDENCE),'--allow-write='+str(p.EVIDENCE),'tests/integration/edge/event-import/scale-transport.ts'],cwd=p.ROOT,check=True)
transport=json.loads((p.EVIDENCE/'scale-transport.json').read_text());rs=transport['rows']
b=p.upload(a['admin'],rs)
# Each statement is one transaction; network results are injected after claim commit.
for n in list(range(350))+list(range(400,500)):
 result=transport['initial'][n]
 p.verify(a['admin'],b,result)
ready=[r['id'] for r in p.rows(b) if r['state']=='ready'];assert len(ready)==350,len(ready)
def select_and_import(ids):
 for k in range(0,len(ids),50):p.select(a['admin'],b,ids[k:k+50])
 output=[]
 for rid in ids:output.append(p.imported(a['admin'],b,rid))
 return output
first=select_and_import(ready);assert all(x['kind']=='imported' for x in first)
# Transient work is due again, not reuploaded. Drive its remaining retry from durable truth.
p.sql(f"update private.event_import_rows set next_attempt_at=clock_timestamp() where batch_id='{b}' and state='pending';")
for result in transport['retried']:p.verify(a['admin'],b,result)
dups=[r for r in p.rows(b) if r['state']=='duplicate_possible'];assert len(dups)==50,len(dups)
for ix,r in enumerate(dups):
 action='skip' if ix<30 else 'override_duplicate'
 result=p.sql(f"select public.server_resolve_event_import_row('{a['admin']}','{b}','{r['id']}','{action}',{p.quote(r['duplicate_digest'])});")
 if result=='f':
  current=next(x for x in p.rows(b) if x['id']==r['id']);assert p.sql(f"select public.server_resolve_event_import_row('{a['admin']}','{b}','{r['id']}','{action}',{p.quote(current['duplicate_digest'])});")=='t'

later=[r['id'] for r in p.rows(b) if r['state']=='ready'];assert len(later)==45,len(later)
# Local-only test trigger fails one known draft title, never a production injection flag.
target=next(r for r in p.rows(b) if r['id']==later[0])['input']['title']
p.sql("create function public.import_proof_fail() returns trigger language plpgsql as $$ begin if new.title="+p.quote(target)+" then raise exception 'synthetic failure';end if;return new;end;$$;create trigger import_proof_fail before insert on public.events for each row execute function public.import_proof_fail();")
try:
 second=select_and_import(later);assert sum(x['kind']=='imported' for x in second)==44,second
finally:p.sql('drop trigger import_proof_fail on public.events;drop function public.import_proof_fail();')
p.sql(f"select public.server_resolve_event_import_row('{a['admin']}','{b}','{later[0]}','retry');")
assert p.imported(a['admin'],b,later[0])['kind']=='imported'
for r in p.rows(b):
 if r['state'] not in ['imported','skipped']:p.sql(f"select public.server_resolve_event_import_row('{a['admin']}','{b}','{r['id']}','skip');")
final=p.rows(b);mapping={r['id']:r['resulting_event_id'] for r in final if r['state']=='imported'}
assert len(mapping)==395 and len(set(mapping.values()))==395 and sum(r['state']=='skipped' for r in final)==105
for rid,eid in mapping.items():assert p.imported(a['admin'],b,rid)['eventId']==eid
assert p.sql(f"select state from private.event_import_batches where id='{b}';")=='completed_with_skips'
for t in ['tickets','free_registrations','ticket_tiers']:assert p.sql(f"select count(*) from public.{t} where event_id in (select resulting_event_id from private.event_import_rows where batch_id='{b}');")=='0'
assert int(p.sql('select count(*) from private.ticket_email_outbox;'))==emails_before
result=dict(emailsCreated=0,registrationsCreated=0,ticketsCreated=0,batch=b,imported=395,skipped=105,unresolved=0,replayed=395,seconds=round(time.monotonic()-start,3),provider='475 injected production-adapter transports; Deno network permission absent',csvBytes=transport['csvBytes'])
(p.EVIDENCE/'scale.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))

connection.close()
