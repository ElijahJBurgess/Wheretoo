"""Identical pristine-main SQL inventory on two isolated proof stacks; JSON comparison."""
import hashlib,importlib.util,json,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('local',ROOT/'tests/integration/organizer-profile-proof2.py');local=importlib.util.module_from_spec(spec);spec.loader.exec_module(local)
OUT=ROOT/'.superpowers/organizer-onboarding-identity-v1/sql-differential';OUT.mkdir(parents=True,exist_ok=True)
paths=subprocess.check_output(['git','ls-tree','-r','--name-only',local.BASELINE,'supabase/tests/database'],cwd=ROOT,text=True,timeout=15).splitlines()
inventory=[p for p in paths if p.endswith('.test.sql')]

def run(kind):
 project,_,_=local.context(kind)
 info=json.loads(subprocess.check_output(['docker','inspect','supabase_db_'+project],text=True,timeout=15))[0]
 assert info['Config']['Labels']['com.supabase.cli.project']==project
 results=[]
 for path in inventory:
  p=ROOT/path;original=subprocess.check_output(['git','show',local.BASELINE+':'+path],cwd=ROOT,timeout=15)
  assert p.read_bytes()==original,'Common inventory modified: '+path
  q=local.expand(p);assert 'rollback;' in q.lower()
  try:
   r=subprocess.run(['docker','exec','-i',info['Id'],'psql','-X','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'],input=q,text=True,capture_output=True,timeout=90)
  except subprocess.TimeoutExpired:
   raise SystemExit('Infrastructure/test timeout: '+kind+' '+path)
  (OUT/(kind+'-'+p.name+'.log')).write_text(r.stdout+'\nSTDERR\n'+r.stderr)
  assertions=re.findall(r'^(?:not )?ok \d+[^\n]*',r.stdout,re.M)
  failures=[a for a in assertions if a.startswith('not ok ')]
  result={'file':p.name,'sha256':hashlib.sha256(original).hexdigest(),'exit':r.returncode,'plans':re.findall(r'^1\.\.\d+',r.stdout,re.M),'assertions':assertions,'failures':failures,'errors':[line for line in r.stderr.splitlines() if 'ERROR:' in line]}
  result['passed']=r.returncode==0 and bool(assertions) and not failures and bool(result['plans']) and sum(int(plan[3:]) for plan in result['plans'])==len(assertions)
  results.append(result);(OUT/(kind+'.json')).write_text(json.dumps(results,indent=2))
  print(kind,p.name,'PASS' if result['passed'] else 'FAIL',len(assertions),flush=True)
 print(kind,'TOTAL',len(results),'suites',sum(len(r['assertions']) for r in results),'assertions',flush=True)

def compare():
 a=json.loads((OUT/'main.json').read_text());b=json.loads((OUT/'feature.json').read_text())
 assert len(a)==len(b)==len(inventory)
 # pg_proc enumeration has no ORDER BY in the inherited import ACL test.
 # Compare assertion outcomes/labels as a multiset, retaining every duplicate.
 def canonical(result):
  return {**result,'assertions':sorted(re.sub(r'^(not ok|ok) \d+',r'\1',line) for line in result['assertions']), 'failures':sorted(re.sub(r'^not ok \d+','not ok',line) for line in result['failures'])}
 differences=[{'main':x,'feature':y} for x,y in zip(a,b) if canonical(x)!=canonical(y)]
 summary={'inventory':len(a),'assertions':sum(len(x['assertions']) for x in a),'main_failed':[x['file'] for x in a if not x['passed']],'feature_failed':[x['file'] for x in b if not x['passed']],'differences':differences}
 (OUT/'comparison.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))
 if differences:raise SystemExit(1)
if __name__=='__main__':
 if sys.argv[1]=='compare':compare()
 else:run(sys.argv[1])
