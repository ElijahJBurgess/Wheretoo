#!/usr/bin/env python3
"""Local-only Waitlist SQL/fixture utilities; rejects any other database/port."""
from pathlib import Path
import subprocess,json,uuid,base64,hashlib,hmac,time
ROOT=Path(__file__).resolve().parents[2]
DB='supabase_db_wheretoo-waitlist'
def sql(statement,baseline=False):
 db=DB+('-baseline' if baseline else '')
 inspect=json.loads(subprocess.check_output(['docker','inspect',db],text=True))[0]
 assert inspect['Name']=='/'+db
 assert all(p['HostPort']==('64322' if baseline else '63322') for p in inspect['NetworkSettings']['Ports']['5432/tcp'])
 result=subprocess.run(['docker','exec','-i',db,'psql','-X','-U','postgres','-At','-v','ON_ERROR_STOP=1'],input=statement,text=True,capture_output=True)
 if result.returncode:raise RuntimeError(result.stderr)
 return result.stdout

def expand(path):
 return '\n'.join(expand(path.parent/line[4:]) if line.startswith('\\ir ') else line for line in path.read_text().splitlines())

def seed(baseline=False):
 salt=uuid.uuid4().hex
 mapping={p:uuid.uuid4().hex[:8] for p in ['a6100000','a6200000','a6300000','a6400000']}
 source=expand(ROOT/'supabase/tests/database/helpers/spec09_refund_setup.inc')
 for old,new in mapping.items():source=source.replace(old,new)
 for name in ['integrity-owner','integrity-other','synthetic-buyer']:source=source.replace(name+'@',name+'-'+salt+'@')
 source=source.replace('acct_integrityfulfillment','acct_'+salt).replace('cs_test_integrityclean','cs_test_'+salt).replace("repeat('1',64)","'"+hashlib.sha256(salt.encode()).hexdigest()+"'")
 s="begin;select private.configure_policy_environment('development');grant select on public.orders,public.order_items,public.tickets to service_role;"+source+"reset role;revoke select on public.orders,public.order_items,public.tickets from service_role;"
 def id(p,n=1):return mapping[p]+'-0000-4000-8000-'+str(n).zfill(12)
 event=id('a6200000');tier=id('a6300000');owner=id('a6100000')
 s+=f"update public.organizers set onboarding_completed_at=clock_timestamp(),organizer_type='Community organizer' where id in ('{owner}','{id('a6100000',2)}');update public.ticket_tiers set quantity_total=2 where id='{tier}';commit;"
 sql(s,baseline)
 local=ROOT/('.supabase/waitlist-baseline' if baseline else '.supabase/waitlist');(local/'.proof-fixtures-present').write_text('Synthetic local fixtures; reset dedicated stack before legacy comparisons.\n')
 return dict(event=event,tier=tier,otherTier=id('a6300000',2),owner=owner,otherOwner=id('a6100000',2),email='synthetic-buyer-'+salt+'@example.invalid',account='acct_'+salt)

def enable():
 sql("select public.server_configure_waitlist('{\"acceptingJoins\":true,\"observerEnabled\":true,\"deliveryEnabled\":true,\"senderEmail\":\"notify@example.invalid\",\"replyTo\":\"support@example.invalid\",\"appOrigin\":\"https://waitlist-proof.example.invalid\",\"capacityMinute\":10000,\"capacityDay\":10000,\"capacityMonth\":10000}');select public.server_acknowledge_waitlist_worker();")

def browser(f):
 status=json.loads(subprocess.check_output(['pnpm','exec','supabase','status','--workdir',str(ROOT/'.supabase/waitlist'),'-o','json'],cwd=ROOT,text=True,stderr=subprocess.DEVNULL))
 assert status['API_URL']=='http://127.0.0.1:63321'
 def jwt(owner):
  enc=lambda x:base64.urlsafe_b64encode(json.dumps(x,separators=(',',':')).encode()).decode().rstrip('=')
  raw=enc({'alg':'HS256','typ':'JWT'})+'.'+enc({'sub':owner,'role':'authenticated','aud':'authenticated','iss':status['API_URL']+'/auth/v1','iat':int(time.time()),'exp':int(time.time())+14400})
  return raw+'.'+base64.urlsafe_b64encode(hmac.new(status['JWT_SECRET'].encode(),raw.encode(),hashlib.sha256).digest()).decode().rstrip('=')
 data={**f,'api':status['API_URL'],'anon':status['ANON_KEY'],'service':status['SERVICE_ROLE_KEY'],'token':jwt(f['owner']),'otherToken':jwt(f['otherOwner']),'origin':'http://127.0.0.1:3088','edge':'http://127.0.0.1:63330'}
 target=ROOT/'.superpowers/waitlist-proof/browser.json';target.write_text(json.dumps(data));target.chmod(0o600)
 return data

class Session:
 """Persistent local connection: matches pooled RPC planning, with independent transactions."""
 def __init__(self,baseline=False):
  sql('select 1',baseline) # Validate exact local container/port before opening.
  self.p=subprocess.Popen(['docker','exec','-i',DB+('-baseline' if baseline else ''),'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 def sql(self,statement):
  marker='end_'+uuid.uuid4().hex
  self.p.stdin.write(statement+"\nselect '"+marker+"';\n");self.p.stdin.flush()
  lines=[]
  while True:
   line=self.p.stdout.readline()
   if not line:raise RuntimeError(self.p.stderr.read())
   if line.strip()==marker:return '\n'.join(lines)
   lines.append(line.rstrip())
 def close(self):
  self.p.stdin.close();self.p.wait(timeout=10)

def fulfill(f):
 """Use existing authoritative webhook/fulfillment functions with a synthetic manifest."""
 source=expand(ROOT/'supabase/tests/database/helpers/spec09_refund_setup.inc')
 start=source.index('create or replace function pg_temp.record_and_fulfill(')
 functions=expand(ROOT/'supabase/tests/database/helpers/ticket_manifest.inc')+'\n'+source[start:]
 functions=functions.replace('acct_integrityfulfillment',f['account'])
 suffix='wl'+uuid.uuid4().hex
 return sql('begin;'+functions+f"select pg_temp.record_and_fulfill('{suffix}','{suffix}',id,stripe_checkout_session_id) from public.orders where event_id='{f['event']}' and buyer_email='{f['email']}';commit;")
