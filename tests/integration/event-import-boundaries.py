#!/usr/bin/env python3
import importlib.util,json,uuid
from pathlib import Path
spec=importlib.util.spec_from_file_location('p',Path(__file__).with_name('event-import-proof.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
f=json.loads((p.ROOT/'.superpowers/event-import-proof/browser.json').read_text());a=f['actors'];admin=a['admin'];s=p.Session();p.sql=s.sql
p.sql('begin;create extension if not exists pgtap with schema extensions;set local search_path=public,extensions;select no_plan();')
def denied(statement,message):
 result=p.sql('select throws_ok($q$'+statement+'$q$);');assert 'not ok' not in result,(message,result)
try:
 for k in ['buyer','other','moderator','inactive']:
  p.sql(f"select set_config('request.jwt.claim.sub','{a[k]}',true);set local role authenticated;")
  denied('select public.list_event_import_batches()',k+' read');p.sql('reset role;')
 p.sql("set local role anon;");denied('select public.list_event_import_batches()','anonymous read');p.sql('reset role;')
 for setup in ["enabled=false","destination_organizer_id=null"]:
  p.sql('savepoint config;update private.event_import_settings set '+setup+';');denied(f"select public.server_create_event_import_batch('{admin}',gen_random_uuid(),repeat('a',64),'events.csv','[]','CSV_STRUCTURE_INVALID')",setup);p.sql('rollback to config;')
 for table,column,expression in [('public.organizers','onboarding_completed_at','null'),('auth.users','banned_until',"now()+interval '1 day'"),('auth.users','deleted_at','now()')]:
  p.sql(f"savepoint config;update {table} set {column}={expression} where id='{a['owner']}';");denied(f"select public.server_create_event_import_batch('{admin}',gen_random_uuid(),repeat('a',64),'events.csv','[]','CSV_STRUCTURE_INVALID')",column);p.sql('rollback to config;')
 b=p.upload(admin,[p.row(0,uuid.uuid4().hex)]);c=p.upload(admin,[p.row(0,uuid.uuid4().hex)]);rid=p.rows(c)[0]['id'];denied(f"select public.server_resolve_event_import_row('{admin}','{b}','{rid}','skip')",'wrong batch row')
 p.sql("update private.event_import_settings set budget_day=current_date,budget_limit=1,budget_used=1;");assert p.value(f"select public.server_claim_event_import_work('{admin}','{b}');")['kind']=='paused';p.sql("update private.event_import_settings set budget_used=0;");claim=p.value(f"select public.server_claim_event_import_work('{admin}','{b}');");assert claim['kind']=='claimed'
 p.sql(f"select public.server_complete_event_import_geocode('{admin}','{b}','{claim['rowId']}','{claim['token']}',1,'{{\"kind\":\"configuration_error\",\"code\":\"PROVIDER_AUTH\"}}');");assert p.value(f"select public.server_claim_event_import_work('{admin}','{c}');")['kind']=='paused'
 result={'deniedReadRoles':5,'destinationGuards':5,'foreignBatchRowDenied':True,'dailyBudgetExhaustion':True,'providerGlobalPause':True}
 (p.EVIDENCE/'boundaries.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
finally:p.sql('rollback;');s.close()
