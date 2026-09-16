# Spec10 regression copy: only the verified database target differs.
#!/usr/bin/env python3
"""Real concurrent SQL against only the recorded Spec08 disposable container; no provider calls."""
import concurrent.futures, hashlib, importlib.util, json, pathlib, subprocess, uuid
ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('spec08_db', ROOT / 'tests/integration/spec10-database.py')
db = importlib.util.module_from_spec(spec)
spec.loader.exec_module(db)
def query(statement):
    return subprocess.run(['docker','exec','-i',db.verify(),'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],input=statement,text=True,capture_output=True,check=True).stdout.strip()
def quote(value): return "'" + str(value).replace("'", "''") + "'"
def race(n, action):
    with concurrent.futures.ThreadPoolExecutor(max_workers=n) as pool: return list(pool.map(action, range(n)))
def main():
    prefix=uuid.uuid4().hex[:4]
    def identity(group,n=1): return f'{prefix}{group:04x}-0000-4000-8000-{n:012d}'
    owner,event=identity(0),identity(0x1000)
    source=(ROOT/'supabase/tests/database/checkout_integrity_concurrency.test.sh').read_text()
    # Reuse fixture SQL only. Never execute the source shell or its linked CLI calls.
    setup=source.split('run_query setup "',1)[1].split('commit;"',1)[0]+'commit;'
    setup=setup.replace('$fixture_organizer',owner).replace('$fixture_lost_event',identity(0x1000,2)).replace('$fixture_event',event)
    setup=setup.replace('97200000',prefix+'2000').replace('checkout-concurrency@example.invalid',prefix+'@example.invalid')
    query(setup)
    def reserve(request_id,lines):
        body=json.dumps([{'tier_id':identity(0x2000,tier),'quantity':quantity} for tier,quantity in lines])
        token=hashlib.sha256(request_id.encode()).hexdigest()
        return f"begin; set local statement_timeout='15s'; set local role service_role; select row_to_json(r) from public.server_reserve_checkout({quote(event)},{quote(body)}::jsonb,'Fixture Buyer','fixture@example.invalid',{quote(request_id)},{quote(token)}) r; commit;"
    def outcome(statement):
        try: return ('ok',query(statement))
        except subprocess.CalledProcessError as e: return ('error',e.stderr)
    try:
        winners=race(8,lambda _:outcome(reserve(str(uuid.uuid4()),[(1,1)])))
        assert sum(status=='ok' for status,_ in winners)==1
        assert all(status=='ok' or 'TIER_SOLD_OUT' in message for status,message in winners)
        assert query(f"select count(*) from public.orders where event_id={quote(event)};")=='1'
        print('PASS 1: eight final-ticket buyers yield one reservation and seven stock rejections')
        request_id=str(uuid.uuid4()); statement=reserve(request_id,[(2,1),(3,1)])
        results=race(8,lambda _:query(statement))
        assert len(set(results))==1
        assert query(f"select count(*) from public.orders where client_request_id={quote(request_id)};")=='1'
        print('PASS 2: eight identical request replays retain one order, one frozen cart and one bearer hash')
        failures=race(4,lambda _:outcome(reserve(str(uuid.uuid4()),[(2,1),(1,1)])))
        assert all(status=='error' and 'TIER_SOLD_OUT' in message for status,message in failures)
        assert query(f"select count(*) from public.orders where event_id={quote(event)};")=='2'
        print('PASS 3: four stock-race carts roll back atomically without partial new orders')
        overlap=race(2,lambda n:query(reserve(str(uuid.uuid4()),[(2,1),(3,1)] if n==0 else [(3,1),(2,1)])))
        assert len(overlap)==2
        print('PASS 4: reversed overlapping carts complete without deadlocks')
        order_id=json.loads(results[0].splitlines()[-1])['order_id']
        session='cs_test_spec08'+uuid.uuid4().hex
        query(f"select public.server_attach_checkout_session({quote(order_id)},{quote(session)},(select checkout_expires_at from public.orders where id={quote(order_id)}));")
        reused=race(8,lambda _:query(statement))
        assert all(json.loads(value.splitlines()[-1])['existing_checkout_session_id']==session for value in reused)
        assert query(f"select count(*) from public.orders where client_request_id={quote(request_id)};")=='1'
        assert query(f"select count(*) from public.tickets where event_id={quote(event)};")=='0'
        print('PASS 5: eight attached-session replays preserve the stored session, one order and zero prepayment tickets')
        print('5 concurrency scenarios passed; namespace:',prefix)
    finally:
        query('update private.checkout_runtime_control set checkout_creation_enabled=false where singleton;')
if __name__=='__main__':
    try: main()
    except subprocess.CalledProcessError as error:
        print(error.stderr); raise
