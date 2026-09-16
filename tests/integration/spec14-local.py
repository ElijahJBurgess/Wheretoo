#!/usr/bin/env python3
"""Explicit, identity-checked Spec 14 local environment operations.

No implicit reset, linked project, target override, hosted URL or provider access.
Synthetic secrets stay in ignored task state. Historical migration bytes are preserved.
"""
import argparse
import base64
import hashlib
import hmac
import http.client
import json
import os
from pathlib import Path
import re
import secrets
import signal
import socket
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / '.superpowers/spec14'
IDENTITY = STATE / 'environment-identity.json'
CONFIG = STATE / 'local-secrets.json'
TASK = 'spec14-final-assembly'
NETWORK = 'wheretoo-spec14-local'
ORIGIN = 'http://127.0.0.1:3040'
IMAGES = {
    'db': 'public.ecr.aws/supabase/postgres:17.6.1.155',
    'rest': 'public.ecr.aws/supabase/postgrest:v14.15',
    'auth': 'public.ecr.aws/supabase/gotrue:v2.195.0',
    'inbox': 'public.ecr.aws/supabase/mailpit:v1.30.2',
    'meta': 'public.ecr.aws/supabase/postgres-meta:v0.98.0',
}
PORTS = {'db': (55645, '5432/tcp'), 'rest': (55646, '3000/tcp'), 'auth': (55648, '9999/tcp'), 'inbox': (55649, '8025/tcp'), 'meta': (55650, '8080/tcp')}


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def output(args, **kwargs):
    return run(args, capture_output=True, **kwargs).stdout


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def private_open(path, mode='w'):
    """Protect an existing file before writing any potentially private payload."""
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.parent.chmod(0o700)
    flags = os.O_WRONLY | os.O_CREAT | (os.O_APPEND if mode == 'a' else os.O_TRUNC)
    descriptor = os.open(path, flags, 0o600)
    os.fchmod(descriptor, 0o600)
    return os.fdopen(descriptor, mode)


def save(path, value):
    temporary = path.with_name(path.name + '.' + secrets.token_hex(8) + '.tmp')
    with private_open(temporary) as stream:
        stream.write(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def record_runner_error(action, error):
    """Preserve each private failure while retaining the familiar latest pointer."""
    if not isinstance(action, str) or not action or any(not (character.isalnum() or character == '-') for character in action):
        action = 'unknown'
    path = STATE / ('runner-error-' + str(time.time_ns()) + '-' + action + '.log')
    detail = str(error) + '\n' + (getattr(error, 'stderr', '') or '')
    with private_open(path) as stream:
        stream.write('action=' + action + '\n' + detail)
    with private_open(STATE / 'last-runner-error.log') as stream:
        stream.write('evidence=' + path.name + '\n' + detail)
    return path


def identity():
    value = json.loads(IDENTITY.read_text())
    require(value['task'] == TASK and value['root'] == str(ROOT), 'Wrong task workspace identity')
    return value


def verify_container(live, known, database=False):
    """Reject replacement resources, shared bindings and active cron before access."""
    require(live['Id'] == known['id'], 'Container identity changed')
    require(live['Name'] == '/' + known['name'], 'Container name changed')
    require(live['Image'] == known['image'], 'Container image changed')
    require(live['Config']['Labels'].get('wheretoo.task') == TASK, 'Container is not task-owned')
    binding = live['NetworkSettings']['Ports'].get(known['internalPort'])
    if known.get('internalOnly'):
        require(not binding, 'Internal backend unexpectedly exposed a host port')
    else:
        require(binding == [{'HostIp': '127.0.0.1', 'HostPort': str(known['port'])}], 'Container is not on its recorded loopback port')
    if database:
        require('cron.launch_active_jobs=off' in live['Config']['Cmd'], 'Cron launcher must stay disabled')


def verify(role='db', marker=True):
    record = identity()
    network = json.loads(output(['docker', 'network', 'inspect', record['network']['id']]))[0]
    require(network['Id'] == record['network']['id'] and network['Name'] == NETWORK, 'Network identity changed')
    require(network['Internal'] and network['Labels'].get('wheretoo.task') == TASK, 'Network must deny external routing')
    known = record['containers'][role]
    live = json.loads(output(['docker', 'inspect', known['id']]))[0]
    verify_container(live, known, database=role == 'db')
    require(set(live['NetworkSettings']['Networks']) == {NETWORK}, 'Unexpected container network')
    if role == 'db' and marker:
        current = json.loads(raw_sql(known['id'], "select json_build_object('instanceId', instance_id, 'cron', current_setting('cron.launch_active_jobs')) from spec14_control.identity;", tuples=True))
        require(current['instanceId'] == record['instanceId'], 'Database task marker changed')
        require(current['cron'] == 'off', 'Cron enabled at runtime')
    return known['id']


def raw_sql(container, text, tuples=False):
    args = ['docker', 'exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres']
    if tuples:
        args += ['-At']
    return output(args, input=text)


def sql(text, tuples=False):
    return raw_sql(verify(), text, tuples=tuples)


def available(port):
    with socket.socket() as connection:
        connection.bind(('127.0.0.1', port))


def env_file(role, values):
    require(all('\n' not in str(value) for value in values.values()), 'Invalid environment value')
    path = STATE / (role + '.env.synthetic')
    with private_open(path) as stream:
        stream.write(''.join(key + '=' + str(value) + '\n' for key, value in values.items()))
    return path


def create_container(role, values, arguments=(), mount=None):
    record = identity()
    name = 'wheretoo-spec14-' + role
    require(role not in record['containers'], 'Resource already recorded; refusing replacement')
    require(subprocess.run(['docker', 'inspect', name], capture_output=True).returncode != 0, 'Resource name already exists')
    host, internal = PORTS[role]
    available(host)
    image_id = output(['docker', 'image', 'inspect', IMAGES[role], '--format', '{{.Id}}']).strip()
    args = ['docker', 'run', '--pull', 'never', '--name', name, '--label', 'wheretoo.task=' + TASK,
            '--network', NETWORK,
            '--env-file', str(env_file(role, values))]
    if mount:
        volume_name, target = mount
        require(subprocess.run(['docker', 'volume', 'inspect', volume_name], capture_output=True).returncode != 0, 'Volume exists; refusing replacement')
        output(['docker', 'volume', 'create', '--label', 'wheretoo.task=' + TASK, volume_name])
        record['volumes'].append(volume_name)
        save(IDENTITY, record)
        args += ['--mount', f'type=volume,source={volume_name},target={target}']
    container = output(args + ['-d', image_id, *arguments]).strip()
    record['containers'][role] = {'id': container, 'name': name, 'image': image_id, 'imageTag': IMAGES[role], 'port': host, 'internalPort': internal, 'internalOnly': True}
    save(IDENTITY, record)
    verify(role, marker=False)
    return container


def create():
    require(not IDENTITY.exists(), 'Environment already recorded. Use verify/start, never replace it.')
    require(not CONFIG.exists(), 'Unowned local configuration exists; inspect before creation')
    for port in [3040, 55647, *(value[0] for value in PORTS.values())]:
        available(port)
    for role, image in IMAGES.items():
        require(subprocess.run(['docker', 'inspect', 'wheretoo-spec14-' + role], capture_output=True).returncode != 0, 'Task container name already exists')
        output(['docker', 'image', 'inspect', image, '--format', '{{.Id}}'])
    require(subprocess.run(['docker', 'network', 'inspect', NETWORK], capture_output=True).returncode != 0, 'Task network exists; inspect before creation')
    network = output(['docker', 'network', 'create', '--internal', '--label', 'wheretoo.task=' + TASK, NETWORK]).strip()
    configuration = {'password': secrets.token_hex(24), 'jwtSecret': secrets.token_hex(32), 'credentialSecret': secrets.token_urlsafe(32), 'emailKey': base64.b64encode(secrets.token_bytes(32)).decode(), 'workerSecret': secrets.token_hex(32)}
    save(CONFIG, configuration)
    save(IDENTITY, {'task': TASK, 'root': str(ROOT), 'instanceId': str(uuid.uuid4()), 'network': {'id': network, 'name': NETWORK}, 'containers': {}, 'volumes': [], 'migrations': []})
    db = create_container('db', {'POSTGRES_PASSWORD': configuration['password']}, ['-c', 'listen_addresses=*', '-c', 'shared_preload_libraries=pg_stat_statements,pg_cron', '-c', 'cron.database_name=postgres', '-c', 'cron.launch_active_jobs=off'], ('wheretoo-spec14-db-data', '/var/lib/postgresql/data'))
    finish_create()


def finish_create():
    """Resume only the already recorded task setup; never replace any resource."""
    record = identity()
    configuration = json.loads(CONFIG.read_text())
    db = verify('db', marker=False)
    for _ in range(60):
        verify('db', marker=False)
        if subprocess.run(['docker', 'exec', db, 'pg_isready', '-h', '127.0.0.1', '-U', 'supabase_admin'], capture_output=True).returncode == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError('Task database did not become ready')
    # First marker write has no existing marker; recorded container/network/cron checked above.
    if raw_sql(db, "select to_regclass('spec14_control.identity') is null;", tuples=True).strip() == 't':
        require(raw_sql(db, "select to_regclass('public.organizers') is null;", tuples=True).strip() == 't', 'Unmarked application database; refusing adoption')
        raw_sql(db, "create schema spec14_control; revoke all on schema spec14_control from public; create table spec14_control.identity(instance_id text primary key); insert into spec14_control.identity values ('" + record['instanceId'] + "');")
    password = configuration['password']
    sql("alter role authenticator with login password '" + password + "'; alter role supabase_auth_admin with login password '" + password + "';")
    if 'inbox' not in identity()['containers']:
        create_container('inbox', {'MP_DATABASE': '/data/mailpit.db'}, mount=('wheretoo-spec14-inbox-data', '/data'))
    if 'auth' not in identity()['containers']:
        create_container('auth', {
        'GOTRUE_API_HOST': '0.0.0.0', 'GOTRUE_API_PORT': '9999', 'API_EXTERNAL_URL': 'http://127.0.0.1:55647',
        'GOTRUE_DB_DRIVER': 'postgres', 'GOTRUE_DB_DATABASE_URL': f'postgres://supabase_auth_admin:{password}@wheretoo-spec14-db:5432/postgres',
        'GOTRUE_SITE_URL': ORIGIN, 'GOTRUE_URI_ALLOW_LIST': ORIGIN + '/organizer/setup,' + ORIGIN + '/organizer/settings/account',
        'GOTRUE_JWT_SECRET': configuration['jwtSecret'], 'GOTRUE_JWT_EXP': '3600', 'GOTRUE_JWT_AUD': 'authenticated',
        'GOTRUE_JWT_DEFAULT_GROUP_NAME': 'authenticated', 'GOTRUE_JWT_ADMIN_ROLES': 'service_role',
        'GOTRUE_EXTERNAL_EMAIL_ENABLED': 'true', 'GOTRUE_MAILER_AUTOCONFIRM': 'false', 'GOTRUE_DISABLE_SIGNUP': 'false',
        'GOTRUE_SMTP_HOST': 'wheretoo-spec14-inbox', 'GOTRUE_SMTP_PORT': '1025', 'GOTRUE_SMTP_ADMIN_EMAIL': 'auth@spec14.test',
        'GOTRUE_SMTP_SENDER_NAME': 'Spec 14 local Auth', 'GOTRUE_SMTP_MAX_FREQUENCY': '1s',
        'GOTRUE_MAILER_URLPATHS_CONFIRMATION': '/auth/v1/verify', 'GOTRUE_MAILER_URLPATHS_RECOVERY': '/auth/v1/verify',
        'GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE': '/auth/v1/verify', 'GOTRUE_MAILER_URLPATHS_INVITE': '/auth/v1/verify',
        'GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED': 'true', 'GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL': '10',
    })
    if 'rest' not in identity()['containers']:
        create_container('rest', {
        'PGRST_DB_URI': f'postgres://authenticator:{password}@wheretoo-spec14-db:5432/postgres',
        'PGRST_DB_SCHEMAS': 'public', 'PGRST_DB_ANON_ROLE': 'anon', 'PGRST_JWT_SECRET': configuration['jwtSecret'],
        'PGRST_DB_EXTRA_SEARCH_PATH': 'public,extensions',
    })
    print('Created task-only database, Auth, REST and Auth inbox. No application schema replay or provider activation yet.')


def migration_files():
    baseline_path = ROOT / 'Docs/testing/spec14-inherited-migrations.json'
    require(baseline_path.is_file() and not baseline_path.is_symlink(), 'Historical migration manifest must be a regular file')
    baseline_bytes = baseline_path.read_bytes()
    manifest = json.loads(baseline_bytes)
    require(isinstance(manifest, dict), 'Invalid historical migration manifest')
    expected = {name: value for name, value in manifest.items() if name.startswith('supabase/migrations/') and name.endswith('.sql')}
    require(expected, 'Historical migration inventory is empty')
    approved_path = ROOT / 'Docs/testing/spec14-approved-forward-migrations.json'
    if approved_path.exists() or approved_path.is_symlink():
        require(approved_path.is_file() and not approved_path.is_symlink(), 'Forward migration manifest must be a regular file')
        approved = json.loads(approved_path.read_bytes())
        require(isinstance(approved, dict) and set(approved) == {'format', 'baselineManifestSha256', 'migrations'}
                and type(approved['format']) is int and approved['format'] == 1
                and isinstance(approved['migrations'], list), 'Invalid forward migration manifest')
        require(approved['baselineManifestSha256'] == hashlib.sha256(baseline_bytes).hexdigest(), 'Historical migration manifest changed after forward approval')
        last_timestamp = max(Path(name).name[:14] for name in expected)
        for entry in approved['migrations']:
            require(isinstance(entry, dict) and set(entry) == {'path', 'sha256', 'approvalId'}, 'Invalid forward migration entry')
            name, digest, approval = entry['path'], entry['sha256'], entry['approvalId']
            require(isinstance(name, str) and re.fullmatch(r'supabase/migrations/[0-9]{14}_[a-z0-9_]+\.sql', name), 'Invalid forward migration path')
            require(isinstance(digest, str) and re.fullmatch(r'[a-f0-9]{64}', digest), 'Invalid forward migration digest')
            require(isinstance(approval, str) and re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,119}', approval), 'Missing or invalid forward migration approval reference')
            timestamp = Path(name).name[:14]
            require(name not in expected and timestamp > last_timestamp, 'Forward migrations must append in unique timestamp order')
            expected[name] = digest
            last_timestamp = timestamp
    files = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
    names = {str(file.relative_to(ROOT)) for file in files}
    require(names == set(expected), 'Migration inventory differs from historical and explicitly approved forward files')
    for file in files:
        require(file.is_file() and not file.is_symlink() and file.resolve().is_relative_to(ROOT.resolve()), 'Migration must be a regular file inside this source tree')
        require(hashlib.sha256(file.read_bytes()).hexdigest() == expected[str(file.relative_to(ROOT))], 'Approved migration bytes changed: ' + file.name)
    return files


def migrate():
    files = migration_files()
    record = identity()
    container = verify()
    raw_sql(container, 'create table if not exists spec14_control.migrations(name text primary key, sha256 text not null, role text not null);')
    prior = json.loads(raw_sql(container, "select coalesce(json_agg(row_to_json(m) order by name),'[]'::json) from spec14_control.migrations m;", tuples=True))
    expected = [{'name': file.name, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'role': 'supabase_admin' if file.name == '20260826011350_schedule_report_retention.sql' else 'postgres'} for file in files]
    require(prior == expected[:len(prior)], 'Applied task migrations diverge from recorded source')
    if len(prior) == len(files):
        print('All recorded migrations already applied; data preserved.')
        return
    if not prior:
        require(raw_sql(container, "select to_regclass('public.organizers') is null;", tuples=True).strip() == 't', 'Unrecorded application schema; refusing migration/adoption')
        sql('create extension if not exists pg_cron; grant usage on schema cron to postgres; grant execute on function cron.schedule(text,text,text) to postgres;')
        sql((ROOT / 'tests/integration/spec14-platform-bootstrap.sql').read_text())
    instance = str(uuid.UUID(record['instanceId']))
    guard = "do $spec14_guard$ begin if (select instance_id from spec14_control.identity) <> '" + instance + "' or current_setting('cron.launch_active_jobs') <> 'off' then raise exception 'Task identity/cron mismatch'; end if; end $spec14_guard$;"
    statements = []
    for file in files[len(prior):]:
        role = 'supabase_admin' if file.name == '20260826011350_schedule_report_retention.sql' else 'postgres'
        digest = hashlib.sha256(file.read_bytes()).hexdigest()
        # One pinned container connection; every migration transaction rechecks
        # the database marker and cron before applying its unchanged source bytes.
        statements.append('begin;\n' + guard + '\nset local role ' + role + ';\n' + file.read_text() + "\nreset role; insert into spec14_control.migrations values ('" + file.name + "','" + digest + "','" + role + "'); commit;\n")
    try:
        raw_sql(container, '\n'.join(statements))
    finally:
        record['migrations'] = json.loads(raw_sql(container, "select coalesce(json_agg(row_to_json(m) order by name),'[]'::json) from spec14_control.migrations m;", tuples=True))
        save(IDENTITY, record)
    sql("select private.configure_policy_environment('development'); update cron.job set active=false; notify pgrst, 'reload schema';")
    print('Replayed', len(record['migrations']), 'approved migrations; historical bytes verified; development policy pair configured; automatic jobs off.')


def token(role):
    key = json.loads(CONFIG.read_text())['jwtSecret']
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).decode().rstrip('=')
    body = encode({'alg': 'HS256', 'typ': 'JWT'}) + '.' + encode({'role': role, 'iss': 'supabase', 'exp': 1893456000})
    return body + '.' + base64.urlsafe_b64encode(hmac.new(key.encode(), body.encode(), hashlib.sha256).digest()).decode().rstrip('=')


def build():
    verify()
    environment = {k: v for k, v in os.environ.items() if not k.startswith(('VITE_', 'SUPABASE_', 'STRIPE_', 'RESEND_'))}
    environment.update({'VITE_SUPABASE_URL': ORIGIN, 'VITE_SUPABASE_PUBLISHABLE_KEY': token('anon'),
                        'VITE_MAPBOX_ACCESS_TOKEN': 'spec14-synthetic', 'VITE_STRIPE_PUBLISHABLE_KEY': 'pk_test_spec14synthetic',
                        'WHERETOO_ENABLE_PREVIEW': '0', 'VERCEL_ENV': 'preview'})
    artifact = str(ROOT / 'tests/integration/spec14-artifacts.py')
    before = json.loads(output([sys.executable, artifact, 'source'], cwd=ROOT).splitlines()[-1])['sourceSha256']
    run(['pnpm', 'build'], cwd=ROOT, env=environment)
    run([sys.executable, artifact, 'build', '--expected-source', before], cwd=ROOT)


def typegen():
    """Pinned local metadata service reads only this explicitly verified database."""
    verify()
    config = json.loads(CONFIG.read_text())
    if 'meta' not in identity()['containers']:
        create_container('meta', {'PG_META_PORT': '8080', 'PG_META_DB_HOST': 'wheretoo-spec14-db',
                         'PG_META_DB_PORT': '5432', 'PG_META_DB_NAME': 'postgres',
                         'PG_META_DB_USER': 'supabase_admin', 'PG_META_DB_PASSWORD': config['password']})
    verify('meta')
    db = verify()
    endpoint = 'http://wheretoo-spec14-meta:8080/generators/typescript?included_schemas=public&detect_one_to_one_relationships=true'
    result = output(['docker', 'exec', db, 'curl', '--fail', '--silent', '--show-error', '--retry', '10', '--retry-connrefused', '--retry-delay', '1', endpoint])
    # The pinned postgres-meta generator returns TypeScript as text/plain.
    require('export type Database' in result and 'get_public_discovery' in result, 'Unexpected generated type content')
    path = ROOT / 'src/lib/supabase/database.types.ts'
    path.write_text(result.rstrip() + '\n')
    save(STATE / 'typegen-identity.json', {'instanceId': identity()['instanceId'], 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'schema': 'public', 'metaImage': identity()['containers']['meta']['image']})
    print('Types generated from the recorded local database, schema public.')


def process_command(pid):
    result = subprocess.run(['ps', '-p', str(pid), '-o', 'command='], text=True, capture_output=True)
    return result.stdout.strip() if result.returncode == 0 else None


def verify_process_registry(record, processes, command_reader=process_command):
    """Prove that every recorded server PID still runs its exact recorded command."""
    require(isinstance(processes, dict) and processes.get('instanceId') == record.get('instanceId'), 'Process registry belongs to another instance')
    rows = processes.get('processes')
    require(isinstance(rows, list) and len(rows) == 3, 'Task server process registry is incomplete')
    require({row.get('name') for row in rows if isinstance(row, dict)} == {'bridge', 'edge', 'app'}, 'Task server process names are incorrect')
    require(len({row.get('pid') for row in rows}) == 3, 'Task server process IDs are not distinct')
    for row in rows:
        require(type(row.get('pid')) is int and row['pid'] > 0 and isinstance(row.get('command'), str) and row['command'], 'Task server process record is invalid')
        require(command_reader(row['pid']) == row['command'], 'Recorded server stopped or replaced')
    return sorted(row['name'] for row in rows)


def verify_served_identity(record, build, served):
    """Compare the live app endpoint with the exact recorded instance and build."""
    index = build.get('files', {}).get('index.html', {}) if isinstance(build, dict) else {}
    expected = {
        'task': TASK,
        'instanceId': record.get('instanceId'),
        'application': ORIGIN,
        'sourceSha256': build.get('sourceSha256') if isinstance(build, dict) else None,
        'assetsSha256': build.get('assetsSha256') if isinstance(build, dict) else None,
        'indexSha256': index.get('sha256'),
        'providers': 'local simulation only',
    }
    require(record.get('task') == TASK and record.get('root') == str(ROOT), 'Wrong task workspace identity')
    require(index.get('kind') == 'file' and all(isinstance(expected[key], str) and len(expected[key]) == 64 for key in ('sourceSha256', 'assetsSha256', 'indexSha256')), 'Recorded build identity is incomplete')
    require(isinstance(served, dict) and all(served.get(key) == value for key, value in expected.items()), 'Served application identity does not match recorded task build')
    return expected


def read_served_identity():
    connection = http.client.HTTPConnection('127.0.0.1', 3040, timeout=5)
    try:
        connection.request('GET', '/__spec14/identity', headers={'Accept': 'application/json'})
        response = connection.getresponse()
        require(response.status == 200, 'Served application identity is unavailable')
        require(response.getheader('Content-Type', '').split(';', 1)[0].strip().lower() == 'application/json', 'Served application identity is not JSON')
        body = response.read(4097)
        require(len(body) <= 4096, 'Served application identity is too large')
        value = json.loads(body)
        require(isinstance(value, dict), 'Served application identity is invalid')
        return value
    finally:
        connection.close()


def verify_running():
    """Read-only proof that containers, PIDs and served build are the recorded task."""
    record = identity()
    require(set(record.get('containers', {})) == set(IMAGES), 'Task container registry is incomplete')
    for role in record['containers']:
        verify(role)
    registry = STATE / 'processes.json'
    require(registry.is_file(), 'Task server process registry is missing')
    processes = json.loads(registry.read_text())
    names = verify_process_registry(record, processes)
    build = json.loads((STATE / 'build-identity.json').read_text())
    served = verify_served_identity(record, build, read_served_identity())
    return {
        'task': served['task'],
        'application': served['application'],
        'sourceSha256': served['sourceSha256'],
        'assetsSha256': served['assetsSha256'],
        'processes': names,
    }


def start():
    """Start servers only; never migrate, seed or reset on an ordinary start."""
    verify()
    record = identity()
    registry = STATE / 'processes.json'
    if registry.exists():
        processes = json.loads(registry.read_text())
        verify_process_registry(record, processes)
        print('Recorded servers already running; all data preserved.')
        return
    require((ROOT / 'dist/index.html').exists(), 'Build the application before start')
    for port in [3040, 55647, 55646, 55648, 55649]:
        available(port)
    deno_binary = (ROOT / 'node_modules/deno/deno').resolve()
    require(deno_binary.is_file() and deno_binary.is_relative_to(ROOT / 'node_modules'), 'Missing installed task Deno binary; offline install first')
    commands = [
        ('bridge', [sys.executable, str(ROOT / 'tests/integration/spec14-bridge.py')]),
        ('edge', [str(deno_binary), 'run', '--allow-read', '--allow-write=' + str(STATE), '--allow-env', '--allow-net=127.0.0.1:55647,127.0.0.1:55646,127.0.0.1:55648', str(ROOT / 'tests/integration/edge/spec14-local/gateway.ts'), ORIGIN]),
        ('app', [sys.executable, str(ROOT / 'tests/integration/spec14-app.py')]),
    ]
    processes = {'instanceId': record['instanceId'], 'processes': []}
    save(registry, processes)
    for name, args in commands:
        with private_open(STATE / (name + '-server.log'), 'a') as log:
            child = subprocess.Popen(args, cwd=ROOT, stdout=log, stderr=log, start_new_session=True)
        time.sleep(0.2)
        command = process_command(child.pid)
        require(command is not None, name + ' process exited; inspect its log then stop')
        processes['processes'].append({'name': name, 'pid': child.pid, 'command': command})
        save(registry, processes)
    print('Started task servers. Data preserved. Check verify and server logs for readiness.')


def stop():
    record = identity()
    registry = STATE / 'processes.json'
    require(registry.exists(), 'No recorded task processes to stop')
    processes = json.loads(registry.read_text())
    require(processes['instanceId'] == record['instanceId'], 'Wrong process registry')
    for row in reversed(processes['processes']):
        current = process_command(row['pid'])
        if current is None:
            continue
        require(current == row['command'], 'PID reused; refusing to signal it')
        os.kill(row['pid'], signal.SIGINT)
        for _ in range(100):
            if process_command(row['pid']) is None:
                break
            time.sleep(0.1)
        require(process_command(row['pid']) is None, 'Server did not stop; inspect it before retry')
    for port in [3040, 55647, 55646, 55648, 55649]:
        with socket.socket() as connection:
            require(connection.connect_ex(('127.0.0.1', port)) != 0, 'A task server port is still listening; retain registry and inspect owned children before retry')
    registry.unlink()
    print('Stopped only recorded task servers. Containers, database and inbox data retained.')


def expand(path):
    parts = []
    for line in path.read_text().splitlines():
        if line.startswith('\\ir '):
            child = (path.parent / line[4:]).resolve()
            require(child.is_relative_to(ROOT), 'SQL include outside destination')
            parts.append(expand(child))
        else:
            parts.append(line)
    return '\n'.join(parts)


def test_sql(paths):
    require(paths, 'Supply explicit repository SQL suites')
    results = []
    for argument in paths:
        path = (ROOT / argument).resolve()
        require(path.parent == ROOT / 'supabase/tests/database' and path.name.endswith('.test.sql'), 'Only explicit repository SQL suites allowed')
        text = expand(path)
        require('begin;' in text.lower() and 'rollback;' in text.lower(), 'SQL suite must be rollback-only')
        try:
            result = sql(text)
            passed = 'not ok ' not in result and 'Looks like you failed' not in result
        except subprocess.CalledProcessError as error:
            result = (error.stdout or '') + (error.stderr or '')
            passed = False
        with private_open(STATE / ('sql-' + path.name + '.log')) as stream:
            stream.write(result)
        results.append({'path': argument, 'passed': passed})
        print(('PASS ' if passed else 'FAIL ') + path.name, flush=True)
    save(STATE / ('sql-results-' + str(time.time_ns()) + '.json'), results)
    save(STATE / 'sql-results.json', results)
    require(all(row['passed'] for row in results), 'SQL failures recorded; no assertions removed')


def reset(confirm):
    record = identity()
    require(confirm == record['instanceId'], 'Reset requires the exact instance ID from verify')
    verify()
    require(not (STATE / 'processes.json').exists(), 'Stop task application processes before explicit reset')
    sql("begin; delete from cron.job; drop schema if exists private cascade; drop schema public cascade; create schema public authorization postgres; grant all on schema public to postgres,supabase_admin; grant usage on schema public to anon,authenticated,service_role; truncate auth.users cascade; truncate spec14_control.migrations; commit;")
    record['migrations'] = []
    save(IDENTITY, record)
    print('Reset only recorded task application schemas and local Auth users. Run migrate explicitly; inbox history retained.')


def prepare_scenarios():
    """Explicit synthetic runtime switches only; never principal fixture rows."""
    record = identity()
    require(len(record['migrations']) == len(migration_files()), 'Replay migrations before preparing the local scenario')
    sql((ROOT / 'tests/integration/spec14-prerequisites.sql').read_text())
    save(STATE / 'scenario-prerequisites.json', {'instanceId': record['instanceId'], 'profile': 'synthetic-local-spec07-candidate', 'cron': 'disabled', 'providers': 'simulated', 'principalFixtures': 0})
    print('Prepared explicit synthetic checkout/email/policy switches. No organizer, event, order, registration or ticket was seeded.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    for action in ['create', 'resume-create', 'verify', 'verify-running', 'migrate', 'build', 'sql', 'typegen', 'start', 'stop', 'prepare-scenarios']:
        sub.add_parser(action)
    tests = sub.add_parser('test')
    tests.add_argument('paths', nargs='+')
    reset_parser = sub.add_parser('reset')
    reset_parser.add_argument('--confirm-instance', required=True)
    args = parser.parse_args()
    if args.action == 'create':
        create()
    elif args.action == 'resume-create':
        finish_create()
    elif args.action == 'verify':
        record = identity()
        for role in record['containers']:
            verify(role)
        print(json.dumps({'instanceId': record['instanceId'], 'task': TASK, 'application': ORIGIN + '/discover', 'authInbox': 'http://127.0.0.1:55649', 'migrations': len(record['migrations']), 'cron': 'disabled', 'containers': {key: value['id'] for key, value in record['containers'].items()}}, indent=2))
    elif args.action == 'verify-running':
        print(json.dumps(verify_running(), separators=(',', ':')))
    elif args.action == 'migrate':
        migrate()
    elif args.action == 'build':
        build()
    elif args.action == 'prepare-scenarios':
        prepare_scenarios()
    elif args.action == 'typegen':
        typegen()
    elif args.action == 'start':
        start()
    elif args.action == 'stop':
        stop()
    elif args.action == 'sql':
        print(sql(sys.stdin.read()))
    elif args.action == 'test':
        test_sql(args.paths)
    elif args.action == 'reset':
        reset(args.confirm_instance)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, FileNotFoundError, subprocess.CalledProcessError, OSError, ValueError) as error:
        # Docker/Auth messages can contain synthetic credentials; retain details locally.
        action = sys.argv[1] if len(sys.argv) > 1 else 'unknown'
        record_runner_error(action, error)
        print('Spec 14 operation stopped; inspect .superpowers/spec14/last-runner-error.log in this task.', file=sys.stderr)
        sys.exit(1)
