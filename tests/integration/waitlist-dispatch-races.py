#!/usr/bin/env python3
"""Authoritative purchase and independent-connection dispatch/leave/refund barriers."""
import importlib.util,json,uuid,concurrent.futures,subprocess,time
from pathlib import Path
s=importlib.util.spec_from_file_location('c',Path(__file__).with_name('waitlist-concurrency.py'));c=importlib.util.module_from_spec(s);s.loader.exec_module(c);p=c.p
check=c.check
ENV="'{\"version\":1,\"keyId\":\"local\",\"nonce\":\"AAAAAAAAAAAAAAAA\",\"ciphertext\":\"AAAAAAAAAAAAAAAAAAAAAA\"}'"
def prepare(f,purpose='confirmation'):
 lease=str(uuid.uuid4());token=uuid.uuid4().hex*2
 out=p.sql(f"update private.waitlist_deliveries d set lease_id='{lease}',lease_until=clock_timestamp()+interval '2 minutes' from private.waitlist_enrollments w where w.id=d.enrollment_id and w.event_id='{f['event']}' and purpose='{purpose}' and d.first_possible_dispatch_at is null returning d.id;")
 attempt=out.splitlines()[0]
 assert 't' in p.sql(f"select public.server_save_waitlist_payload('{attempt}','{lease}',{ENV},'{token}',(select private.ticket_email_fingerprint(private.waitlist_facts(enrollment_id)::text) from private.waitlist_deliveries where id='{attempt}'));")
 return attempt,lease,token

def main():
 p.enable();f=p.seed();p.sql(c.join(f,f['email']));p.fulfill(f)
 p.sql(f"update public.ticket_tiers set quantity_total=3 where id='{f['tier']}';select public.server_observe_waitlist('{f['tier']}');")
 check(p.sql(f"select lifecycle from private.waitlist_enrollments where event_id='{f['event']}';").strip()=='purchased','real purchase before cycle membership suppresses enrollment')
 f=p.seed();p.sql(c.join(f,f['email']));attempt,lease,token=prepare(f);p.fulfill(f)
 check(p.sql(f"select public.server_begin_waitlist_dispatch('{attempt}','{lease}') is null;").strip()=='t','real purchase after preparation but before first dispatch stops send')
 check(p.sql(f"select lifecycle from private.waitlist_enrollments where event_id='{f['event']}';").strip()=='purchased','dispatch reconciliation observes paid truth')
 # A refund release crosses the same ticketing boundary; use authoritative paid facts first.
 f=p.seed();p.fulfill(f);lock=c.blocker(f,f"set local session_replication_role=replica;update public.orders set status='refunded',refunded_at=clock_timestamp() where event_id='{f['event']}';")
 check(c.obj(p.sql(c.join(f)))['kind']=='WAITLIST_UNAVAILABLE','join yields to refund boundary');c.wait(lock)
 check(c.obj(p.sql(c.join(f)))['kind']=='TICKETS_AVAILABLE','refunded inventory is available after lock release')
 # Leave owns the enrollment row while delivery attempts to acquire the event boundary.
 f=p.seed();p.sql(c.join(f));attempt,lease,token=prepare(f)
 process=subprocess.Popen(['docker','exec','-i',p.DB,'psql','-X','-U','postgres','-At','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 process.stdin.write(f"begin;select public.server_leave_waitlist('{token}','{uuid.uuid4().hex*2}');select 'LOCKED';select pg_sleep(.5);commit;\n");process.stdin.close()
 while process.stdout.readline().strip()!='LOCKED':
  if process.poll() is not None:raise RuntimeError(process.stderr.read())
 start=time.monotonic();p.sql(f"select public.server_observe_waitlist('{f['tier']}');");check(time.monotonic()-start<.3,'observer never waits on leave while holding checkout boundary')
 check(p.sql(f"select public.server_begin_waitlist_dispatch('{attempt}','{lease}') is null;").strip()=='t','leave contention defers dispatch without provider call');c.wait(process)
 check(p.sql(f"select public.server_begin_waitlist_dispatch('{attempt}','{lease}') is null;").strip()=='t','committed leave prevents first dispatch')
 # Two delivery workers with the same lease cannot debit/send twice.
 f=p.seed();p.sql(c.join(f));attempt,lease,token=prepare(f)
 query=f"select public.server_begin_waitlist_dispatch('{attempt}','{lease}') is not null;"
 with concurrent.futures.ThreadPoolExecutor(2) as pool:out=list(pool.map(p.sql,[query,query]))
 check(sum(x.strip()=='t' for x in out)==1,'concurrent first dispatch reserves one possible send')
 check(p.sql(f"select dispatch_count from private.waitlist_deliveries where id='{attempt}';").strip()=='1','one dispatch budget debit')
 p.sql(f"select public.server_leave_waitlist('{token}','{uuid.uuid4().hex*2}');select public.server_finish_waitlist_dispatch('{attempt}','{lease}','unknown');")
 check(p.sql(f"select state from private.waitlist_deliveries where id='{attempt}';").strip()=='unknown','leave after possible send preserves unknown provider truth')
 # Moderation holds the event boundary. Observer must defer rather than wait.
 f=p.seed();p.sql(c.join(f));lock=c.blocker(f,f"set local session_replication_role=replica;update public.events set moderation_status='blocked' where id='{f['event']}';")
 check(c.obj(p.sql(f"select public.server_observe_waitlist('{f['tier']}');"))['kind']=='deferred','observer yields during moderation');c.wait(lock)
 check(c.obj(p.sql(f"select public.server_observe_waitlist('{f['tier']}');"))['kind']=='closed','observer closes blocked event after boundary')
 (p.ROOT/'.superpowers/waitlist-proof/dispatch-races.json').write_text(json.dumps(c.results,indent=2))
if __name__=='__main__':main()
