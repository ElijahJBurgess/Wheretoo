"""Fresh, explicitly allowlisted local proof stacks; never uses the old project or a linked DB."""
import importlib.util, json, pathlib, re, shutil, socket, subprocess, sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
BASELINE='b45b83e17793b9069d4f35d04dadd561e17c9594'
MIGRATION='20260924010900_consolidate_organizer_setup.sql'
PROJECTS={'main':('wheretoo-organizer-profile-main2',594), 'feature':('wheretoo-organizer-profile-proof2',593)}
def context(kind):
 project,prefix=PROJECTS[kind]
 return project,prefix,ROOT/'.supabase'/project

def prepare(kind,full=False):
 project,prefix,local=context(kind)
 # Reuse existing disposable function-copy conventions, with an isolated destination.
 spec=importlib.util.spec_from_file_location('organizer_local',ROOT/'tests/integration/organizer-profile-local.py')
 helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
 helper.LOCAL=local;helper.PROJECT=project;helper.prepare()
 target=local/'supabase'
 config=(target/'config.toml').read_text().replace('583',str(prefix))
 config=config.split('[functions.',1)[0]
 (target/'config.toml').write_text(config)
 migrations=target/'migrations'
 for p in migrations.glob('*.sql'):p.unlink()
 paths=subprocess.check_output(['git','ls-tree','-r','--name-only',BASELINE,'supabase/migrations'],cwd=ROOT,text=True,timeout=15).splitlines()
 for path in paths:
  (migrations/pathlib.Path(path).name).write_bytes(subprocess.check_output(['git','show',BASELINE+':'+path],cwd=ROOT,timeout=15))
 (migrations/'00000000000001_local_platform_defaults.sql').write_text((ROOT/'tests/integration/spec13-platform-bootstrap.sql').read_text())
 if full:
  assert kind=='feature'
  shutil.copy2(ROOT/'supabase/migrations'/MIGRATION,migrations/MIGRATION)
 return local

def sql(kind,q,admin=False,timeout=90):
 project,_,_=context(kind)
 info=json.loads(subprocess.check_output(['docker','inspect','supabase_db_'+project],text=True,timeout=15))[0]
 assert info['Config']['Labels'].get('com.supabase.cli.project')==project
 return subprocess.check_output(['docker','exec','-i',info['Id'],'psql','-X','-U','supabase_admin' if admin else 'postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'],input=q,text=True,timeout=timeout)

def configure(kind):
 sql(kind,"select cron.alter_job(jobid,active:=false) from cron.job; select private.configure_policy_environment('development');")
 sql(kind,'grant set on parameter session_replication_role to postgres; alter system set cron.launch_active_jobs=off; select pg_reload_conf();',admin=True)
 sql(kind,'create extension if not exists pgtap with schema extensions;')

def expand(p):
 return '\n'.join(expand(p.parent/line[4:]) if line.startswith('\\ir ') else line for line in p.read_text().splitlines())

if __name__=='__main__':
 action,kind=sys.argv[1:3];project,prefix,local=context(kind)
 if action=='prepare':
  ports=list(range(prefix*100+20,prefix*100+30));sockets=[]
  try:
   for port in ports:
    s=socket.socket();s.bind(('0.0.0.0',port));sockets.append(s)
   print('All candidate ports free:',ports)
  finally:
   for s in sockets:s.close()
  prepare(kind,'--full' in sys.argv);print(project,'prepared')
 elif action in ('start','reset'):
  assert ('project_id = "'+project+'"') in (local/'supabase/config.toml').read_text()
  cmd=['pnpm','exec','supabase']+(['start','--exclude','studio,imgproxy,logflare,vector,supavisor,inbucket,realtime,edge-runtime'] if action=='start' else ['db','reset','--local','--yes'])+['--workdir',str(local)]
  subprocess.run(cmd,cwd=ROOT,stdout=subprocess.DEVNULL,check=True,timeout=300)
  configure(kind);print(action,project,'PASS')
 elif action=='sql':print(sql(kind,sys.stdin.read()))
 elif action=='serve':
  assert kind=='feature'
  subprocess.run(['pnpm','exec','supabase','functions','serve','--workdir',str(local),'--env-file',str(local/'functions.env'),'--no-verify-jwt','--import-map',str(ROOT/'deno.json')],cwd=ROOT,check=True)
 else:raise SystemExit('prepare|start|reset|sql|serve main|feature')
