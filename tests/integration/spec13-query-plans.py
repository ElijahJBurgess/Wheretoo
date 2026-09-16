#!/usr/bin/env python3
"""Rollback-only representative query/cleanup plans in recorded Spec13 DB."""
import importlib.util,pathlib,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('db',ROOT/'tests/integration/spec13-database.py');db=importlib.util.module_from_spec(spec);spec.loader.exec_module(db)
fixture=db.expand(ROOT/'supabase/tests/database/spec13_fixture.inc').replace('d1300000','f1300000').replace('d1310000','f1310000').replace('spec13-owner@','spec13-plans-owner@').replace('acct_spec13rollback','acct_spec13plans').replace('generate_series(1,64)','generate_series(1,2048)')
fixture=fixture.replace("statement_timestamp()+interval '1 day',statement_timestamp()+interval '1 day 2 hours'", "statement_timestamp()+make_interval(days=>1+n%28),statement_timestamp()+make_interval(days=>1+n%28,hours=>2)")
fixture=fixture[fixture.index('insert into auth.users'):]
base="""select e.id,e.title,e.category,e.admission_type,e.starts_at,e.ends_at,e.timezone,e.venue_name,e.city
from public.events e where e.status='published' and e.moderation_status='clear'
and e.starts_at<((statement_timestamp() at time zone 'America/Los_Angeles')::date+30)::timestamp at time zone 'America/Los_Angeles'
and e.ends_at>statement_timestamp()
and extensions.st_intersects(e.location::extensions.geometry,extensions.st_makeenvelope(-123.6,36.8,-121,38.9,4326))
and (e.admission_type='free' or exists(select 1 from public.ticket_tiers t where t.event_id=e.id and t.status='active'))
and private.event_is_publicly_eligible(e.id,statement_timestamp())
{extra} order by e.starts_at,e.id limit 21"""
queries={'default':'','category_paid':"and e.category='music' and e.admission_type='paid'",'free':"and e.admission_type='free'",'deep_cursor':"and (e.starts_at,e.id)>(statement_timestamp()+interval '20 days','f1310000-0000-4000-8000-000000000001'::uuid)"}
ordered=base.replace("and private.event_is_publicly_eligible(e.id,statement_timestamp())\n",'').replace(' limit 21',' offset 0')
fenced="select candidates.* from ("+ordered+") candidates where private.event_is_publicly_eligible(candidates.id,statement_timestamp()) order by candidates.starts_at,candidates.id limit 21"
text='begin;\nset local statement_timeout=\'90s\';\n'+fixture+"\ninsert into public.events(organizer_id,title) select 'f1300000-0000-4000-8000-000000000001','Plan-only draft' from generate_series(1,4096);\nanalyze public.events;analyze public.ticket_tiers;\n"
for variant,query in [('original',base),('ordered',fenced)]:
 for name,extra in queries.items():
  text+=f"select 'PLAN {variant}_{name}';\nexplain (analyze,buffers,format json) "+query.format(extra=extra)+';\n'
text+="set local session_replication_role=replica;update public.events set starts_at=statement_timestamp()-interval '1 day',ends_at=statement_timestamp()+interval '1 day' where organizer_id='f1300000-0000-4000-8000-000000000001' and status='published';set local session_replication_role=origin;analyze public.events;\n"
for variant,query in [('original',base),('ordered',fenced)]:
 text+=f"select 'PLAN {variant}_overlapping';\nexplain (analyze,buffers,format json) "+query.format(extra='')+';\n'
text+='rollback;'
try: print(db.sql(text))
except subprocess.CalledProcessError as error:
 print(error.stdout); print(error.stderr); raise
