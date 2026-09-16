"""Real HTTP Storage + PostgREST proof. Requires the isolated Spec 15 local stack only."""
import base64, concurrent.futures, json, subprocess, urllib.request, urllib.error, uuid
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
CONFIG = json.loads(subprocess.check_output(['corepack','pnpm@11.19.0','exec','supabase','status','--workdir','/tmp/wheretoo-spec15-local','-o','json'],cwd=ROOT,text=True,stderr=subprocess.DEVNULL))
BASE=CONFIG['API_URL']; assert BASE=='http://127.0.0.1:55321'
DB='supabase_db_wheretoo-spec15-images'
def sql(q):
    return subprocess.check_output(['docker','exec','-i',DB,'psql','-X','-U','postgres','-At','-v','ON_ERROR_STOP=1'],input=q,text=True).strip()
def http(path,token=None,body=None,method='POST',mime='application/json', extra=None):
    raw=body if isinstance(body,bytes) else json.dumps(body).encode() if body is not None else None
    req=urllib.request.Request(BASE+path,method=method,data=raw,headers={'apikey':CONFIG['ANON_KEY'],'Authorization':'Bearer '+(token or CONFIG['ANON_KEY']),'Content-Type':mime,'Origin':'http://127.0.0.1:3050',**(extra or {})})
    try: response=urllib.request.urlopen(req,timeout=30)
    except urllib.error.HTTPError as error: response=error
    raw=response.read()
    try: data=json.loads(raw)
    except (ValueError,UnicodeDecodeError): data=raw
    return response.status,data
checks=[]
def check(condition,label):
    assert condition,label
    checks.append(label);print('PASS',label)
def user(label):
    email=f'spec15-{label}-{uuid.uuid4().hex[:8]}@example.invalid';password='Spec15LocalProofOnly123!'
    status,data=http('/auth/v1/admin/users',CONFIG['SERVICE_ROLE_KEY'],{'email':email,'password':password,'email_confirm':True})
    assert status in (200,201),data
    status,login=http('/auth/v1/token?grant_type=password',body={'email':email,'password':password});assert status==200,login
    return data['id'],login['access_token'],email,password
owner,token,email,password=user('owner');foreign,foreign_token,_,_=user('foreign');event=str(uuid.uuid4())
sql(f"""select cron.alter_job(jobid,active:=false) from cron.job;
select private.configure_policy_environment('development');
insert into public.organizers(id,display_name) values('{owner}','Image proof organizer'),('{foreign}','Other organizer');
insert into public.events(id,organizer_id,title,description,category,starts_at,ends_at,venue_name,address_line1,city,region,postal_code,country_code,mapbox_feature_id,latitude,longitude,admission_type)
values('{event}','{owner}','Spec 15 image event','A community gathering for image storage verification.','music',now()+interval '1 day',now()+interval '1 day 2 hours','Image Hall','1 Market Street','San Francisco','CA','94105','US','mapbox.spec15.local',37.7936,-122.3958,'free');
insert into private.event_risk_disclosures(event_id,minimum_age,alcohol_present,cannabis_present,explicit_adult_content,gambling_present,weapons_present,high_risk_activity)
values('{event}','all_ages',false,false,false,false,false,false);""")
png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC')
def upload(who=token,mime='image/png',extension='png'):
    status,data=http('/functions/v1/event-images',who,png,mime=mime,extra={'x-event-id':event})
    return status,data,data.get('path','') if isinstance(data,dict) else ''
status,data,path=upload();check(status==201,'upload one real image: '+str(data))
def listing(who=token):
    status,rows=http('/rest/v1/rpc/list_event_images',who,{'p_event_ids':[event]});assert status==200,rows;return rows
check(len(listing())==1,'draft attachment persisted')
check(listing(foreign_token)==[] and listing(CONFIG['ANON_KEY'])==[],'foreign and public cannot read draft metadata')
status,data=http('/storage/v1/object/sign/event-images/'+path,body={'expiresIn':60});check(status>=400,'draft signing denied to anonymous')
status,data,_=upload(foreign_token);check(status>=400,'foreign upload rejected')
status,data,_=upload(mime='image/svg+xml',extension='svg');check(status>=400,'unsupported MIME rejected by Storage')
# Four simultaneous candidates compete for two remaining slots.
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: results=list(pool.map(lambda _:upload(),range(4)))
check(sum(status==201 for status,_,_ in results)==2,'concurrent uploads stop at three')
rows=listing();check(len(rows)==3,'three real objects attached')
check(upload()[0]>=400,'fourth real upload rejected')
ids=[r['id'] for r in reversed(rows)]
status,data=http('/rest/v1/rpc/reorder_event_images',token,{'p_event_id':event,'p_image_ids':ids});check(status==204,'order saved')
check([r['id'] for r in listing()]==ids,'primary order persists after reread')
status,data=http('/rest/v1/rpc/reorder_event_images',foreign_token,{'p_event_id':event,'p_image_ids':ids});check(status>=400,'foreign reorder rejected')
status,data=http('/storage/v1/object/event-images',foreign_token,{'prefixes':[path]},'DELETE');check(len(listing())==3,'foreign removal cannot delete attachment')
# Canonical publication path, no direct status updates.
for name,args in [('accept_current_event_policies',{'p_event_id':event}),('publish_event',{'p_event_id':event})]:
    status,data=http('/rest/v1/rpc/'+name,token,args);check(status<300,name+': '+str(data)[:120])
check(len(listing(CONFIG['ANON_KEY']))==3,'published images visible publicly')
status,data=http('/storage/v1/object/sign/event-images/'+path,body={'expiresIn':315360000});check(status>=400,'public cannot mint persistent signed URLs')
image_id=next(r['id'] for r in listing() if r['path']==path)
status,image=http('/functions/v1/event-images?id='+image_id,method='GET');check(status==200 and image==png,'public image endpoint returns original bytes')
status,data=http('/storage/v1/object/event-images/'+f'{event}/{uuid.uuid4()}.png',token,png,mime='image/png');check(status>=400,'direct storage upload cannot bypass validation')
status,data=http('/functions/v1/event-images',token,b'not a PNG',mime='image/png',extra={'x-event-id':event});check(status==415,'disguised invalid image rejected by server')
first=listing()[0];status,data=http('/storage/v1/object/event-images',token,{'prefixes':[first['path']]},'DELETE');check(status==200,'owner storage removal succeeds')
status,data=http('/functions/v1/event-images?id='+first['id'],method='GET');check(status==404,'removed image URL no longer serves bytes')
rows=listing();check(len(rows)==2 and [r['position'] for r in rows]==[1,2],'removal deletes attachment and compacts order')
status,_,_=upload();check(status==201 and listing()[0]['id']==rows[0]['id'],'new upload appends without replacing surviving primary')
status,data=http('/storage/v1/object/event-images/'+rows[0]['path'],token,png,'PUT','image/png');check(status>=400,'in-place overwrite denied')
status,data=http('/functions/v1/event-images',token,png,mime='image/png',extra={'x-event-id':event,'Origin':'https://foreign.invalid'});check(status==403,'foreign origin upload denied')
status,data=http('/functions/v1/event-images',CONFIG['ANON_KEY'],png,mime='image/png',extra={'x-event-id':event});check(status==401,'anonymous upload denied')
status,data=http('/functions/v1/event-images',token,b'x'*5242881,mime='image/png',extra={'x-event-id':event});check(status==413,'oversized streamed upload rejected')
remaining_id=listing()[0]['id']
status,data=http('/rest/v1/rpc/cancel_owned_event',token,{'p_event_id':event});check(status<300,'canonical cancellation succeeds')
status,data=http('/functions/v1/event-images?id='+remaining_id,method='GET');check(status==404,'cancelled event image URL fails closed')
check(listing(CONFIG['ANON_KEY'])==[],'cancelled event attachments hidden publicly')
# Keep this disposable scenario for browser verification; never touch hosted/project scenario data.
out=Path('/tmp/wheretoo-spec15-local/scenario.json');out.write_text(json.dumps({'eventId':event,'ownerId':owner,'email':email,'password':password,'checks':checks}));out.chmod(0o600)
print('TOTAL',len(checks))
