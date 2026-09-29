"""Local-only publish proof. No hosted URLs, provider calls, or real agreements.

Uses a dedicated, explicitly named disposable proof stack. SQL suites roll back;
browser fixtures use unique IDs and are retained for founder inspection locally.
Credentials are written only to ignored task state with mode 0600.
"""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.superpowers/public-availability'
CONTAINER = 'supabase_db_wheretoo-public-availability'
API = 'http://127.0.0.1:59521'


def sql(statement):
    return subprocess.check_output(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], input=statement, text=True, timeout=90).strip()


def verify():
    info = json.loads(subprocess.check_output(['docker', 'inspect', CONTAINER], text=True))[0]
    assert info['Config']['Labels']['com.supabase.cli.project'] == 'wheretoo-public-availability'
    assert sql('show cron.launch_active_jobs;') == 'off'
    actual = set(sql('select version from supabase_migrations.schema_migrations;').splitlines())
    expected = {p.name.split('_')[0] for p in (ROOT / 'supabase/migrations').glob('*.sql')}
    assert actual - {'00000000000001'} == expected, 'Local migration ledger must match this branch'
    assert sql('select environment from private.organizer_policy_release_settings;') == 'development'
    OUT.mkdir(parents=True, exist_ok=True)


def private_json(name, value):
    fd = os.open(OUT / name, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, indent=2)


def request(path, token, body=None, method='POST'):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'apikey': token, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method=method)
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def setup():
    env = json.loads(subprocess.check_output(['docker', 'inspect', 'supabase_auth_wheretoo-public-availability'], text=True))[0]['Config']['Env']
    secret = next(v.split('=', 1)[1] for v in env if v.startswith('GOTRUE_JWT_SECRET='))
    def jwt(role):
        def b64(value):
            return base64.urlsafe_b64encode(value).decode().rstrip('=')
        data = b64(b'{"alg":"HS256","typ":"JWT"}') + '.' + b64(json.dumps({'role': role, 'iss': 'supabase', 'iat': int(time.time()), 'exp': int(time.time()) + 86400}).encode())
        return data + '.' + b64(hmac.new(secret.encode(), data.encode(), hashlib.sha256).digest())
    anon, service = jwt('anon'), jwt('service_role')
    email, password = 'publish-' + uuid.uuid4().hex + '@example.invalid', secrets.token_urlsafe(24)
    user = request('/auth/v1/admin/users', service, {'email': email, 'password': password, 'email_confirm': True})
    owner = user['id']
    session = request('/auth/v1/token?grant_type=password', anon, {'email': email, 'password': password})
    session['expires_at'] = int(time.time()) + session['expires_in']
    sql(f"insert into public.organizers(id,display_name,organizer_type,onboarding_completed_at) values('{owner}','Local Publication Proof','Community group',now());")
    sql(f"insert into public.organizer_stripe_accounts(organizer_id,stripe_account_id,transfers_status,payouts_status,requirements_status,requirements_currently_due_count,requirements_past_due_count,last_synced_at) values('{owner}','acct_localpublish{uuid.uuid4().hex}','active','active','clear',0,0,now());")
    events = {}
    for width in (390, 1440):
        for case in ('free', 'paid', 'risk', 'missing', 'policy', 'stale'):
            event = str(uuid.uuid4())
            events[f'{case}-{width}'] = event
            sql(f"""insert into public.events(id,organizer_id,title,description,category,starts_at,ends_at,timezone,venue_name,address_line1,city,region,postal_code,country_code,mapbox_feature_id,latitude,longitude,admission_type,capacity)
              values('{event}','{owner}','Local community gathering','A calm gathering for neighbors and local makers.','community',now()+interval '3 days',now()+interval '3 days 2 hours','America/Los_Angeles','Community Hall','1 Market Street','San Francisco','CA','94105','US','mapbox.local-publish-proof',37.7936,-122.3958,'{'paid' if case == 'paid' else 'free'}',30);""")
            if case == 'paid':
                sql(f"insert into public.ticket_tiers(event_id,name,unit_amount_minor,currency,quantity_total,status,sort_order) values('{event}','Local admission',1200,'usd',30,'draft',1);")
            if case in ('policy', 'stale'):
                requirements = {'minimum_age': 'all_ages', **{k: False for k in ('alcohol_present', 'cannabis_present', 'explicit_adult_content', 'gambling_present', 'weapons_present', 'high_risk_activity')}}
                request('/rest/v1/rpc/save_owned_event_requirements', session['access_token'], {'p_event_id': event, 'p_requirements': requirements})
                if case == 'stale':
                    request('/rest/v1/rpc/accept_current_event_policies', session['access_token'], {'p_event_id': event})
                    # Synthetic local edit invalidates that exact revision's acceptance.
                    sql(f"update public.events set title='Updated local community gathering' where id='{event}';")
    private_json('browser-fixtures.json', {'api': API, 'anon': anon, 'session': session, 'owner': owner, 'events': events})
    print('PASS: unique local fixtures created; no email/provider/hosted calls; credentials retained privately')


def expand(path):
    return re.sub(r'^\\ir\s+(.+)$', lambda m: expand(path.parent / m[1].strip()), path.read_text(), flags=re.M)


def suites():
    names = ['public_availability_publish', 'moderation_publish_eligibility', 'public_eligibility_projections', 'moderation_incomplete_contract', 'moderation_policy_acceptance', 'moderation_published_edits', 'moderation_evaluations', 'moderation_incomplete_enqueue', 'spec10_event_change_history', 'spec10_event_change_history_contract', 'spec10_event_change_history_review', 'paid_sales', 'spec13_discovery_read', 'spec13_discovery_security', 'event_import_authorization', 'event_import_schema']
    for name in names:
        statement = expand(ROOT / 'supabase/tests/database' / (name + '.test.sql'))
        # Global map assertions assume no pre-existing live fixtures. Isolate
        # previous browser/race events inside this rollback-only transaction.
        statement = statement.replace('begin;', "begin; update public.events set status='cancelled' where status='published';", 1)
        output = sql(statement)
        (OUT / (name + '.log')).write_text(output)
        failures = re.findall(r'^not ok.*$', output, re.M)
        assert not failures or (name == 'moderation_policy_acceptance' and failures == ['not ok 27 - the acceptance boundary has no client authority beyond event identity']), failures
        print(name, 'BASELINE INTROSPECTION FAILURE' if failures else 'PASS', re.search(r'^1\.\.\d+', output, re.M)[0])


def differential():
    baseline = 'supabase_db_wheretoo-organizer-profile-proof2'
    info = json.loads(subprocess.check_output(['docker', 'inspect', baseline], text=True))[0]
    assert info['Config']['Labels']['com.supabase.cli.project'] == 'wheretoo-organizer-profile-proof2'
    def main_sql(statement):
        return subprocess.check_output(['docker', 'exec', '-i', baseline, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], input=statement, text=True, timeout=90).strip()
    assert main_sql('show cron.launch_active_jobs;') == 'off'
    feature_versions = set(sql('select version from supabase_migrations.schema_migrations;').splitlines())
    main_versions = set(main_sql('select version from supabase_migrations.schema_migrations;').splitlines())
    assert feature_versions - main_versions == {'20260929010000'} and not main_versions - feature_versions
    definitions = "select jsonb_object_agg(p.oid::regprocedure::text,pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f';"
    old, new = json.loads(main_sql(definitions)), json.loads(sql(definitions))
    changed = sorted(key for key in old.keys() | new.keys() if old.get(key) != new.get(key))
    assert changed == ['private.event_has_only_organizer_edit_hold(uuid)', 'publish_event_without_change_history(uuid)'], changed
    marker = '  into v_can_clear_organizer_edit_hold;'
    assert new['publish_event_without_change_history(uuid)'] == old['publish_event_without_change_history(uuid)'].replace(marker, marker + '\n\n  v_can_clear_organizer_edit_hold := v_can_clear_organizer_edit_hold\n    or private.event_has_only_organizer_edit_hold(p_event_id);')
    print('PASS migration ledger and function differential: only private helper and exact publisher guard augmentation')
    total = 0
    # Every selected existing SQL suite runs on both targets with identical input.
    for path in sorted((ROOT / 'supabase/tests/database').glob('*.test.sql')):
        name = path.name.removesuffix('.test.sql')
        if not (OUT / (name + '.log')).exists():
            continue
        statement = expand(path).replace('begin;', "begin; update public.events set status='cancelled' where status='published';", 1)
        outputs = {'main': main_sql(statement), 'feature': sql(statement)}
        failures = {}
        for target, output in outputs.items():
            (OUT / (target + '-' + name + '.log')).write_text(output)
            failures[target] = re.findall(r'^not ok.*$', output, re.M)
        if name == 'public_availability_publish':
            assert failures['main'] and not failures['feature']
            print('PASS reproduced regression:', len(failures['main']), 'main failures; feature zero')
        else:
            assert failures['main'] == failures['feature'], (name, failures)
            assert not failures['feature'] or name == 'moderation_policy_acceptance', (name, failures)
            print('PASS differential', name, 'baseline failure count', len(failures['main']))
        total += int(re.search(r'^1\.\.(\d+)', outputs['feature'], re.M)[1])
    print('Feature SQL assertions:', total, '; baseline known failure: 1')


if __name__ == '__main__':
    verify()
    {'setup': setup, 'sql': suites, 'differential': differential}[sys.argv[1]]()
