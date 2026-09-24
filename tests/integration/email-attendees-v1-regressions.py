#!/usr/bin/env python3
"""Compare existing SQL suites on dedicated local Email Attendees feature/baseline databases."""
from pathlib import Path
import subprocess,json,sys
ROOT=Path(__file__).resolve().parents[2]
label=sys.argv[1]
assert label in ('baseline','feature')
if label == 'feature' and (ROOT / '.supabase/email-attendees/.proof-fixtures-present').exists():
    raise SystemExit('Persistent proof fixtures exist. Reset only the dedicated local feature DB before legacy regression: python3 tests/integration/run-email-attendees-local.py reset')
db='supabase_db_wheretoo-email-attendees'+('-baseline' if label=='baseline' else '')
out=ROOT/'.superpowers/email-proof'/label;out.mkdir(parents=True,exist_ok=True)
remote='/tmp/email-regressions'
subprocess.run(['docker','exec',db,'mkdir','-p',remote+'/tests',remote+'/migrations'],check=True)
subprocess.run(['docker','cp',str(ROOT/'supabase/tests')+'/.',db+':'+remote+'/tests'],check=True)
migrations=ROOT/('.supabase/email-attendees-baseline/supabase/migrations' if label=='baseline' else 'supabase/migrations')
subprocess.run(['docker','cp',str(migrations)+'/.',db+':'+remote+'/migrations'],check=True)
files=subprocess.check_output(['git','ls-tree','-r','--name-only','8138cdf2d6f84ff98d7ca42b595a9f87f9f7b66a','supabase/tests/database'],cwd=ROOT,text=True).splitlines()
results=[]
for name in files:
 if not name.endswith('.sql'):continue
 setup="begin; select private.configure_policy_environment('development'); select cron.alter_job(jobid,active:=true) from cron.job;\n"
 result=subprocess.run(['docker','exec','-i',db,'psql','-X','-U','postgres','-At','-v','ON_ERROR_STOP=1'],input=setup+'\\i '+remote+'/tests/database/'+Path(name).name+'\n',text=True,capture_output=True)
 output=result.stdout+result.stderr
 (out/(Path(name).name+'.log')).write_text(output)
 errors=[line for line in output.splitlines() if 'ERROR:' in line or line.startswith('not ok ')]
 results.append({'file':Path(name).name,'pass':result.returncode==0 and not errors,'assertions':sum(line.startswith('ok ') for line in output.splitlines()),'errors':errors})
(out/'results.json').write_text(json.dumps(results,indent=2))
print(json.dumps({'label':label,'suites':len(results),'passed':sum(r['pass'] for r in results),'failed':[r['file'] for r in results if not r['pass']]},indent=2))
