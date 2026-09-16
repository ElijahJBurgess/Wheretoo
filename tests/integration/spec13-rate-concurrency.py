#!/usr/bin/env python3
"""Race only the final allowed Spec 13 request; never consume another quota."""
import concurrent.futures,hashlib,importlib.util,json,pathlib,subprocess,time,uuid
ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('db',ROOT/'tests/integration/spec13-database.py');db=importlib.util.module_from_spec(spec);spec.loader.exec_module(db)
def query(sql):
 return subprocess.run(['docker','exec','-i',db.verify(),'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],input=sql,text=True,capture_output=True,check=True).stdout.strip()
identity=hashlib.sha256(uuid.uuid4().bytes).hexdigest()
seconds=float(query('select extract(second from clock_timestamp());'))
if seconds>45:time.sleep(61-seconds)
try:
 query(f"insert into private.discovery_read_rate_buckets values('{identity}',date_trunc('minute',clock_timestamp()),59);")
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
  results=list(pool.map(lambda _:json.loads(query(f"select public.server_consume_discovery_read_rate_limit('{identity}');")),range(8)))
 assert sum(r['allowed'] for r in results)==1,results
 assert all(1<=r['retryAfterSeconds']<=60 for r in results if not r['allowed'])
 assert query(f"select max(attempts) from private.discovery_read_rate_buckets where identity_hash='{identity}';")=='61'
 print('PASS: eight concurrent requests race final slot; exactly one allowed, seven denied, counter capped at 61.')
finally:
 query(f"delete from private.discovery_read_rate_buckets where identity_hash='{identity}';")
