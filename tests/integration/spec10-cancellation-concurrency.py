#!/usr/bin/env python3
"""Observed cancellation races on only the recorded Spec10 disposable database."""
import concurrent.futures, contextlib, importlib.util, json, pathlib, subprocess, time, uuid
ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('db',ROOT/'tests/integration/spec10-database.py');db=importlib.util.module_from_spec(spec);spec.loader.exec_module(db)
def command(): return ['docker','exec','-i',db.verify(),'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres']
def query(s): return subprocess.run(command(),input=s,text=True,capture_output=True,check=True,timeout=30).stdout.strip()
def quote(v): return "'"+str(v).replace("'","''")+"'"
def obj(s): return json.loads(next(x for x in reversed(query(s).splitlines()) if x.startswith(('{','['))))
def auth(owner): return f"select set_config('request.jwt.claim.sub',{quote(owner)},true);"
@contextlib.contextmanager
def hold(event):
 p=subprocess.Popen(command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 try:
  p.stdin.write(f"begin; select public.lock_event_ticketing_operation({quote(event)}); select 'HELD';\n");p.stdin.flush()
  while p.stdout.readline().strip()!='HELD':
   if p.poll() is not None: raise RuntimeError(p.stderr.read())
  yield
 finally:
  p.stdin.write('rollback;\n\\q\n');p.stdin.flush();p.wait(timeout=20)
  assert p.returncode==0,p.stderr.read()
  p.stdin.close();p.stdout.close();p.stderr.close()
def race(event,first,second):
 app='spec10-cancel-'+uuid.uuid4().hex
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  with hold(event):
   futures=[]
   for index,s in enumerate([first,second],1):
    futures.append(pool.submit(query,f"begin;set local application_name={quote(app)};set local statement_timeout='20s';{s};commit;"))
    deadline=time.monotonic()+12
    while int(query(f"select count(*) from pg_stat_activity where application_name={quote(app)} and wait_event_type='Lock';"))<index:
     assert time.monotonic()<deadline,'Missing observed lock waiter'
     assert not any(f.done() for f in futures),'Race escaped event lock'
     time.sleep(.04)
  return [f.result(timeout=25) for f in futures]
def paid(fulfilled):
 nonce=uuid.uuid4().hex;prefixes={x:uuid.uuid4().hex[:8] for x in ['a6100000','a6200000','a6300000','a6400000']}
 s=db.expand(ROOT/'supabase/tests/database/helpers/spec09_refund_setup.inc')
 for old,new in prefixes.items(): s=s.replace(old,new)
 s=s.replace('integrity',nonce).replace("repeat('1',64)",quote(nonce*2))
 owner=prefixes['a6100000']+'-0000-4000-8000-000000000001';event=prefixes['a6200000']+'-0000-4000-8000-000000000001'
 helper=s[s.index('create function pg_temp.ticket_manifest'):]
 ending=f"select pg_temp.record_and_fulfill({quote(nonce)},{quote(nonce)},id,session_id) from fulfillment_orders;" if fulfilled else ''
 query('begin;'+s+ending+'commit;')
 order=query(f'select id from public.orders where event_id={quote(event)};')
 fulfill=helper+f"select pg_temp.record_and_fulfill({quote(nonce)},{quote(nonce)},{quote(order)},(select stripe_checkout_session_id from public.orders where id={quote(order)}))"
 return owner,event,order,fulfill

def free():
 nonce=uuid.uuid4().hex;prefixes={x:uuid.uuid4().hex[:8] for x in ['b6100000','b6200000','b6300000']}
 s=db.expand(ROOT/'supabase/tests/database/free_registration_fixture.inc')
 for old,new in prefixes.items():s=s.replace(old,new)
 s=s.replace('free-owner@example.invalid',nonce+'@example.invalid').replace('free-other@example.invalid','other'+nonce+'@example.invalid')
 s=s.replace("'proof:'",quote(nonce+':proof:')).replace('pg_temp.free_manifest(p_qty,p_number::text)',"pg_temp.free_manifest(p_qty,"+quote(nonce)+"||p_number::text)")
 owner=prefixes['b6100000']+'-0000-4000-8000-000000000001';event=prefixes['b6200000']+'-0000-4000-8000-000000000001'
 query('begin;'+s+'select pg_temp.register(1,2);commit;')
 helpers=s[s.index('create function pg_temp.free_manifest'):]
 return owner,event,helpers

def main():
 for cancel_first in [True,False]:
  owner,event,order,fulfill=paid(False)
  cancel=auth(owner)+f'select public.cancel_owned_event({quote(event)})'
  race(event,*([cancel,fulfill] if cancel_first else [fulfill,cancel]))
  result=obj(f"select jsonb_build_object('status',status,'paid',paid_at is not null,'tickets',(select count(*) from public.tickets where order_id=o.id),'valid',(select count(*) from public.tickets where order_id=o.id and status='valid')) from public.orders o where id={quote(order)};")
  assert result==({'status':'requires_review','paid':True,'tickets':0,'valid':0} if cancel_first else {'status':'paid','paid':True,'tickets':3,'valid':0}),result
  print('PASS: cancellation/fulfillment observed waiters, cancellation first='+str(cancel_first)+', truthful received payment and no usable admission',flush=True)
 for kind in ['paid','free']:
  for cancel_first in [True,False]:
   if kind=='paid':owner,event,order,_=paid(True)
   else:owner,event,_=free()
   ticket=obj(f'select to_jsonb(t) from public.tickets t where event_id={quote(event)} order by id limit 1;')
   cancel=auth(owner)+f'select public.cancel_owned_event({quote(event)})'
   redeem=f"select public.server_redeem_organizer_ticket({quote(owner)},{quote(event)},{quote(ticket['credential_hash'])})"
   race(event,*([cancel,redeem] if cancel_first else [redeem,cancel]))
   after=obj(f'select to_jsonb(t) from public.tickets t where id={quote(ticket["id"])};')
   assert after['id']==ticket['id'] and after['credential_hash']==ticket['credential_hash']
   assert after['status']==('cancelled' if cancel_first else 'used')
   assert (after['used_at'] is not None)==(not cancel_first)
   assert query(f"select count(*) from public.tickets where event_id={quote(event)} and status='valid';")=='0'
   retry=query(redeem)
   assert obj(f'select to_jsonb(t) from public.tickets t where id={quote(ticket["id"])};')==after
   print(f'PASS: {kind} cancellation/admission observed waiters, cancellation first={cancel_first}; Used timestamp and credential identity stable',flush=True)
 for cancel_first in [True,False]:
  owner,event,helpers=free()
  cancel=auth(owner)+f'select public.cancel_owned_event({quote(event)})'
  register=helpers+'select pg_temp.register(2,1)'
  race(event,*([cancel,register] if cancel_first else [register,cancel]))
  assert query(f"select count(*) from public.tickets where event_id={quote(event)} and status='valid';")=='0'
  assert query(f"select count(*) from public.free_registrations where event_id={quote(event)};")==('1' if cancel_first else '2')
  assert query(f"select count(*) from public.orders where event_id={quote(event)};")=='0'
  print(f'PASS: cancellation/free issuance observed waiters, cancellation first={cancel_first}; no paid order or active admission',flush=True)
 print('8 cancellation race scenarios passed')
if __name__=='__main__':
 try:main()
 except subprocess.CalledProcessError as e:print(e.stderr);raise
 finally:query('update private.checkout_runtime_control set checkout_creation_enabled=false; update private.ticket_email_settings set worker_enabled=false,enabled_at=null,limits=null;')
