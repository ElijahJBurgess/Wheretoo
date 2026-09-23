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

owner, token = user('owner')
foreign, other = user('other')
event = str(uuid.uuid4())
sql(f"""select cron.alter_job(jobid,active:=false) from cron.job;
select private.configure_policy_environment('development');
update private.event_cover_limits set event_daily=100,organizer_daily=1000;
insert into public.organizers(id,display_name) values('{owner}','Cover fixture'),('{foreign}','Other fixture');
insert into public.events(id,organizer_id,title,description,category,starts_at,ends_at,venue_name,address_line1,city,region,postal_code,country_code,mapbox_feature_id,latitude,longitude,admission_type)
values('{event}','{owner}','Local cover proof','A local fixture for cover selection and storage verification.','music',now()+interval '1 day',now()+interval '1 day 2 hours','Fixture Hall','1 Market Street','San Francisco','CA','94105','US','mapbox.cover.local',37.7936,-122.3958,'free');
insert into private.event_risk_disclosures(event_id,minimum_age,alcohol_present,cannabis_present,explicit_adult_content,gambling_present,weapons_present,high_risk_activity)
values('{event}','all_ages',false,false,false,false,false,false);""")

def state():
    return rpc('get_event_cover_state', {'p_event_id': event})

def upload(revision, image=None, request_id=None, who=None):
    return http('/functions/v1/event-images', who or token, image if image is not None else png((200, 10, 20)), mime='image/png', extra={'x-event-id': event, 'x-cover-revision': str(revision), 'x-request-id': request_id or str(uuid.uuid4())})

def select(g, slot, who=None, revision=None):
    return http('/functions/v1/event-images', who or token, {'generationId': g['id'], 'slot': slot}, 'PUT', extra={'x-event-id': event, 'x-cover-revision': str(g['expectedRevision'] if revision is None else revision)})

def generation(revision, fill=True, corrupt=False):
    g = rpc('create_event_cover_generation', {'p_event_id': event, 'p_request_id': str(uuid.uuid4()), 'p_expected_revision': revision, 'p_input': {'mood': 'editorial'}})
    if fill:
        for candidate in g['candidates']:
            path = f"{event}/{g['id']}/{candidate['id']}.png"
            content = b'invalid-raster' if corrupt else png((10, candidate['slot'] * 50, 190))
            status, data = http('/storage/v1/object/event-cover-candidates/' + path, CONFIG['SERVICE_ROLE_KEY'], content, mime='image/png')
            assert status == 200, data
            rpc('server_complete_event_cover_candidate', {'p_generation_id': g['id'], 'p_slot': candidate['slot'], 'p_path': path}, CONFIG['SERVICE_ROLE_KEY'])
    return rpc('get_event_cover_generation', {'p_generation_id': g['id']})

check(state() == {'revision': 0, 'images': [], 'latestGenerationId': None}, 'empty cover revision')
status, data = upload(0)
check(status == 201 and state()['revision'] == 1, 'manual initial upload commits canonical cover', data)
old = state()['images'][0]
check(upload(1, who=other)[0] == 403, 'foreign manual upload denied')
check(upload(1, who=CONFIG['ANON_KEY'])[0] == 401, 'anonymous manual upload denied')
check(http('/functions/v1/event-images', token, png((1, 2, 3)), mime='image/svg+xml', extra={'x-event-id': event, 'x-cover-revision': '1', 'x-request-id': str(uuid.uuid4())})[0] == 415, 'unsupported raster MIME denied')
check(http('/functions/v1/event-images', token, png((1, 2, 3)), mime='image/png', extra={'x-event-id': event, 'x-cover-revision': '1', 'x-request-id': str(uuid.uuid4()), 'Origin': 'https://foreign.invalid'})[0] == 403, 'foreign origin mutation denied')
check(upload(1, b'x' * 5242881)[0] == 413, 'oversized upload denied')
check(http('/storage/v1/object/event-images/' + f'{event}/{uuid.uuid4()}.png', token, png((1, 2, 3)), mime='image/png')[0] >= 400, 'direct canonical upload bypass denied')
for name in ['accept_current_event_policies', 'publish_event']:
    rpc(name, {'p_event_id': event})
g = generation(1)
check(len(g['candidates']) == 3 and all(c['status'] == 'ready' for c in g['candidates']), 'three ready private candidates')
check(rpc('get_event_cover_generation', {'p_generation_id': g['id']}) == g, 'candidates survive independent state reload')
duplicate = rpc('create_event_cover_generation', {'p_event_id': event, 'p_request_id': g['id'], 'p_expected_revision': 1, 'p_input': {'mood': 'editorial'}})
check(duplicate == g, 'generation request deduplicates')
for who, label in [(CONFIG['ANON_KEY'], 'anonymous'), (other, 'foreign')]:
    check(http('/rest/v1/rpc/get_event_cover_generation', who, {'p_generation_id': g['id']})[0] >= 400, label + ' generation metadata denied')
    check(http('/storage/v1/object/sign/event-cover-candidates/' + g['candidates'][0]['path'], who, {'expiresIn': 60})[0] >= 400, label + ' candidate signing denied')
    check(http('/storage/v1/object/authenticated/event-cover-candidates/' + g['candidates'][0]['path'], who, method='GET')[0] >= 400, label + ' candidate bytes denied')
    check(select(g, 1, who)[0] >= 400, label + ' selection denied')
check(http('/storage/v1/object/sign/event-cover-candidates/' + g['candidates'][0]['path'], token, {'expiresIn': 60})[0] == 200, 'owner can preview candidate')
check(http('/storage/v1/object/public/event-cover-candidates/' + g['candidates'][0]['path'], method='GET')[0] >= 400, 'candidate bucket is not public')
check(len(rpc('list_event_images', {'p_event_ids': [event]}, CONFIG['ANON_KEY'])) == 1, 'unselected options never enter public attachment list')
check(http('/functions/v1/event-images?id=' + g['candidates'][0]['id'], method='GET')[0] == 404, 'candidate UUID cannot use public delivery')
status, data = select(g, 2)
check(status == 200 and state()['revision'] == 2, 'candidate selection commits', data)
selected = state()['images'][0]
check(http('/functions/v1/event-images?id=' + selected['id'], method='GET') == (200, png((10, 100, 190))), 'selected bytes delivered through existing public endpoint')
check(select(g, 2)[0] == 200 and state()['revision'] == 2, 'duplicate selection does not mutate revision')
check(select(g, 1)[0] == 409, 'different second selection rejected')
check(upload(1)[0] == 409 and state()['images'][0]['id'] == selected['id'], 'stale manual replacement preserves selected cover')
request_id = str(uuid.uuid4())
check(upload(2, request_id=request_id)[0] == 201, 'manual replacement after AI selection')
check(upload(2, request_id=request_id)[0] == 201 and state()['revision'] == 3, 'lost manual response replay is idempotent')
check(upload(2, png((1, 2, 3)), request_id)[0] == 409, 'same upload identity rejects different bytes')
manual = state()['images'][0]
check(select(g, 2)[0] == 200 and state()['images'][0]['id'] == manual['id'], 'old selection receipt never restores retired artwork')
check(http('/functions/v1/event-images', token, png((1, 2, 3)), mime='image/png', extra={'x-event-id': event})[0] == 409, 'pre-revision client fails closed')
check(http('/rest/v1/rpc/reorder_event_images', token, {'p_event_id': event, 'p_image_ids': [manual['id']]})[0] >= 400, 'legacy reorder bypass denied')
http('/storage/v1/object/event-images', token, {'prefixes': [manual['path']]}, 'DELETE')
check(state()['images'][0]['id'] == manual['id'], 'legacy direct deletion cannot remove current cover')
check(upload(3, b'bad raster')[0] == 415 and state()['revision'] == 3, 'invalid manual image preserves cover')
bad = generation(3, corrupt=True)
check(select(bad, 1)[0] == 415 and state()['images'][0]['id'] == manual['id'], 'invalid candidate bytes preserve old cover')
pending = generation(3, fill=False)
check(select(pending, 1)[0] == 409, 'pending candidate cannot be selected')
rpc('server_complete_event_cover_candidate', {'p_generation_id': pending['id'], 'p_slot': 1, 'p_path': None, 'p_failure_code': 'FIXTURE_FAILURE'}, CONFIG['SERVICE_ROLE_KEY'])
check(rpc('get_event_cover_generation', {'p_generation_id': pending['id']})['candidates'][0]['status'] == 'failed', 'candidate failure survives reload')
check(select(pending, 1)[0] == 409, 'failed candidate cannot be selected')
for slot in [2,3]:
    rpc('server_complete_event_cover_candidate', {'p_generation_id': pending['id'], 'p_slot': slot, 'p_path': None, 'p_failure_code': 'FIXTURE_FAILURE'}, CONFIG['SERVICE_ROLE_KEY'])
older = generation(3)
newer = generation(3)
check(select(older, 1)[0] == 409 and state()['revision'] == 3, 'superseded generation selection rejected')
# Real concurrent HTTP operations share revision 3. Only one may advance it.
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    a = pool.submit(upload, 3)
    b = pool.submit(select, newer, 1)
    results = [a.result(), b.result()]
check(sum(code < 300 for code, _ in results) == 1 and sum(code == 409 for code, _ in results) == 1 and state()['revision'] == 4, 'concurrent upload and selection have exactly one winner', results)
# Existing installations may still have all three legacy attachment slots filled.
for position in [2, 3]:
    path = f'{event}/{uuid.uuid4()}.png'
    status, data = http('/storage/v1/object/event-images/' + path, CONFIG['SERVICE_ROLE_KEY'], png((1, 2, 3)), mime='image/png', extra={'x-metadata': __import__('base64').b64encode(json.dumps({'organizer_id': owner, 'cover_staged': True}).encode()).decode()})
    assert status == 200, data
    sql(f"insert into private.event_images(id,event_id,object_path,position) select id,'{event}',name,{position} from storage.objects where bucket_id='event-images' and name='{path}';")
check(len(state()['images']) == 3, 'legacy gallery fixture occupies three slots')
check(upload(4)[0] == 201 and len(state()['images']) == 1 and state()['revision'] == 5, 'replacement safely handles full legacy gallery')
remove = lambda rev: http('/functions/v1/event-images', token, {'remove': True}, 'PUT', extra={'x-event-id': event, 'x-cover-revision': str(rev)})
check(remove(4)[0] == 409 and len(state()['images']) == 1, 'stale removal cannot erase newer cover')
check(remove(5)[0] == 200 and state()['revision'] == 6 and state()['images'] == [], 'manual removal clears canonical attachment')
check(remove(5)[0] == 200 and state()['revision'] == 6, 'duplicate removal is safe')
check(select(g, 2)[0] == 200 and state()['images'] == [], 'old selection retry cannot undo removal')
check(upload(6)[0] == 201, 'upload works again after removal')
latest = generation(7)
check(state()['latestGenerationId'] == latest['id'], 'event reload discovers latest generation without browser storage')
check(http('/rest/v1/rpc/server_complete_event_cover_candidate', CONFIG['SERVICE_ROLE_KEY'], {'p_generation_id': latest['id'], 'p_slot': 4, 'p_path': None, 'p_failure_code': 'EXTRA'})[0] >= 400, 'fourth candidate slot denied')
check(http('/storage/v1/object/event-cover-candidates/' + latest['candidates'][0]['path'], token, png((1, 2, 3)), mime='image/png')[0] >= 400, 'browser cannot upload candidate bytes')
check(http('/storage/v1/object/event-cover-candidates/' + latest['candidates'][0]['path'], CONFIG['SERVICE_ROLE_KEY'], png((1, 2, 3)), 'PUT', 'image/png')[0] >= 400, 'ready candidate cannot be overwritten even by service upsert')
# Simulate canonical Storage rejecting a copy. Only this dedicated local bucket changes.
sql("update storage.buckets set file_size_limit=1 where id='event-images';")
try:
    status, data = select(latest, 2)
    check(status == 409 and state()['revision'] == 7, 'failed destination copy preserves old cover', data)
finally:
    sql("update storage.buckets set file_size_limit=5242880 where id='event-images';")
http('/storage/v1/object/event-cover-candidates', CONFIG['SERVICE_ROLE_KEY'], {'prefixes': [latest['candidates'][0]['path']]}, 'DELETE')
check(select(latest, 1)[0] == 409 and state()['revision'] == 7, 'missing source bytes preserve old cover')
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    results = list(pool.map(lambda _: select(latest, 2), range(2)))
check(all(code == 200 for code, _ in results) and state()['revision'] == 8, 'concurrent identical selection commits once and both requests reconcile', results)
last_id = state()['images'][0]['id']
rpc('cancel_owned_event', {'p_event_id': event})
check(select(g, 2)[0] == 403, 'cancelled event cannot replay selection')
check(http('/functions/v1/event-images?id=' + last_id, method='GET')[0] == 404, 'cancelled event cover fails closed')
print('TOTAL', len(checks))

sql("update private.event_cover_limits set event_daily=3,organizer_daily=10;")
