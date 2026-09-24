#!/usr/bin/env python3
"""Rollback-only Waitlist suites on a freshly reset dedicated local database."""
import importlib.util,json,re
from pathlib import Path
s=importlib.util.spec_from_file_location('p',Path(__file__).with_name('waitlist-proof.py'));p=importlib.util.module_from_spec(s);s.loader.exec_module(p)
if (p.ROOT/'.supabase/waitlist/.proof-fixtures-present').exists():raise SystemExit('Reset only the dedicated Waitlist database before rollback suites.')
results=[]
for name in ['waitlist-v1','waitlist-mail','waitlist-purchase','waitlist-safety','waitlist-budget','waitlist-review']:
 out=p.sql(p.expand(Path(__file__).with_name(name+'.sql')))
 (p.ROOT/'.superpowers/waitlist-proof'/f'{name}-final.log').write_text(out)
 if re.search(r'^not ok ',out,re.M):raise SystemExit(name+' failed; inspect local proof log')
 count=len(re.findall(r'^ok ',out,re.M));assert count>0
 results.append({'suite':name,'passed':count});print(name,count,'PASS',flush=True)
(p.ROOT/'.superpowers/waitlist-proof/database-results.json').write_text(json.dumps(results,indent=2))
