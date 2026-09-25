"""Real local Storage, ownership, handle-race proof. Uses only the storefront stack."""
import base64, concurrent.futures, importlib.util, json, subprocess, uuid, urllib.request, urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('local',ROOT/'tests/integration/organizer-profile-local.py'); local=importlib.util.module_from_spec(spec);spec.loader.exec_module(local)
CONFIG=json.loads(subprocess.check_output(['pnpm','exec','supabase','status','--workdir',str(local.LOCAL),'-o','json'],cwd=ROOT,text=True,stderr=subprocess.DEVNULL));BASE=CONFIG['API_URL'];assert BASE=='http://127.0.0.1:58321'
def http(path,token=None,body=None,method='POST',mime='application/json',origin='http://127.0.0.1:3084'):
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
 local.sql(f"insert into public.organizers(id,display_name) values('{u['id']}','Storefront proof');")
 return u['id'],s['access_token']
if __name__=='__main__':
 a,ta=user();b,tb=user()
 png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC')
 assets=[]
 for token in [ta,tb]:
  code,result=http('/functions/v1/organizer-media',token,png,mime='image/png');check(code==201,'real organizer logo upload');assets.append(result['id'])
 check(http('/functions/v1/organizer-media',ta,b'<svg></svg>',mime='image/svg+xml')[0]==415,'SVG rejected')
 check(http('/functions/v1/organizer-media',ta,b'not an image',mime='image/png')[0]==415,'forged MIME rejected')
 check(http('/functions/v1/organizer-media?id='+assets[0],method='GET')[0]==404,'draft image private')
 check(http('/functions/v1/organizer-media?id='+assets[0],tb,method='GET')[0]==404,'foreign owner cannot preview')
 check(http('/functions/v1/organizer-media?id='+assets[0],ta,method='GET')[0]==200,'owner can preview')
 handle='race-'+uuid.uuid4().hex[:12]
 def claim(pair):
  token,asset=pair
  return http('/rest/v1/rpc/confirm_owned_storefront_handle',token,{'p_handle':handle,'p_logo_id':asset})
 with concurrent.futures.ThreadPoolExecutor() as pool: results=list(pool.map(claim,zip([ta,tb],assets)))
 check(sorted(x[0] for x in results)==[200,400],'database resolves simultaneous handle race')
 check(sum(x[1].get('message')=='HANDLE_TAKEN' for x in results)==1,'loser gets actionable conflict')
 check(local.sql(f"select count(*) from public.organizers where handle='{handle}';").strip()=='1','exactly one permanent claim')
 check(http('/functions/v1/organizer-media',body=png,mime='image/png')[0]==401,'Anonymous upload denied')
 check(http('/functions/v1/organizer-media',ta,png,mime='image/png',origin='https://foreign.invalid')[0]==403,'Foreign origin upload denied')
 check(http('/functions/v1/organizer-media',ta,b'x'*5242881,mime='image/png')[0]==413,'Oversized upload bounded')
 winner=next(i for i,result in enumerate(results) if result[0]==200);wt=[ta,tb][winner]
 code,unused=http('/functions/v1/organizer-media',wt,png,mime='image/png');check(code==201,'Unused image upload')
 check(http('/functions/v1/organizer-media',wt,method='DELETE')[0]==200,'Owner clears unused uploads')
 check(http('/functions/v1/organizer-media?id='+assets[winner],wt,method='GET')[0]==200,'Cleanup preserves referenced identity')
 check(http('/functions/v1/organizer-media?id='+unused['id'],wt,method='GET')[0]==404,'Cleanup removes unused image')
 print('Identity HTTP/concurrency checks:',checks)
