#!/usr/bin/env python3
import importlib.util,json,base64,hmac,hashlib,time,subprocess
from pathlib import Path
spec=importlib.util.spec_from_file_location('p',Path(__file__).with_name('event-import-proof.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
a=p.seed();status=json.loads(subprocess.check_output(['pnpm','exec','supabase','status','--workdir',str(p.ROOT/'.supabase/event-import'),'-o','json'],cwd=p.ROOT,text=True,stderr=subprocess.DEVNULL));assert status['API_URL']=='http://127.0.0.1:60321'
def jwt(actor):
 enc=lambda x:base64.urlsafe_b64encode(json.dumps(x,separators=(',',':')).encode()).decode().rstrip('=')
 raw=enc({'alg':'HS256','typ':'JWT'})+'.'+enc({'sub':actor,'role':'authenticated','aud':'authenticated','iss':status['API_URL']+'/auth/v1','iat':int(time.time()),'exp':int(time.time())+14400})
 return raw+'.'+base64.urlsafe_b64encode(hmac.new(status['JWT_SECRET'].encode(),raw.encode(),hashlib.sha256).digest()).decode().rstrip('=')
f=dict(actors=a,tokens={k:jwt(v) for k,v in a.items()},api=status['API_URL'],anon=status['ANON_KEY'],service=status['SERVICE_ROLE_KEY'],origin='http://127.0.0.1:3090',edge='http://127.0.0.1:60330')
p.sql("notify pgrst, 'reload schema';")
target=p.ROOT/'.superpowers/event-import-proof/browser.json';target.parent.mkdir(exist_ok=True,parents=True);target.write_text(json.dumps(f));target.chmod(0o600)
print('Synthetic local browser identities created; credentials saved privately, no providers configured.')
