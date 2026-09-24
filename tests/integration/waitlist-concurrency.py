#!/usr/bin/env python3
"""Real separate-connection races on the dedicated local Waitlist stack."""
import importlib.util,concurrent.futures,subprocess,uuid,json,time
from pathlib import Path
spec=importlib.util.spec_from_file_location('proof',Path(__file__).with_name('waitlist-proof.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
results=[]
def check(value,label):
 assert value,label;results.append(label);print('PASS',label,flush=True)
def join(f,email=None,request=None):
 return f"select public.server_join_waitlist('{f['event']}','{f['tier']}','Buyer','{email or str(uuid.uuid4())+'@example.invalid'}','{request or uuid.uuid4()}','{uuid.uuid4().hex*2}');"
def obj(output):return json.loads(next(x for x in output.splitlines() if x.startswith('{')))
def blocker(f,change='',seconds=.6):
 process=subprocess.Popen(['docker','exec','-i',p.DB,'psql','-X','-U','postgres','-At','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 process.stdin.write(f"begin;select public.lock_event_ticketing_operation('{f['event']}');{change}select 'LOCKED';select pg_sleep({seconds});commit;\n");process.stdin.close()
 while process.stdout.readline().strip()!='LOCKED':
  if process.poll() is not None:raise RuntimeError(process.stderr.read())
 return process
def wait(process):
 process.wait(timeout=10);assert process.returncode==0,process.stderr.read()
def main():
 p.enable();f=p.seed();email=str(uuid.uuid4())+'@example.invalid';req=str(uuid.uuid4());statement=join(f,email,req)
 with concurrent.futures.ThreadPoolExecutor(2) as pool:r=list(pool.map(p.sql,[statement,statement]))
 check(all(obj(x)['kind'] in ['joined','WAITLIST_UNAVAILABLE'] for x in r),'concurrent duplicate attempts safe')
 check(p.sql(f"select count(*) from private.waitlist_enrollments where tier_id='{f['tier']}';").strip()=='1','duplicate creates one enrollment')
 check(p.sql(f"select count(*) from private.waitlist_deliveries d join private.waitlist_enrollments w on w.id=d.enrollment_id where tier_id='{f['tier']}';").strip()=='1','duplicate creates one confirmation')
 lock=blocker(f,f"update public.ticket_tiers set quantity_total=3 where id='{f['tier']}';")
 start=time.monotonic();r=obj(p.sql(join(f)));elapsed=time.monotonic()-start
 check(r['kind']=='WAITLIST_UNAVAILABLE' and elapsed<.6,'join yields instead of blocking checkout lock');wait(lock)
 check(obj(p.sql(join(f)))['kind']=='TICKETS_AVAILABLE','capacity reopen before retry prevents enrollment')
 statement=f"select public.server_observe_waitlist('{f['tier']}');"
 with concurrent.futures.ThreadPoolExecutor(2) as pool:r=list(pool.map(p.sql,[statement,statement]))
 check(p.sql(f"select count(*) from private.waitlist_availability_cycles where tier_id='{f['tier']}';").strip()=='1','two observers create one cycle')
 check(p.sql(f"select count(*) from private.waitlist_deliveries d join private.waitlist_enrollments w on w.id=d.enrollment_id where tier_id='{f['tier']}' and purpose='restock';").strip()=='1','two observers create one restock membership')
 # Expiry is sampled after the lock boundary, not from an earlier browser observation.
 x=p.seed();p.sql(f"set session_replication_role=replica;update public.orders set reservation_expires_at=clock_timestamp()+interval '0.35 seconds' where event_id='{x['event']}';")
 lock=blocker(x,seconds=.5);r=obj(p.sql(join(x)));wait(lock)
 check(r['kind']=='WAITLIST_UNAVAILABLE','expiry race defers occupied boundary')
 check(obj(p.sql(join(x)))['kind']=='TICKETS_AVAILABLE','expired hold excluded without running expiry cron')
 # Start/cancellation while a caller would otherwise wait cannot admit stale demand.
 x=p.seed();lock=blocker(x,f"set local session_replication_role=replica;update public.events set starts_at=clock_timestamp()-interval '1 second' where id='{x['event']}';")
 check(obj(p.sql(join(x)))['kind']=='WAITLIST_UNAVAILABLE','start race yields');wait(lock)
 check(obj(p.sql(join(x)))['kind']=='WAITLIST_UNAVAILABLE','started event stays closed after boundary')
 x=p.seed();lock=blocker(x,f"update public.events set status='cancelled' where id='{x['event']}';")
 check(obj(p.sql(join(x)))['kind']=='WAITLIST_UNAVAILABLE','cancellation race yields');wait(lock)
 check(obj(p.sql(join(x)))['kind']=='WAITLIST_UNAVAILABLE','cancelled event cannot join')
 # A second observed sellout/reopen creates a new epoch, continuous available never does.
 p.sql(f"update public.ticket_tiers set quantity_total=2 where id='{f['tier']}';select public.server_observe_waitlist('{f['tier']}');update public.ticket_tiers set quantity_total=3 where id='{f['tier']}';select public.server_observe_waitlist('{f['tier']}');select public.server_observe_waitlist('{f['tier']}');")
 check(p.sql(f"select count(*) from private.waitlist_availability_cycles where tier_id='{f['tier']}';").strip()=='2','later observed cycle distinct; continuous available silent')
 # Unobserved pulse is deliberately not synthesized.
 p.sql(f"update public.ticket_tiers set quantity_total=2 where id='{f['tier']}';update public.ticket_tiers set quantity_total=3 where id='{f['tier']}';select public.server_observe_waitlist('{f['tier']}');")
 check(p.sql(f"select count(*) from private.waitlist_availability_cycles where tier_id='{f['tier']}';").strip()=='2','polling limitation: unseen sellout not invented')
 (p.ROOT/'.superpowers/waitlist-proof/concurrency.json').write_text(json.dumps(results,indent=2))
if __name__=='__main__':main()
