"""Offline-provider proof against ONLY the dedicated local AI-cover stack.
Start it using tests/integration/run-ai-cover-local.py; never accepts hosted URLs.
"""
import concurrent.futures
import json
import struct
import subprocess
import urllib.error
import urllib.request
import uuid
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LOCAL = ROOT / '.supabase/ai-cover'
CONFIG = json.loads(subprocess.check_output(['corepack', 'pnpm@11.19.0', 'exec', 'supabase', 'status', '--workdir', str(LOCAL), '-o', 'json'], cwd=ROOT, text=True, stderr=subprocess.DEVNULL))
BASE = CONFIG['API_URL']
assert BASE == 'http://127.0.0.1:56321'
DB = 'supabase_db_wheretoo-ai-cover-phase1'
checks = []

def sql(query):
    return subprocess.check_output(['docker', 'exec', '-i', DB, 'psql', '-X', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], input=query, text=True).strip()

def http(path, token=None, body=None, method='POST', mime='application/json', extra=None):
    raw = body if isinstance(body, bytes) else json.dumps(body).encode() if body is not None else None
    headers = {'apikey': CONFIG['ANON_KEY'], 'Authorization': 'Bearer ' + (token or CONFIG['ANON_KEY']), 'Content-Type': mime, 'Origin': 'http://127.0.0.1:3050', **(extra or {})}
    req = urllib.request.Request(BASE + path, method=method, data=raw, headers=headers)
    try:
        response = urllib.request.urlopen(req, timeout=40)
    except urllib.error.HTTPError as error:
        response = error
    raw = response.read()
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        data = raw
    return response.status, data

def check(condition, label, detail=None):
    assert condition, (label, detail)
    checks.append(label)
    print('PASS', label)

def rpc(name, args, who=None):
    status, data = http('/rest/v1/rpc/' + name, who or token, args)
    assert status < 300, (name, status, data)
    return data

def user(label):
    email = f'ai-cover-{label}-{uuid.uuid4().hex}@example.invalid'
    password = 'LocalCoverFixture123!'
    status, data = http('/auth/v1/admin/users', CONFIG['SERVICE_ROLE_KEY'], {'email': email, 'password': password, 'email_confirm': True})
    assert status in (200, 201), data
    status, login = http('/auth/v1/token?grant_type=password', body={'email': email, 'password': password})
    assert status == 200, login
    return data['id'], login['access_token']

def png(color):
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!IIBBBBB', 4, 5, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress((b'\x00' + bytes(color) * 4) * 5)) + chunk(b'IEND', b'')

owner, token = user('generation')
foreign, other = user('generation-other')
event = str(uuid.uuid4())
sql(f"""insert into public.organizers(id,display_name) values('{owner}','Generator'),('{foreign}','Other');
insert into public.events(id,organizer_id,title,description,category,city,venue_name,starts_at)
values('{event}','{owner}','Local generation {event}','Live music in a neighborhood garden','music','Oakland','Garden',now()+interval '1 day');""")
def call(body, who=None):
    return http('/functions/v1/event-cover-generation',who or token,body)
def get(g):
    status,data=call({'action':'state','generationId':g['id']})
    assert status==200,(status,data)
    return data
def start(request_id=None):
    return call({'action':'start','eventId':event,'revision':0,'requestId':request_id or str(uuid.uuid4()),'mood':'Editorial','direction':'Blue dusk'})
def step(g,slot,attempt=0,who=None):
    return call({'action':'step','generationId':g['id'],'slot':slot,'attempt':attempt},who)
request_id=str(uuid.uuid4())
body={'action':'start','eventId':event,'revision':0,'requestId':request_id,'mood':'Editorial','direction':'Blue dusk'}
check(call(body,CONFIG['ANON_KEY'])[0]==401,'anonymous generation denied')
check(call(body,other)[0]==403,'foreign generation denied')
status,g=start(request_id)
check(status==200 and len(g['candidates'])==3,'owner starts exactly three durable slots',g)
check(start(request_id)==(200,g),'duplicate submission reuses existing set')
check(start()[0]==429,'one active set enforced')
check(step(g,1,who=other)[0]==403,'foreign provider execution denied')
check(call({'action':'state','generationId':g['id']},other)[0]==403,'foreign state denied')
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    results=list(pool.map(lambda _:step(g,1),range(2)))
check(all(code==200 for code,_ in results),'concurrent duplicate steps return safely',results)
r=get(g)
check(r['candidates'][0]['status']=='ready' and r['candidates'][0]['attempts']==1,'duplicate claim invokes only one attempt')
check(step(g,2)[0]==200,'provider failure recorded without losing generation')
r=get(g)
check(r['candidates'][0]['status']=='ready' and r['candidates'][1]['status']=='failed','partial failure keeps success')
check(step(g,3)[0]==200,'other candidate continues after partial failure')
r=get(g)
check(sum(c['status']=='ready' for c in r['candidates'])==2,'two successes persist after refresh')
check(step(g,2,1)[0]==409,'immediate retry cooldown enforced')
sql(f"update private.event_cover_candidates set updated_at=now()-interval '1 minute' where generation_id='{g['id']}' and slot=2;")
check(step(g,2,1)[0]==200,'explicit one-candidate retry succeeds')
r=get(g)
check(all(c['status']=='ready' for c in r['candidates']),'all three private results reload')
check(step(g,2,1)[0]==200 and get(g)['candidates'][1]['attempts']==2,'duplicate retry never bills again')
check(rpc('get_event_cover_state',{'p_event_id':event})['revision']==0,'generation never changes canonical cover')
path=r['candidates'][0]['path']
for who,label in [(CONFIG['ANON_KEY'],'anonymous'),(other,'foreign')]:
    check(http('/storage/v1/object/authenticated/event-cover-candidates/'+path,who,method='GET')[0]>=400,label+' generated bytes remain private')
check(http('/storage/v1/object/sign/event-cover-candidates/'+path,token,{'expiresIn':60})[0]==200,'owner private preview signs')
# Saved snapshot is immutable even if event edited between requests.
sql(f"update public.events set title='Changed saved title' where id='{event}';")
check(sql(f"select context->>'title' from private.event_cover_generations where id='{g['id']}'").startswith('Local generation'),'event snapshot preserved')
status,selected=http('/functions/v1/event-images',token,{'generationId':g['id'],'slot':1},'PUT',extra={'x-event-id':event,'x-cover-revision':'0'})
check(status==200 and rpc('get_event_cover_state',{'p_event_id':event})['revision']==1,'real generated fixture selects through Phase 1',selected)
# New set, then a manual upload races the unfinished generation.
body.update(requestId=str(uuid.uuid4()),revision=1)
status,new=call(body)
check(status==200,'new set after terminal generation allowed',new)
status,_=http('/functions/v1/event-images',token,png((1,2,3)),mime='image/png',extra={'x-event-id':event,'x-cover-revision':'1','x-request-id':str(uuid.uuid4())})
check(status==201,'manual upload still works after generation')
check(step(new,1)[0]==409,'stale generation cannot spend after newer manual cover')
check(rpc('get_event_cover_state',{'p_event_id':event})['revision']==2,'stale generation cannot overwrite manual cover')
# Retention removes private originals and never removes selected canonical copy.
sql(f"update private.event_cover_generations set expires_at=now()-interval '1 minute' where id='{g['id']}';")
check(get(g)['expired'],'expiry is visible on reload')
check(http('/storage/v1/object/authenticated/event-cover-candidates/'+path,CONFIG['SERVICE_ROLE_KEY'],method='GET')[0]>=400,'expired originals removed through Storage')
check(sql(f"select cleanup_done from private.event_cover_generations where id='{g['id']}'")=='t','cleanup receipt acknowledged')
# Final-attempt upload completed but DB finalization was interrupted: state must recover.
recovery_event=str(uuid.uuid4())
sql(f"insert into public.events(id,organizer_id,title) values('{recovery_event}','{owner}','Recovery proof');")
status,recovery=call({'action':'start','eventId':recovery_event,'revision':0,'requestId':str(uuid.uuid4()),'mood':'Editorial','direction':''})
assert status==200,recovery
candidate=recovery['candidates'][0]
sql(f"update private.event_cover_candidates set attempts=2,claim_token=gen_random_uuid(),lease_until=now()-interval '1 minute' where generation_id='{recovery['id']}' and slot=1;")
recovery_path=f"{recovery_event}/{recovery['id']}/{candidate['id']}.png"
fixture=__import__('base64').b64decode(json.loads((LOCAL/'supabase/functions/event-cover-generation/fixtures.json').read_text())[0])
assert http('/storage/v1/object/event-cover-candidates/'+recovery_path,CONFIG['SERVICE_ROLE_KEY'],fixture,mime='image/png')[0]==200
recovered=get(recovery)
check(recovered['candidates'][0]['status']=='ready' and recovered['candidates'][0]['attempts']==2,'last-attempt persisted bytes recover without another provider call')
sql(f"update private.event_cover_candidates set status='failed',failure_code='PROVIDER_FAILED' where generation_id='{recovery['id']}' and status='pending';")
# Database-side configurable daily limits apply even via direct RPC.
sql('update private.event_cover_limits set event_daily=2;')
body.update(requestId=str(uuid.uuid4()),revision=2)
check(call(body)==(429,{'error':'COVER_EVENT_LIMIT'}),'event daily limit enforced by HTTP')
sql('update private.event_cover_limits set event_daily=3,organizer_daily=2;')
second=str(uuid.uuid4())
sql(f"insert into public.events(id,organizer_id,title) values('{second}','{owner}','Second event');")
body.update(eventId=second,requestId=str(uuid.uuid4()),revision=0)
check(call(body)==(429,{'error':'COVER_ORGANIZER_LIMIT'}),'organizer daily limit spans events')
sql('update private.event_cover_limits set event_daily=3,organizer_daily=10;')
print('GENERATION TOTAL',len(checks))
