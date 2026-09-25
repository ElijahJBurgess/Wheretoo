#!/usr/bin/env python3
"""Dedicated localhost-only CSV import proof; no linked project or provider requests."""
from pathlib import Path
import subprocess,json,uuid,hashlib,datetime
from zoneinfo import ZoneInfo
ROOT=Path(__file__).resolve().parents[2]
DB='supabase_db_wheretoo-event-import'
EVIDENCE=ROOT/'.superpowers/sdd/2026-09-24-csv-event-import-v1'
EVIDENCE.mkdir(parents=True,exist_ok=True)
def sql(statement,baseline=False):
 db=DB+('-baseline' if baseline else '')
 inspect=json.loads(subprocess.check_output(['docker','inspect',db],text=True))[0]
 assert inspect['Name']=='/'+db
 assert all(p['HostPort']==('65322' if baseline else '60322') for p in inspect['NetworkSettings']['Ports']['5432/tcp'])
 p=subprocess.run(['docker','exec','-i',db,'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1'],input=statement,text=True,capture_output=True)
 if p.returncode:raise RuntimeError(p.stderr)
 return p.stdout.strip()
class Session:
 """Guarded persistent local connection, one autocommitted transaction per call."""
 def __init__(self):
  sql('select 1')
  self.p=subprocess.Popen(['docker','exec','-i',DB,'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 def sql(self,statement):
  marker='end_'+uuid.uuid4().hex
  self.p.stdin.write(statement+"\nselect '"+marker+"';\n");self.p.stdin.flush();lines=[]
  while True:
   line=self.p.stdout.readline()
   if not line:raise RuntimeError(self.p.stderr.read())
   if line.strip()==marker:return '\n'.join(lines)
   lines.append(line.rstrip())
 def close(self):
  if self.p.poll() is None:self.p.stdin.close();self.p.wait(timeout=10)
def quote(s):return "'"+str(s).replace("'","''")+"'"
def j(v):return quote(json.dumps(v))+ '::jsonb'
def value(statement):return json.loads(sql(statement).splitlines()[-1])
def seed():
 actors={k:str(uuid.uuid4()) for k in ['owner','admin','moderator','inactive','buyer','other']}
 s='begin;'
 for k,v in actors.items():s+=f"insert into auth.users(id,email,aud,role,instance_id,email_confirmed_at,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change) values('{v}','{v}@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now(),now(),'','','','');"
 for k in ['owner','admin','other']:s+=f"insert into public.organizers(id,display_name,onboarding_completed_at) values('{actors[k]}','Import {k}',now());"
 for k in ['owner','admin','moderator','inactive']:s+=f"insert into private.staff_roles(user_id,role,active,granted_by) values('{actors[k]}','{'moderator' if k=='moderator' else 'admin'}',{'false' if k=='inactive' else 'true'},'{actors['owner']}');"
 s+=f"update private.event_import_settings set enabled=true,destination_organizer_id='{actors['owner']}',revision=revision+1,provider_paused=false,budget_used=0,budget_limit=2500;commit;"
 sql(s);return actors
def row(n,title=None):
 start=datetime.datetime.now(ZoneInfo('America/Los_Angeles')).replace(hour=12,minute=0,second=0,microsecond=0)+datetime.timedelta(days=30)
 end=start+datetime.timedelta(hours=2)
 i=dict(title=title or f'CSV gathering {n}',description='A community gathering with neighbors and friends.',category='community',venue_name='Civic Hall',address='1 Market St',city='San Francisco',postal_code='94105',start_date=start.strftime('%Y-%m-%d'),start_time='12:00',end_date=end.strftime('%Y-%m-%d'),end_time='14:00',starts_at=start.isoformat(),ends_at=end.isoformat(),capacity=None,source_url='',source_name='',notes='private fixture')
 return dict(recordNumber=n+2,startLine=n+2,input=i,errors=[])
def upload(actor,rows,request=None,filename='events.csv'):
 request=request or str(uuid.uuid4());digest=hashlib.sha256(json.dumps(rows).encode()).hexdigest()
 return sql(f"select public.server_create_event_import_batch('{actor}','{request}','{digest}',{quote(filename)},{j(rows)});")
def outcome(n=0):return dict(kind='verified',location=dict(mapbox_feature_id=f'import.fixture.{n}',address_line1='1 Market St',address_line2=None,city='San Francisco',region='CA',postal_code='94105',country_code='US',latitude=37.7936,longitude=-122.3958),evidence=dict(policy=1,confidence='exact',accuracy='rooftop'))
def verify(actor,batch,result=None):
 c=value(f"select public.server_claim_event_import_work('{actor}','{batch}');")
 assert c['kind']=='claimed',c
 sql(f"select public.server_complete_event_import_geocode('{actor}','{batch}','{c['rowId']}','{c['token']}',{c['revision']},{j(result or outcome())});")
 return c['rowId']
def rows(batch):return value(f"select coalesce(jsonb_agg(to_jsonb(r) order by record_number),'[]') from private.event_import_rows r where batch_id='{batch}';")
def select(actor,batch,ids):
 rs=[r for r in rows(batch) if r['id'] in ids]
 payload=[dict(rowId=r['id'],expectedRevision=r['revision'],expectedDuplicateDigest=r['duplicate_digest']) for r in rs]
 sql(f"select public.server_request_event_import_rows('{actor}','{batch}',{j(payload)});")
def imported(actor,batch,r):return value(f"select public.server_import_event_row('{actor}','{batch}','{r}');")
def main():
 a=seed();r=row(0,'Unique '+uuid.uuid4().hex);request=str(uuid.uuid4());b=upload(a['admin'],[r],request)
 assert upload(a['admin'],[r],request)==b
 try:upload(a['admin'],[row(1)],request);raise AssertionError('conflict allowed')
 except RuntimeError as e:assert 'IMPORT_REQUEST_CONFLICT' in str(e)
 for k in ['moderator','inactive','buyer','other']:
  try:upload(a[k],[r]);raise AssertionError(k+' allowed')
  except RuntimeError as e:assert 'IMPORT_ADMIN_REQUIRED' in str(e)
 rid=verify(a['admin'],b);select(a['admin'],b,[rid]);res=imported(a['admin'],b,rid);assert res['kind']=='imported',res
 for _ in range(3):assert imported(a['admin'],b,rid)==res
 e=value(f"select to_jsonb(e) from public.events e where id='{res['eventId']}';")
 assert e['organizer_id']==a['owner'] and e['status']=='draft' and e['admission_type']=='free' and e['capacity'] is None
 assert e['moderation_status']=='not_evaluated' and e['public_history_status']=='never_public' and e['artwork_path'] is None and e['location']
 for t in ['ticket_tiers','free_registrations','tickets']:assert sql(f"select count(*) from public.{t} where event_id='{e['id']}';")=='0'
 assert sql(f"select count(*) from private.event_policy_acceptances where event_id='{e['id']}';")=='0'
 sql(f"update private.event_import_settings set enabled=false;")
 assert imported(a['admin'],b,rid)==res
 sql(f"update private.event_import_settings set enabled=true;")
 print('PASS: upload replay/conflict, four denied identities, canonical draft, row replay, disabled-gate replay, no ticket/consent side effects')
 (EVIDENCE/'proof-fixture.json').write_text(json.dumps(dict(actors=a,batch=b,row=rid,event=e['id'])))
if __name__=='__main__':main()
