"""Proof against ONLY the dedicated local Duplicate Event stack.
Start it using tests/integration/run-duplicate-event-local.py; never accepts hosted URLs.
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
LOCAL = ROOT / '.supabase/duplicate-event'
CONFIG = json.loads(subprocess.check_output(['corepack', 'pnpm@11.19.0', 'exec', 'supabase', 'status', '--workdir', str(LOCAL), '-o', 'json'], cwd=ROOT, text=True, stderr=subprocess.DEVNULL))
BASE = CONFIG['API_URL']
assert BASE == 'http://127.0.0.1:58321'
DB = 'supabase_db_wheretoo-duplicate-event'
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
sql(f"select cron.alter_job(jobid,active:=false) from cron.job; select private.configure_policy_environment('development'); insert into public.organizers(id,display_name) values('{owner}','Duplicate proof'),('{foreign}','Other proof');")
def event(admission='free', title='Duplicate proof'):
    eid=str(uuid.uuid4())
    sql(f"insert into public.events(id,organizer_id,title,description,category,starts_at,ends_at,venue_name,address_line1,city,region,postal_code,country_code,mapbox_feature_id,latitude,longitude,admission_type,capacity) values('{eid}','{owner}','{title}','A local event with reusable details for duplication.','music',now()+interval '1 day',now()+interval '1 day 2 hours','Fixture Hall','1 Market Street','San Francisco','CA','94105','US','mapbox.duplicate.local',37.7936,-122.3958,'{admission}',100);")
    return eid

def duplicate(eid,who=None): return http('/functions/v1/duplicate-event',who or token,{'sourceEventId':eid})
def cover(eid): return rpc('get_event_cover_state',{'p_event_id':eid})
def upload(eid, data, mime='image/png'):
    return http('/functions/v1/event-images',token,data,mime=mime,extra={'x-event-id':eid,'x-cover-revision':str(cover(eid)['revision']),'x-request-id':str(uuid.uuid4())})
def remove(eid): return http('/functions/v1/event-images',token,{'remove':True},'PUT',extra={'x-event-id':eid,'x-cover-revision':str(cover(eid)['revision'])})
def download(path): return http('/storage/v1/object/authenticated/event-images/'+path,CONFIG['SERVICE_ROLE_KEY'],method='GET')
def context(eid): return rpc('get_owned_event_duplicate_context',{'p_source_event_id':eid})
def final(eid,ctx,target=None,path=None,who=None):
    return http('/rest/v1/rpc/duplicate_owned_event',who or token,{'p_source_event_id':eid,'p_new_event_id':target or str(uuid.uuid4()),'p_expected_fingerprint':ctx['fingerprint'],'p_staged_path':path})
source=event()
status,result=duplicate(source)
check(status==201,'coverless Edge duplicate',result)
target=result['eventId']
check(sql(f"select status||','||moderation_status||','||public_history_status||','||(starts_at is null and ends_at is null)::text from events where id='{target}'")=='draft,not_evaluated,never_public,true','fresh draft schedule/public state')
check(sql(f"select count(*) from private.event_risk_disclosures where event_id='{target}'")=='0','absent disclosures remain absent')
for who,label in [(other,'foreign'),(CONFIG['ANON_KEY'],'anonymous')]:
    check(duplicate(source,who)[0]>=400,label+' Edge denied')
    check(final(source,context(source),who=who)[0]>=400,label+' direct RPC denied')
check(duplicate(str(uuid.uuid4()))[0]==404,'missing UUID denied')
for state in ['blocked','removed']:
    sql(f"update events set moderation_status='{state}' where id='{source}'")
    status,result=duplicate(source)
    check(status==409 and result['error']=='DUPLICATE_MODERATION_BLOCKED',state+' Edge denied',result)
    check(final(source,{'fingerprint':'a'*64})[0]>=400,state+' finalizer denied')
sql(f"update events set moderation_status='not_evaluated' where id='{source}'")
# Current paid tier cardinalities and archived-only configuration.
for count in range(4):
    paid=event('paid')
    for slot in range(1,count+1): sql(f"insert into ticket_tiers(event_id,name,description,unit_amount_minor,currency,quantity_total,sort_order,status) values('{paid}','Tier {slot}','Description {slot}',{slot*1500},'usd',{slot*30},{slot},'active')")
    status,result=duplicate(paid); check(status==201,f'{count} paid tiers duplicate',result)
    tid=result['eventId']
    check(sql(f"select count(*) from ticket_tiers where event_id='{tid}'")==str(count),f'{count} tier count correct')
    check(sql(f"select count(*) from orders where event_id='{tid}'")=='0' and sql(f"select count(*) from tickets where event_id='{tid}'")=='0',f'{count} tier no inherited transactions')
# Independent canonical pixels and lifecycle.
image=png((120,50,90))
check(upload(source,image)[0]==201,'source PNG upload')
before=cover(source)['images'][0]
status,result=duplicate(source);check(status==201,'PNG independent copy succeeds',result)
copy=result['eventId'];after=cover(copy)['images'][0]
check(before['id']!=after['id'] and before['path']!=after['path'] and after['path'].startswith(copy+'/'),'new object/image/path')
check(download(before['path'])==(200,image) and download(after['path'])==(200,image),'byte equality')
check(remove(copy)[0]==200 and download(before['path'])==(200,image),'remove destination preserves source')
status,result=duplicate(source);copy=result['eventId'];oldcopy=cover(copy)['images'][0]
check(upload(copy,png((10,20,30)))[0]==201 and download(before['path'])==(200,image),'replace destination preserves source')
status,result=duplicate(source);copy=result['eventId'];after=cover(copy)['images'][0]
check(upload(source,png((40,50,60)))[0]==201 and download(after['path'])==(200,image),'replace source preserves destination')
check(remove(source)[0]==200 and download(after['path'])==(200,image),'remove source preserves destination')
check(sql(f"select count(*) from private.event_cover_generations where event_id='{copy}'")=='0','no AI generation history copied')
# Deterministic interleavings: every reusable configuration component participates in fingerprint.
mutations=[('event title',"title='Changed title'"),('event capacity','capacity=101'),('cancellation',"status='cancelled'"),('moderation',"moderation_status='under_review'")]
for label,assignment in mutations:
    eid=event(); ctx=context(eid); sql(f"update events set {assignment} where id='{eid}'")
    code,result=final(eid,ctx)
    check(code>=400 and result.get('message')=='DUPLICATE_SOURCE_CHANGED',label+' interleaving conflicts',result)
for field,value in [('unit_amount_minor','1800'),('quantity_total','11'),('status',"'archived'")]:
    eid=event('paid');sql(f"insert into ticket_tiers(event_id,name,unit_amount_minor,quantity_total,sort_order) values('{eid}','One',1500,10,1)")
    ctx=context(eid);sql(f"update ticket_tiers set {field}={value} where event_id='{eid}'")
    code,result=final(eid,ctx);check(code>=400 and result.get('message')=='DUPLICATE_SOURCE_CHANGED',field+' interleaving conflicts',result)

# Reuse real raster fixtures from the existing byte-validator test, not a provider.
import base64, re, hashlib, time
fixtures=re.findall(r'atob\(\s*"([^"]+)"', (ROOT/'supabase/functions/event-images/imageBytes.test.ts').read_text())
for mime,encoded in [('image/jpeg',fixtures[1]),('image/webp',fixtures[2])]:
    eid=event();pixels=base64.b64decode(encoded)
    check(upload(eid,pixels,mime)[0]==201,mime+' upload')
    code,result=duplicate(eid);check(code==201,mime+' duplicate',result)
    image_record=cover(result['eventId'])['images'][0]
    check(download(image_record['path'])==(200,pixels),mime+' copied exact bytes')
# AI selection produces canonical pixels; duplicate only that promoted attachment.
eid=event();g=rpc('create_event_cover_generation',{'p_event_id':eid,'p_request_id':str(uuid.uuid4()),'p_expected_revision':0,'p_input':{'mood':'editorial'}})
candidate=g['candidates'][0];candidate_path=f"{eid}/{g['id']}/{candidate['id']}.png"
pixels=png((30,40,90))
check(http('/storage/v1/object/event-cover-candidates/'+candidate_path,CONFIG['SERVICE_ROLE_KEY'],pixels,mime='image/png')[0]==200,'AI candidate private upload')
rpc('server_complete_event_cover_candidate',{'p_generation_id':g['id'],'p_slot':1,'p_path':candidate_path},CONFIG['SERVICE_ROLE_KEY'])
check(http('/functions/v1/event-images',token,{'generationId':g['id'],'slot':1},'PUT',extra={'x-event-id':eid,'x-cover-revision':'0'})[0]==200,'AI canonical selection')
code,result=duplicate(eid);check(code==201,'AI-selected source duplicate',result)
new=result['eventId'];image_record=cover(new)['images'][0]
check(download(image_record['path'])==(200,pixels),'AI promoted pixels equal')
check(sql(f"select count(*) from private.event_cover_generations where event_id='{new}'")=='0' and cover(new)['latestGenerationId'] is None,'AI generation/candidate pointer absent')
metadata=json.loads(sql(f"select user_metadata::text from storage.objects where id='{image_record['id']}'"))
check(not any(k in metadata for k in ['candidate_id','generation_id','input','prompt','provider','request_id']),'no copied AI metadata')
# Service-only stage binding and ordinary-cover adoption denial.
def stage(eid,ctx,target=None,overrides=None,who=None,pixels=None):
    target=target or str(uuid.uuid4()); pixels=pixels or png((1,2,3)); path=f'{target}/{uuid.uuid4()}.png'
    metadata={'organizer_id':owner,'cover_staged':True,'cover_revision':0,'duplicate_source':eid,'duplicate_fingerprint':ctx['fingerprint'],'duplicate_image':ctx['image']['id'],'digest':hashlib.sha256(pixels).hexdigest()}
    metadata.update(overrides or {})
    status,result=http('/storage/v1/object/event-images/'+path,who or CONFIG['SERVICE_ROLE_KEY'],pixels,mime='image/png',extra={'x-metadata':base64.b64encode(json.dumps(metadata).encode()).decode()})
    return status,result,target,path
ctx=context(eid)
for overrides,label in [({'organizer_id':foreign},'owner mismatch'),({'duplicate_source':source},'source mismatch'),({'duplicate_fingerprint':'b'*64},'fingerprint mismatch'),({'duplicate_image':str(uuid.uuid4())},'image mismatch')]:
    check(stage(eid,ctx,overrides=overrides)[0]>=400,'stage '+label+' denied')
check(stage(eid,ctx,who=token)[0]>=400,'authenticated direct stage denied')
check(stage(eid,ctx,target=source)[0]>=400,'existing destination stage denied')
status,result,target,path=stage(eid,ctx);check(status==200,'private precreate stage',result)
check(sql(f"select count(*) from events where id='{target}'")=='0','stage creates no partial draft')
check(http('/storage/v1/object/sign/event-images/'+path,token,{'expiresIn':60})[0]>=400,'precreate stage cannot be signed by browser')
code,result=final(eid,ctx,target=str(uuid.uuid4()),path=path);check(code>=400,'target mismatch finalization denied')
sql(f"insert into events(id,organizer_id,title) values('{target}','{owner}','Unrelated draft')")
code,result=http('/rest/v1/rpc/server_commit_event_cover',CONFIG['SERVICE_ROLE_KEY'],{'p_event_id':target,'p_organizer_id':owner,'p_expected_revision':0,'p_path':path})
check(code>=400 and result.get('message')=='DUPLICATE_STAGE_INVALID','ordinary cover cannot adopt duplicate stage',result)
status,result,target,path=stage(eid,ctx);check(status==200,'expiry fixture staged')
sql(f"update storage.objects set created_at=now()-interval '16 minutes' where name='{path}' and bucket_id='event-images'")
code,result=final(eid,ctx,target,path);check(code>=400 and result.get('message')=='DUPLICATE_STAGE_INVALID','expired staging denied',result)
check(sql(f"select count(*) from events where id='{target}'")=='0','expired staging no partial event')
# Cover mutation interleavings, including source AI selection.
for operation in ['replace','remove','AI selection']:
    eid=event();upload(eid,png((10,10,10)));ctx=context(eid);status,result,target,path=stage(eid,ctx)
    if operation=='replace': upload(eid,png((20,20,20)))
    elif operation=='remove': remove(eid)
    else:
        g=rpc('create_event_cover_generation',{'p_event_id':eid,'p_request_id':str(uuid.uuid4()),'p_expected_revision':1,'p_input':{}})
        c=g['candidates'][0]; cp=f"{eid}/{g['id']}/{c['id']}.png"
        http('/storage/v1/object/event-cover-candidates/'+cp,CONFIG['SERVICE_ROLE_KEY'],png((20,30,40)),mime='image/png')
        rpc('server_complete_event_cover_candidate',{'p_generation_id':g['id'],'p_slot':1,'p_path':cp},CONFIG['SERVICE_ROLE_KEY'])
        http('/functions/v1/event-images',token,{'generationId':g['id'],'slot':1},'PUT',extra={'x-event-id':eid,'x-cover-revision':'1'})
    code,result=final(eid,ctx,target,path)
    check(code>=400 and result.get('message')=='DUPLICATE_SOURCE_CHANGED',operation+' during duplication conflicts',result)
# Requirements, policy acceptance, actual publication and source lifecycle eligibility.
eid=event();ctx=context(eid)
sql(f"insert into private.event_risk_disclosures(event_id,minimum_age,alcohol_present,cannabis_present,explicit_adult_content,gambling_present,weapons_present,high_risk_activity) values('{eid}','all_ages',false,false,false,false,false,false)")
code,result=final(eid,ctx);check(code>=400 and result.get('message')=='DUPLICATE_SOURCE_CHANGED','disclosure insert conflicts')
rpc('accept_current_event_policies',{'p_event_id':eid});ctx=context(eid)
rpc('publish_event',{'p_event_id':eid})
code,result=final(eid,ctx);check(code>=400 and result.get('message')=='DUPLICATE_SOURCE_CHANGED','publication change conflicts')
for state,label in [('published','published/live'),('cancelled','cancelled')]:
    sql(f"update events set status='{state}' where id='{eid}'")
    code,result=duplicate(eid);check(code==201,label+' source allowed',result)
    target=result['eventId']
    check(sql(f"select count(*) from private.event_policy_acceptances where event_id='{target}'")=='0','source agreement never copied '+label)
    check(sql(f"select count(*) from private.event_risk_disclosures where event_id='{target}'")=='1','factual answers copied '+label)
    check(http('/rest/v1/rpc/publish_event',token,{'p_event_id':target})[0]>=400,'blank schedule/no consent cannot publish '+label)
    sql(f"update events set starts_at=now()+interval '3 days',ends_at=now()+interval '3 days 2 hours' where id='{target}'")
    code,result=http('/rest/v1/rpc/publish_event',token,{'p_event_id':target})
    check(code>=400 and result.get('message')=='EVENT_POLICY_ACCEPTANCE_REQUIRED','new schedule still requires fresh agreement '+label,result)
    rpc('accept_current_event_policies',{'p_event_id':target})
    check(http('/rest/v1/rpc/publish_event',token,{'p_event_id':target})[0]<300,'normal publish after fresh schedule and acceptance '+label)

sql(f"update events set status='published', starts_at=now()-interval '2 days',ends_at=now()-interval '1 day',moderation_status='under_review' where id='{eid}'")
check(duplicate(eid)[0]==201,'ended under-review source allowed')
# Title boundaries and configured free capacity.
for title in ['x'*120,'😀'*60,'   ']:
    eid=event(title=title);code,result=duplicate(eid);check(code==201,'title boundary duplicate')
    value=sql(f"select title from events where id='{result['eventId']}'")
    check(value.endswith(' — Copy') and len(value.encode('utf-16-le'))//2<=120,'title within UTF16 cap')
    check(sql(f"select capacity from events where id='{result['eventId']}'")=='100','configured free capacity copied')
# Real overlap: an event update holds source lock while duplicate finalizer waits.
eid=event();ctx=context(eid)
writer=subprocess.Popen(['docker','exec','-i',DB,'psql','-X','-U','postgres','-At','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
writer.stdin.write(f"begin; update events set capacity=111 where id='{eid}'; select pg_sleep(1); commit;");writer.stdin.close()
time.sleep(.2)
code,result=final(eid,ctx);writer.wait()
check(code>=400 and result.get('message')=='DUPLICATE_SOURCE_CHANGED','overlapping event update/finalization conflict after lock wait',result)
# Corrupt legacy canonical bytes can exist even though modern upload validates them.
for kind in ['corrupt','missing','wrong MIME','legacy artwork']:
    bad=event();before_count=sql(f"select count(*) from events where organizer_id='{owner}'")
    if kind=='legacy artwork': sql(f"update events set artwork_path='unsupported-old-art' where id='{bad}'")
    elif kind=='corrupt':
        path=f'{bad}/{uuid.uuid4()}.png';meta={'organizer_id':owner,'cover_staged':True,'cover_revision':0}
        code,result=http('/storage/v1/object/event-images/'+path,CONFIG['SERVICE_ROLE_KEY'],b'not a PNG raster',mime='image/png',extra={'x-metadata':base64.b64encode(json.dumps(meta).encode()).decode()})
        assert code==200,result
        rpc('server_commit_event_cover',{'p_event_id':bad,'p_organizer_id':owner,'p_expected_revision':0,'p_path':path},CONFIG['SERVICE_ROLE_KEY'])
    else:
        upload(bad,png((2,3,4)));record=cover(bad)['images'][0]
        if kind=='missing': sql(f"update private.event_images set object_path='{bad}/{uuid.uuid4()}.png' where id='{record['id']}'")
        else:
            check(upload(bad,png((2,3,4)),'application/octet-stream')[0]>=400,'wrong MIME cannot become canonical source')
            continue
    code,result=duplicate(bad)
    check(code>=400 and sql(f"select count(*) from events where organizer_id='{owner}'")==before_count,kind+' flyer fails without destination',result)
# Exactly 5 MiB valid PNG, padded with a legal ancillary text chunk.
pixels=png((4,5,6));size=5242880-len(pixels)-12;kind=b'tEXt';payload=b'a'*size
chunk=struct.pack('!I',size)+kind+payload+struct.pack('!I',zlib.crc32(kind+payload));pixels=pixels[:-12]+chunk+pixels[-12:]
boundary=event();check(len(pixels)==5242880 and upload(boundary,pixels)[0]==201,'exact 5 MiB source accepted')
code,result=duplicate(boundary);check(code==201,'exact 5 MiB duplicates',result)
check(upload(event(),pixels+b'x')[0]>=400,'5 MiB plus one rejected')
# Every configuration writer overlaps finalization, holding the same source locks.
for label,assignment in [('price','unit_amount_minor=1900'),('quantity','quantity_total=12'),('archive',"status='archived'"),('requirements','alcohol_present=true'),('cancellation',"status='cancelled'"),('moderation',"moderation_status='under_review'"),('publication',"status='published'")]:
    eid=event('paid');sql(f"insert into ticket_tiers(event_id,name,unit_amount_minor,quantity_total,sort_order) values('{eid}','Race',1500,10,1); insert into private.event_risk_disclosures(event_id,minimum_age,alcohol_present,cannabis_present,explicit_adult_content,gambling_present,weapons_present,high_risk_activity) values('{eid}','all_ages',false,false,false,false,false,false)")
    ctx=context(eid)
    table='ticket_tiers' if label in ['price','quantity','archive'] else 'private.event_risk_disclosures' if label=='requirements' else 'events'
    key='id' if table=='events' else 'event_id'
    writer=subprocess.Popen(['docker','exec','-i',DB,'psql','-X','-U','postgres','-At','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    writer.stdin.write(f"begin; select private.lock_event_change_rows('{eid}'); update {table} set {assignment} where {key}='{eid}'; select pg_sleep(1); commit;");writer.stdin.close()
    time.sleep(.2); started=time.monotonic(); code,result=final(eid,ctx);elapsed=time.monotonic()-started;writer.wait()
    check(writer.returncode==0 and elapsed>.5 and code>=400 and result.get('message')=='DUPLICATE_SOURCE_CHANGED',label+' overlapping locked writer conflicts',result)
# Real overlapping cover APIs and finalizer, queued behind an event row lock.
for operation in ['replace','remove','AI selection']:
    eid=event();oldpixels=png((11,22,33));upload(eid,oldpixels);ctx=context(eid);status,result,target,path=stage(eid,ctx,pixels=oldpixels);assert status==200,result
    if operation=='AI selection':
        g=rpc('create_event_cover_generation',{'p_event_id':eid,'p_request_id':str(uuid.uuid4()),'p_expected_revision':1,'p_input':{}})
        c=g['candidates'][0];cp=f"{eid}/{g['id']}/{c['id']}.png"
        http('/storage/v1/object/event-cover-candidates/'+cp,CONFIG['SERVICE_ROLE_KEY'],png((90,20,30)),mime='image/png')
        rpc('server_complete_event_cover_candidate',{'p_generation_id':g['id'],'p_slot':1,'p_path':cp},CONFIG['SERVICE_ROLE_KEY'])
    blocker=subprocess.Popen(['docker','exec','-i',DB,'psql','-X','-U','postgres','-At','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    blocker.stdin.write(f"begin; select id from events where id='{eid}' for update; select pg_sleep(1); commit;");blocker.stdin.close();time.sleep(.2)
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        if operation=='replace':mutation=pool.submit(upload,eid,png((90,20,30)))
        elif operation=='remove':mutation=pool.submit(remove,eid)
        else:mutation=pool.submit(http,'/functions/v1/event-images',token,{'generationId':g['id'],'slot':1},'PUT',extra={'x-event-id':eid,'x-cover-revision':'1'})
        copying=pool.submit(final,eid,ctx,target,path)
        time.sleep(.15);check(not mutation.done() and not copying.done(),operation+' operations overlap while source locked')
        code,result=copying.result();mutation_code,mutation_result=mutation.result();blocker.wait()
    check(mutation_code<300,operation+' writer finishes',mutation_result)
    check((code<300 and download(cover(target)['images'][0]['path'])==(200,oldpixels)) or (code>=400 and result.get('message')=='DUPLICATE_SOURCE_CHANGED'),operation+' overlap is complete original snapshot or safe conflict',result)
# Real commit succeeds, then the orchestrator deliberately loses the final response.
import os
lost=event();upload(lost,png((1,2,3)))
subprocess.run([str(ROOT/'node_modules/.bin/deno'),'run','--allow-env','--allow-net=127.0.0.1:58321','tests/integration/edge/duplicate-event-lost-response.ts'],cwd=ROOT,env={**os.environ,'DUPLICATE_API':BASE,'DUPLICATE_TOKEN':token,'DUPLICATE_SERVICE':CONFIG['SERVICE_ROLE_KEY'],'DUPLICATE_SOURCE':lost,'DUPLICATE_OWNER':owner},check=True)
check(True,'real lost final response preserves committed flyer')
# Make a complete, current draft the browser's deterministic first row.
source=event(title='Browser Duplicate Source')
sql(f"update organizers set onboarding_completed_at=now() where id='{owner}'; insert into private.event_risk_disclosures(event_id,minimum_age,alcohol_present,cannabis_present,explicit_adult_content,gambling_present,weapons_present,high_risk_activity) values('{source}','all_ages',false,false,false,false,false,false)")
upload(source,png((40,120,90)))

# Save local browser credentials only into ignored proof output; never print tokens.
(ROOT/'.duplicate-proof/browser-fixture.json').write_text(json.dumps({'owner':owner,'token':token,'source':source,'api':BASE,'anon':CONFIG['ANON_KEY']}))
print(f'{len(checks)} Duplicate Event integration checks passed')
