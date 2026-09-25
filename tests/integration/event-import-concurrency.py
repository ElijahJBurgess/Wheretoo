#!/usr/bin/env python3
"""Real independent PostgreSQL connections; deterministic locks/barriers, no provider IO."""
import importlib.util,sys,json,uuid,time,subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
spec=importlib.util.spec_from_file_location('proof',Path(__file__).with_name('event-import-proof.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
class Session:
 def __init__(self):
  p.sql('select 1');self.p=subprocess.Popen(['docker','exec','-i',p.DB,'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 def sql(self,s):
  marker='end_'+uuid.uuid4().hex;self.p.stdin.write(s+"\nselect '"+marker+"';\n");self.p.stdin.flush();lines=[]
  while True:
   line=self.p.stdout.readline()
   if not line:raise RuntimeError(self.p.stderr.read())
   if line.strip()==marker:return '\n'.join(lines)
   lines.append(line.rstrip())
 def close(self):
  if self.p.poll() is None:self.p.stdin.close();self.p.wait(timeout=10)
def blocked(name):
 for _ in range(200):
  if p.sql(f"select count(*) from pg_stat_activity where application_name='{name}' and wait_event_type='Lock';")=='1':return
  time.sleep(.025)
 raise AssertionError('No observed real lock wait: '+name)
def call(s,name=''):
 return p.sql((f"set application_name='{name}';" if name else '')+s)
def expect_error(f,code):
 try:f();raise AssertionError('expected '+code)
 except RuntimeError as e:assert code in str(e),str(e)
a=p.seed();admin=a['admin'];passed=[]
def ready(title=None):
 b=p.upload(admin,[p.row(0,title or uuid.uuid4().hex)]);r=p.verify(admin,b);p.select(admin,b,[r]);return b,r
with ThreadPoolExecutor(max_workers=4) as pool:
 b,r=ready();block=Session();block.sql(f"begin;select id from private.event_import_batches where id='{b}' for update;")
 q=f"select public.server_import_event_row('{admin}','{b}','{r}');"
 f1=pool.submit(call,q,'import-race-1');f2=pool.submit(call,q,'import-race-2');blocked('import-race-1');blocked('import-race-2');block.sql('commit;');block.close()
 x,y=json.loads(f1.result()),json.loads(f2.result());assert x==y and x['kind']=='imported';passed+=['same row/double click/simultaneous requests: two blocked real connections, one event']
 # Drop the first response after commit, then recover through durable row truth.
 call(q);assert p.rows(b)[0]['resulting_event_id']==x['eventId'];assert p.imported(admin,b,r)==x;passed+=['lost committed response replay']
 title=uuid.uuid4().hex;b1,r1=ready(title);b2,r2=ready(title)
 block=Session();block.sql(f"begin;select pg_advisory_xact_lock(hashtextextended('import-title:'||private.import_normalize('{title}'),0));")
 futures=[pool.submit(call,f"select public.server_import_event_row('{admin}','{b0}','{r0}');",name) for b0,r0,name in [(b1,r1,'cross-batch-1'),(b2,r2,'cross-batch-2')]]
 blocked('cross-batch-1');blocked('cross-batch-2');block.sql('commit;');block.close();results=[json.loads(f.result())['kind'] for f in futures];assert sorted(results)==['imported','needs_review'];passed+=['cross-batch duplicate serialization']
 # Revoke takes the role row first; pending commit authorization waits, then rejects.
 b,r=ready();block=Session();block.sql(f"begin;update private.staff_roles set active=false where user_id='{admin}';")
 f=pool.submit(call,f"select public.server_import_event_row('{admin}','{b}','{r}');",'revoked-before-commit');blocked('revoked-before-commit');block.sql('commit;');block.close();expect_error(f.result,'IMPORT_ADMIN_REQUIRED');assert not p.rows(b)[0]['resulting_event_id'];p.sql(f"update private.staff_roles set active=true where user_id='{admin}';");passed+=['role revoke before commit']
 b=p.upload(admin,[p.row(0,uuid.uuid4().hex)]);c=p.value(f"select public.server_claim_event_import_work('{admin}','{b}');")
 complete=f"select public.server_complete_event_import_geocode('{admin}','{b}','{c['rowId']}','{c['token']}',{c['revision']},{p.j(p.outcome())});"
 block=Session();block.sql(f"begin;update private.staff_roles set active=false where user_id='{admin}';");f=pool.submit(call,complete,'revoke-provider');blocked('revoke-provider');block.sql('commit;');block.close();expect_error(f.result,'IMPORT_ADMIN_REQUIRED');p.sql(f"update private.staff_roles set active=true where user_id='{admin}';");passed+=['revoked during provider work']
 # Cancellation wins before the outstanding provider completion.
 block=Session();block.sql(f"begin;select public.server_cancel_event_import_batch('{admin}','{b}');");f=pool.submit(call,complete,'cancel-provider');blocked('cancel-provider');block.sql('commit;');block.close();expect_error(f.result,'IMPORT_BATCH_CLOSED');assert p.rows(b)[0]['state']=='skipped';passed+=['cancel during geocode']
 b,r=ready();block=Session();block.sql(f"begin;select public.server_cancel_event_import_batch('{admin}','{b}');");f=pool.submit(call,f"select public.server_import_event_row('{admin}','{b}','{r}');",'cancel-import');blocked('cancel-import');block.sql('commit;');block.close();expect_error(f.result,'IMPORT_BATCH_CLOSED');assert not p.rows(b)[0]['resulting_event_id'];passed+=['cancel wins pending import']
 b,r=ready();block=Session();block.sql("begin;update private.event_import_settings set revision=revision+1;");f=pool.submit(call,f"select public.server_import_event_row('{admin}','{b}','{r}');",'config-import');blocked('config-import');block.sql('commit;');block.close();expect_error(f.result,'IMPORT_CONFIGURATION_CHANGED');assert not p.rows(b)[0]['resulting_event_id'];passed+=['destination revision changes mid-batch']
 b=p.upload(admin,[p.row(0,uuid.uuid4().hex)]);c=p.value(f"select public.server_claim_event_import_work('{admin}','{b}');");p.sql(f"update private.event_import_rows set lease_until=clock_timestamp()-interval '1 second' where id='{c['rowId']}';");new=p.value(f"select public.server_claim_event_import_work('{admin}','{b}');");assert c['token']!=new['token'];assert p.sql(f"select public.server_complete_event_import_geocode('{admin}','{b}','{c['rowId']}','{c['token']}',{c['revision']},{p.j(p.outcome())});")=='f';assert p.sql(f"select public.server_complete_event_import_geocode('{admin}','{b}','{new['rowId']}','{new['token']}',{new['revision']},{p.j(p.outcome())});")=='t';passed+=['stale lease fenced after real reclaim']
 # Hold the title lock across the real event start (next minute), then release the waiting RPC.
 import datetime
 from zoneinfo import ZoneInfo
 start_at=(datetime.datetime.now(ZoneInfo('America/Los_Angeles'))+datetime.timedelta(minutes=1)).replace(second=0,microsecond=0)
 source=p.row(0,uuid.uuid4().hex);end_at=start_at+datetime.timedelta(hours=1)
 source['input'].update(start_date=start_at.strftime('%Y-%m-%d'),start_time=start_at.strftime('%H:%M'),end_date=end_at.strftime('%Y-%m-%d'),end_time=end_at.strftime('%H:%M'),starts_at=start_at.isoformat(),ends_at=end_at.isoformat())
 b=p.upload(admin,[source]);r=p.verify(admin,b);p.select(admin,b,[r]);block=Session();block.sql(f"begin;select pg_advisory_xact_lock(hashtextextended('import-title:'||private.import_normalize('{source['input']['title']}'),0));")
 f=pool.submit(call,f"select public.server_import_event_row('{admin}','{b}','{r}');",'time-stale');blocked('time-stale')
 delay=max(0,start_at.timestamp()-time.time()+.2);time.sleep(delay);block.sql('commit;');block.close();assert json.loads(f.result())['kind']=='needs_review';assert p.rows(b)[0]['state']=='invalid';passed+=['real clock passes start during blocked import; revalidated after lock']

print(json.dumps({'passed':passed},indent=2));(p.EVIDENCE/'concurrency.json').write_text(json.dumps({'passed':passed},indent=2))
