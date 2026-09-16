#!/usr/bin/env python3
"""Deliberate notice submission races using the existing event lock and outbox."""
import concurrent.futures,importlib.util,json,pathlib,subprocess,time,uuid
ROOT=pathlib.Path(__file__).resolve().parents[2]
s=importlib.util.spec_from_file_location('race',ROOT/'tests/integration/spec10-cancellation-concurrency.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
def setup():
 owner,event,_=r.free()
 r.query('begin;'+r.auth(owner)+f"select public.save_owned_event_revision('{event}',(private.event_change_facts('{event}')-'disclosures')||jsonb_build_object('starts_at',now()+interval '3 days','ends_at',now()+interval '3 days 2 hours'));select public.accept_current_event_policies('{event}');select public.publish_event('{event}');commit;")
 preview=r.obj('begin;'+r.auth(owner)+f"select public.preview_owned_event_notice('{event}','event_change');commit;")
 assert preview['canSend'] and preview['eligibleMessages']==1
 return owner,event,preview['previewToken']
def submit(owner,event,token,request):return r.auth(owner)+f"select public.submit_owned_event_notice('{event}','event_change','{token}','{request}')"
def main():
 owner,event,token=setup();request=str(uuid.uuid4());app='spec10-notice-'+uuid.uuid4().hex
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
  with r.hold(event):
   futures=[pool.submit(r.query,f"begin;set local application_name='{app}';set local statement_timeout='20s';"+submit(owner,event,token,request)+';commit;') for _ in range(8)]
   deadline=time.monotonic()+12
   while int(r.query(f"select count(*) from pg_stat_activity where application_name='{app}' and wait_event_type='Lock';"))<8:
    assert time.monotonic()<deadline
    assert not any(f.done() for f in futures)
    time.sleep(.04)
  results=[f.result() for f in futures]
 assert len(set(results))==1
 assert r.query(f"select count(*) from private.event_notice_sources where event_id='{event}';")=='1'
 print('PASS: eight observed submit waiters preserve one immutable receipt and one source message',flush=True)
 for save_first in [True,False]:
  owner,event,token=setup();request=str(uuid.uuid4())
  save=r.auth(owner)+f"select public.save_owned_event_revision('{event}',(private.event_change_facts('{event}')-'disclosures')||'{{\"capacity\":4}}')"
  # Catch only the expected stale-review error so both transaction outcomes remain observable.
  send=r.auth(owner)+f"do $$begin perform public.submit_owned_event_notice('{event}','event_change','{token}','{request}');exception when raise_exception then if sqlerrm<>'NOTICE_CONTEXT_CONFLICT' then raise;end if;end$$"
  r.race(event,*([save,send] if save_first else [send,save]))
  assert r.query(f"select count(*) from private.ticket_email_outbox q join private.event_notice_sources n on n.attempt_id=q.id where n.event_id='{event}' and q.state='queued';")=='0'
  context=r.obj('begin;'+r.auth(owner)+f"select public.get_owned_event_change_context('{event}');commit;")
  assert context['notice_required'] is True
  assert r.query(f"select count(*) from private.event_notice_sources where event_id='{event}';")==('0' if save_first else '1')
  print(f'PASS: save/submit observed waiters, save first={save_first}; stale unsent work cannot dispatch and fresh review remains required',flush=True)
 print('3 notice concurrency scenarios passed')
if __name__=='__main__':
 try:main()
 except subprocess.CalledProcessError as e:print(e.stderr);raise
