"""Dedicated loopback organizer profile proof stack. Never reads a linked project."""
import json, pathlib, re, subprocess, sys, shutil
ROOT=pathlib.Path(__file__).resolve().parents[2]
LOCAL=ROOT/'.supabase/organizer-profile'
PROJECT='wheretoo-organizer-profile'
CLI=['pnpm','exec','supabase']
def prepare():
 target=LOCAL/'supabase'; target.mkdir(parents=True,exist_ok=True)
 config=(ROOT/'supabase/config.toml').read_text().replace('543','583')
 config=re.sub(r'project_id = "[^"]+"',f'project_id = "{PROJECT}"',config)
 config=re.sub(r'(\[db.seed\][^[]*?)enabled = true',r'\1enabled = false',config)
 config=re.sub(r'(\[analytics\]\s*\n)enabled = true',r'\1enabled = false',config)
 config=config[:config.index('[functions.')] + ''.join(f'\n[functions.{p.name}]\nverify_jwt = false\nimport_map = "../deno.json"\n' for p in [ROOT/'supabase/functions'/name for name in ['event-images','organizer-media','storefront-telemetry','free-rsvp','free-rsvp-status','ticket-collection']])
 (target/'config.toml').write_text(config)
 migrations=target/'migrations'
 if migrations.is_symlink(): migrations.unlink()
 migrations.mkdir(exist_ok=True)
 (migrations/'00000000000001_local_platform_defaults.sql').write_text((ROOT/'tests/integration/spec13-platform-bootstrap.sql').read_text())
 for migration in (ROOT/'supabase/migrations').glob('*.sql'): shutil.copy2(migration,migrations/migration.name)
 if (target/'functions').is_symlink(): (target/'functions').unlink()
 for folder in ['event-images','organizer-media','storefront-telemetry','free-rsvp','free-rsvp-status','ticket-collection','stripe-create-checkout','stripe-connect-session','_shared']:
  dest=target/'functions'/folder;dest.mkdir(parents=True,exist_ok=True)
  names=[p.name for p in (ROOT/'supabase/functions'/folder).glob('*.ts')]
  for name in names: shutil.copy2(ROOT/'supabase/functions'/folder/name,dest/name)
 if (LOCAL/'src').is_symlink(): (LOCAL/'src').unlink()
 (LOCAL/'src/features/rsvp').mkdir(parents=True,exist_ok=True)
 shutil.copy2(ROOT/'src/features/rsvp/rsvp.contract.ts',LOCAL/'src/features/rsvp/rsvp.contract.ts')
 (LOCAL/'src/features/ticket-experience/contracts').mkdir(parents=True,exist_ok=True)
 shutil.copy2(ROOT/'src/features/ticket-experience/contracts/ticketCollection.ts',LOCAL/'src/features/ticket-experience/contracts/ticketCollection.ts')
 (LOCAL/'deno.json').write_text((ROOT/'deno.json').read_text())
 (LOCAL/'functions.env').write_text('APP_BASE_URL=http://127.0.0.1:3084\nTICKET_CREDENTIAL_SECRET='+__import__('base64').urlsafe_b64encode(bytes([7]*32)).decode().rstrip('=')+'\n')
def sql(q,platform_admin=False):
 info=json.loads(subprocess.check_output(['docker','inspect','supabase_db_'+PROJECT],text=True))[0]
 assert info['Config']['Labels'].get('com.supabase.cli.project')==PROJECT
 return subprocess.check_output(['docker','exec','-i',info['Id'],'psql','-X','-U','supabase_admin' if platform_admin else 'postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'],input=q,text=True)
def expand(p):
 return '\n'.join(expand(p.parent/line[4:]) if line.startswith('\\ir ') else line for line in p.read_text().splitlines())
if __name__=='__main__':
 action=sys.argv[1]; prepare()
 if action=='start':
  subprocess.run(CLI+['start','--workdir',str(LOCAL),'--exclude','studio,imgproxy,logflare,vector,supavisor,inbucket,realtime'],cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
  sql('select cron.alter_job(jobid,active:=false) from cron.job;')
  print('Dedicated storefront local stack: 127.0.0.1:58321')
 elif action=='reset':
  subprocess.run(CLI+['db','reset','--local','--workdir',str(LOCAL),'--yes'],cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
  sql("select cron.alter_job(jobid,active:=false) from cron.job; select private.configure_policy_environment('development');")
  # Existing corruption-detection tests require this disposable platform privilege.
  sql('grant set on parameter session_replication_role to postgres;',platform_admin=True)
 elif action=='sql': print(sql(sys.stdin.read()))
 elif action=='apply':
  for name in sys.argv[2:]:
   p=ROOT/'supabase/migrations'/name
   assert p.name.startswith('20260924') and p.parent==ROOT/'supabase/migrations'
   print(sql('begin;'+p.read_text()+'commit;'))
 elif action=='test':
  for name in sys.argv[2:]:
   p=ROOT/'supabase/tests/database'/name
   q=expand(p); assert 'rollback;' in q.lower()
   result=sql(q)
   if 'not ok ' in result: raise SystemExit(result)
   print(name+': '+next(x for x in result.splitlines() if x.startswith('1..')))
 elif action=='serve': subprocess.run(CLI+['functions','serve','--workdir',str(LOCAL),'--env-file',str(LOCAL/'functions.env'),'--no-verify-jwt','--import-map',str(ROOT/'deno.json')],cwd=ROOT,check=True)
 else: raise SystemExit('start|sql|apply|test|serve')
