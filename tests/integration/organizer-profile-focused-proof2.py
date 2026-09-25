"""Feature contract tests, pristine-main cron differential, and replay-ledger proof."""
import importlib.util,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('local',ROOT/'tests/integration/organizer-profile-proof2.py');local=importlib.util.module_from_spec(spec);spec.loader.exec_module(local)
OUT=ROOT/'.superpowers/organizer-onboarding-identity-v1'
if __name__=='__main__':
 for name in ['organizer_setup.test.sql','storefront_identity.test.sql']:
  result=local.sql('feature',local.expand(ROOT/'supabase/tests/database'/name))
  (OUT/('resume-focused-'+name+'.log')).write_text(result)
  assert 'not ok ' not in result and re.search(r'^1\.\.\d+',result,re.M),name
  print('PASS',name,re.search(r'^1\.\.\d+',result,re.M).group())
 # Two inherited contracts assert active=true. Verify that exact contract inside
 # rollback only, with the scheduler disabled at the server level on both stacks.
 for kind in ['main','feature']:
  assert local.sql(kind,"show cron.launch_active_jobs;").strip()=='off'
  for name in ['checkout_integrity_expiry.test.sql','moderation_retention_schedule.test.sql']:
   q=local.expand(ROOT/'supabase/tests/database'/name)
   q=q.replace('begin;','begin; select cron.alter_job(jobid,active:=true) from cron.job;',1)
   result=local.sql(kind,q);(OUT/('resume-cron-'+kind+'-'+name+'.log')).write_text(result)
   assert 'not ok ' not in result,name
   print('PASS',kind,'rollback-only active job contract',name)
  assert local.sql(kind,'select count(*) from cron.job where active;').strip()=='0'
 versions={kind:local.sql(kind,'select version from supabase_migrations.schema_migrations order by version;').splitlines() for kind in ['main','feature']}
 assert set(versions['feature'])-set(versions['main'])=={'20260924010900'}
 assert not set(versions['main'])-set(versions['feature'])
 (OUT/'resume-replay-ledgers.json').write_text(json.dumps(versions,indent=2))
 print('PASS fresh migration-chain ledgers; only feature migration differs')
