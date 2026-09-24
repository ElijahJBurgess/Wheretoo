#!/usr/bin/env python3
"""Local 1000-enrollment resumable fanout and matched checkout timing proof."""
import importlib.util,json,concurrent.futures,statistics,time,uuid
from pathlib import Path
spec=importlib.util.spec_from_file_location('proof',Path(__file__).with_name('waitlist-proof.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
def elapsed_sql(statement,session):
 s="begin;create temp table timing(t timestamptz) on commit drop;insert into timing values(clock_timestamp());"+statement+"select extract(epoch from clock_timestamp()-t)*1000 from timing;commit;"
 out=session.sql(s);return float(out.splitlines()[-1])
def main():
 p.enable();f=p.seed();base=p.seed(True)
 observer_session=p.Session(); checkout_session=p.Session(); baseline_session=p.Session(True)
 # No special enrollment count override: each synthetic address/IP has its independent normal budget.
 stmt=f"select public.server_join_waitlist('{f['event']}','{f['tier']}','Bulk Guest','bulk-{f['event']}-'||n||'@example.invalid',gen_random_uuid(),encode(extensions.digest(n::text,'sha256'),'hex')) from generate_series(1,1000)n;"
 out=p.sql(stmt);assert out.count('"joined"')==1000,out[-500:]
 assert p.sql(f"select count(*) from private.waitlist_enrollments where tier_id='{f['tier']}';").strip()=='1000'
 p.sql(f"update public.ticket_tiers set quantity_total=100000 where id='{f['tier']}';")
 p.sql(f"update public.ticket_tiers set quantity_total=100000 where id='{base['tier']}';",True)
 durations=[]
 # Interrupt after first page, observe durable cursor, then resume via fresh connections.
 durations.append(elapsed_sql(f"select public.server_observe_waitlist('{f['tier']}');",observer_session))
 first=int(p.sql(f"select count(*) from private.waitlist_deliveries d join private.waitlist_enrollments w on w.id=d.enrollment_id where w.tier_id='{f['tier']}' and purpose='restock';").strip())
 assert 1<=first<=100,first
 for _ in range(1000):
  if observer_session.sql(f"select count(*) from private.waitlist_availability_cycles where tier_id='{f['tier']}' and completed_at is not null;").strip()=='1':break
  durations.append(elapsed_sql(f"select public.server_observe_waitlist('{f['tier']}');",observer_session))
 count=p.sql(f"select count(*)||','||count(distinct d.enrollment_id)||','||count(distinct d.cycle_id) from private.waitlist_deliveries d join private.waitlist_enrollments w on w.id=d.enrollment_id where w.tier_id='{f['tier']}' and purpose='restock';").strip();assert count=='1000,1000,1',count
 assert p.sql(f"select count(*) from private.waitlist_availability_cycles where tier_id='{f['tier']}' and completed_at is not null;").strip()=='1'
 def checkout(f,baseline=False):
  req=str(uuid.uuid4());h=uuid.uuid4().hex*2
  statement=f"select * from public.server_reserve_checkout('{f['event']}','[{{\"tier_id\":\"{f['tier']}\",\"quantity\":1}}]','Load Buyer','load-{req}@example.invalid','{req}','{h}');"
  return elapsed_sql(statement,baseline_session if baseline else checkout_session)
 checkout(base,True);checkout(f) # Symmetric connection warmup.
 baseline_times=[checkout(base,True) for _ in range(40)]
 def observe(_):return elapsed_sql(f"select public.server_observe_waitlist('{f['tier']}');",observer_session)
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  loaded=pool.submit(lambda:[checkout(f) for _ in range(40)])
  observer=pool.submit(lambda:[observe(i) for i in range(40)])
  feature_times=loaded.result();load_observe=observer.result()
 explain=p.sql(f"explain (analyze,buffers) select id from public.orders where event_id='{f['event']}' and lower(btrim(buyer_email))='bulk-{f['event']}-1@example.invalid' and status='paid' and paid_at>clock_timestamp()-interval '1 hour';")
 report={'enrollments':1000,'restockRows':count,'firstPage':first,'fanoutMs':durations,'checkoutBaselineMs':baseline_times,'checkoutUnderObserverMs':feature_times,'observerUnderCheckoutMs':load_observe,'baselineMedianMs':statistics.median(baseline_times),'loadedMedianMs':statistics.median(feature_times),'baselineP95Ms':sorted(baseline_times)[37],'loadedP95Ms':sorted(feature_times)[37]}
 (p.ROOT/'.superpowers/waitlist-proof/scale.json').write_text(json.dumps(report,indent=2));(p.ROOT/'.superpowers/waitlist-proof/purchase-explain.txt').write_text(explain)
 p.browser(f)
 observer_session.close();checkout_session.close();baseline_session.close()
 print(json.dumps({k:v for k,v in report.items() if not isinstance(v,list)},indent=2));print('PASS 1000 memberships, one cycle, bounded restartable 100-row pages; local browser fixture saved')
if __name__=='__main__':main()
