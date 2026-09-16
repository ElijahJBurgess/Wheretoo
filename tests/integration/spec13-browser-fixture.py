#!/usr/bin/env python3
"""Seed once, solely in the recorded Spec 13 disposable database. No providers."""
import importlib.util,json,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('db',ROOT/'tests/integration/spec13-database.py');db=importlib.util.module_from_spec(spec);spec.loader.exec_module(db)
path=ROOT/'.superpowers/spec13/browser-fixture.json'
if path.exists():
 db.verify();print(path.read_text());raise SystemExit(0)
sql=db.expand(ROOT/'supabase/tests/database/spec13_fixture.inc').replace('d1300000','e1300000').replace('d1310000','e1310000').replace('Discovery fixture','Local discovery proof').replace('spec13-owner@','spec13-browser-owner@').replace('acct_spec13rollback','acct_spec13browser')
db.sql('begin;\n'+sql+'\ncommit;')
fixture={'ownerId':'e1300000-0000-4000-8000-000000000001','freeEventId':'e1310000-0000-4000-8000-000000000001','paidEventId':'e1310000-0000-4000-8000-000000000002','eventCount':64,'rest':'http://127.0.0.1:55566','edge':'http://127.0.0.1:55567'}
path.write_text(json.dumps(fixture,indent=2)+'\n');print(json.dumps(fixture))
