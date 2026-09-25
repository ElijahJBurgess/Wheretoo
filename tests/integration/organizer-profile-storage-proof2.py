"""Real local Storage, ownership, handle-race proof. Uses only the allowlisted fresh feature proof stack."""
import base64, concurrent.futures, importlib.util, json, subprocess, uuid, urllib.request, urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('local',ROOT/'tests/integration/organizer-profile-proof2.py'); local=importlib.util.module_from_spec(spec);spec.loader.exec_module(local)
CONFIG=json.loads(subprocess.check_output(['pnpm','exec','supabase','status','--workdir',str(local.context('feature')[2]),'-o','json'],cwd=ROOT,text=True,stderr=subprocess.DEVNULL));BASE=CONFIG['API_URL'];assert BASE=='http://127.0.0.1:59321'
def http(path,token=None,body=None,method='POST',mime='application/json',origin='http://127.0.0.1:3085'):
 raw=body if isinstance(body,bytes) else json.dumps(body).encode() if body is not None else None
 req=urllib.request.Request(BASE+path,data=raw,method=method,headers={'apikey':CONFIG['ANON_KEY'],'Authorization':'Bearer '+(token or CONFIG['ANON_KEY']),'content-type':mime,'Origin':origin})
 try: r=urllib.request.urlopen(req,timeout=30)
 except urllib.error.HTTPError as error: r=error
 raw=r.read()
 try:data=json.loads(raw)
 except (ValueError,UnicodeDecodeError):data=raw
 return r.status,data
checks=0
def check(value,label):
 global checks
 assert value,label
 checks+=1;print('PASS',label)
def user():
 email=f'storefront-{uuid.uuid4().hex}@example.invalid';password='StorefrontLocalProofOnly123!'
 code,u=http('/auth/v1/admin/users',CONFIG['SERVICE_ROLE_KEY'],{'email':email,'password':password,'email_confirm':True});assert code in (200,201)
 code,s=http('/auth/v1/token?grant_type=password',body={'email':email,'password':password});assert code==200
 local.sql('feature',f"insert into public.organizers(id,display_name) values('{u['id']}','Storefront proof');")
 return u['id'],s['access_token'],s

def state(owner):
 return json.loads(local.sql('feature',f"select to_jsonb(o) from public.organizers o where id='{owner}';"))
def save(owner,token,asset):
 return http('/rest/v1/rpc/save_owned_organizer_setup',token,{'p_profile':{'displayName':'Storefront proof','organizerType':'Venue','bio':'Live proof','websiteUrl':'','baseCity':'Oakland'},'p_expected_updated_at':state(owner)['updated_at'],'p_logo_id':asset})

if __name__=='__main__':
 import threading,time,os
 a,ta,sa=user();b,tb,sb=user()
 png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC')
 bucket_before=local.sql('feature','select jsonb_agg(to_jsonb(b) order by id) from storage.buckets b;')
 assets=[]
 for owner,token in [(a,ta),(b,tb)]:
  code,result=http('/functions/v1/organizer-media',token,png,mime='image/png');check(code==201,'real organizer logo upload');assets.append(result['id'])
  check(save(owner,token,result['id'])[0]==200,'owner attaches real Storage logo to profile')
  check(state(owner)['storefront_logo_asset_id']==result['id'],'attached logo persisted')
 before=state(b)
 code,result=save(b,tb,assets[0]);check(code==400 and result.get('message')=='LOGO_NOT_OWNED','foreign attachment rejected')
 check(state(b)==before,'foreign attachment leaves full profile unchanged')
 for body,mime,status,label in [(b'<svg></svg>','image/svg+xml',415,'invalid MIME'),(b'not an image','image/png',415,'forged image bytes'),(b'x'*5242881,'image/png',413,'oversized image')]:
  check(http('/functions/v1/organizer-media',ta,body,mime=mime)[0]==status,label+' rejected')
 check(http('/functions/v1/organizer-media?id='+assets[0],method='GET')[0]==404,'draft media private')
 check(http('/functions/v1/organizer-media?id='+assets[0],tb,method='GET')[0]==404,'foreign preview denied')
 check(http('/functions/v1/organizer-media?id='+assets[0],ta,method='GET')[0]==200,'owner downloads stored bytes')
 before=state(a)
 check(save(a,ta,str(uuid.uuid4()))[0]==400,'failed upload cannot save nonexistent media reference')
 check(state(a)==before,'broken reference cannot partially save profile')
 handle='race-'+uuid.uuid4().hex[:12];barrier=threading.Barrier(2);windows=[]
 def claim(pair):
  token,asset=pair;barrier.wait(timeout=10);start=time.monotonic()
  result=http('/rest/v1/rpc/confirm_owned_storefront_handle',token,{'p_handle':handle,'p_logo_id':asset})
  windows.append((start,time.monotonic()));return result
 snapshots=[state(a),state(b)]
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(claim,zip([ta,tb],assets)))
 check(max(w[0] for w in windows)<min(w[1] for w in windows),'separate authenticated HTTP claim requests overlap')
 check(sorted(x[0] for x in results)==[200,400],'exactly one simultaneous claim winner and loser')
 check(sum(x[1].get('message')=='HANDLE_TAKEN' for x in results)==1,'loser receives HANDLE_TAKEN')
 check(local.sql('feature',f"select count(*) from public.organizers where handle='{handle}';").strip()=='1','one durable identity owner')
 winner=next(i for i,r in enumerate(results) if r[0]==200);loser=1-winner;owners=[a,b];tokens=[ta,tb];owner=owners[winner];token=tokens[winner]
 check(state(owners[loser])==snapshots[loser],'loser profile unchanged with no partial corruption')
 won=state(owner)
 expected=dict(snapshots[winner]);expected.update({k:won[k] for k in ['handle','handle_confirmed_at','onboarding_completed_at','updated_at']})
 check(won==expected and won['onboarding_completed_at'] is not None,'winner changes only identity/completion/version')
 for _ in range(2):
  retry=http('/rest/v1/rpc/confirm_owned_storefront_handle',token,{'p_handle':handle,'p_logo_id':assets[winner]})
  check(retry==results[winner] and state(owner)==won,'winning claim retry returns identical durable result without writes')
 for h,asset,msg in [('events',assets[loser],'HANDLE_INVALID'),('bad--handle',assets[loser],'HANDLE_INVALID'),('foreign-'+uuid.uuid4().hex[:8],assets[winner],'LOGO_NOT_OWNED')]:
  code,result=http('/rest/v1/rpc/confirm_owned_storefront_handle',tokens[loser],{'p_handle':h,'p_logo_id':asset});check(code==400 and result.get('message')==msg,msg+' enforced')
 code,result=http('/rest/v1/rpc/confirm_owned_storefront_handle',token,{'p_handle':'another-'+uuid.uuid4().hex[:8],'p_logo_id':None});check(code==400 and result.get('message')=='HANDLE_IMMUTABLE','permanent handle immutable')
 check(http('/functions/v1/organizer-media',body=png,mime='image/png')[0]==401,'anonymous upload denied')
 check(http('/functions/v1/organizer-media',token,png,mime='image/png',origin='https://foreign.invalid')[0]==403,'foreign origin denied')
 check(http('/functions/v1/organizer-media',token,b'failed replacement',mime='image/png')[0]==415,'replacement upload failure rejected for the same owner before retry')
 code,replacement=http('/functions/v1/organizer-media',token,png,mime='image/png');check(code==201,'valid retry after upload failure succeeds')
 check(save(owner,token,replacement['id'])[0]==200,'replacement attachment succeeds')
 replaced=state(owner);check(replaced['storefront_logo_asset_id']==replacement['id'] and all(replaced[k]==won[k] for k in ['handle','handle_confirmed_at','onboarding_completed_at']),'replacement persists without reclaiming handle/completion')
 retry=http('/rest/v1/rpc/confirm_owned_storefront_handle',token,{'p_handle':handle,'p_logo_id':assets[winner]});check(retry==results[winner] and state(owner)==replaced,'same-owner replay cannot overwrite replacement logo')
 code,unused=http('/functions/v1/organizer-media',token,png,mime='image/png');check(code==201,'unused upload created')
 check(http('/functions/v1/organizer-media',token,method='DELETE')[0]==200,'unused-media cleanup succeeds')
 check(http('/functions/v1/organizer-media?id='+replacement['id'],token,method='GET')[0]==200,'cleanup preserves attached replacement')
 for asset in [unused['id'],assets[winner]]:check(http('/functions/v1/organizer-media?id='+asset,token,method='GET')[0]==404,'cleanup removes unused or replaced media')
 check(http('/functions/v1/organizer-media?id='+assets[loser],tokens[loser],method='GET')[0]==200,'cleanup cannot remove another owner media')
 check(local.sql('feature','select jsonb_agg(to_jsonb(b) order by id) from storage.buckets b;')==bucket_before,'bucket definitions unchanged')
 check(local.sql('feature',"select bool_and(object_path ~ ('^'||owner_id::text||'/[0-9a-f-]+\\.png$')) from private.organizer_media;").strip()=='t','existing owner-prefixed storage path contract retained')
 c,tc,sc=user()
 fixture=ROOT/'.superpowers/organizer-onboarding-identity-v1/live-session.json'
 fd=os.open(fixture,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
 with os.fdopen(fd,'w') as f:json.dump({'api':BASE,'anon':CONFIG['ANON_KEY'],'session':sc,'owner':c},f)
 print('PASS real Storage/concurrency checks:',checks)
