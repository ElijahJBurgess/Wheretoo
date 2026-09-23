#!/usr/bin/env python3
"""Operate only CSV Export's recorded, labelled, loopback disposable database."""
import json, pathlib, subprocess, sys, time
ROOT = pathlib.Path(__file__).resolve().parents[2]
NAME = 'whereto-csv-export-db'
LABEL = 'wheretoo.task=csv-export-v1'
IDENTITY = ROOT / '.superpowers/csv-export/database-identity.json'

def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)

def verify():
    identity = json.loads(IDENTITY.read_text())
    current = json.loads(run(['docker', 'inspect', NAME], capture_output=True).stdout)[0]
    assert current['Id'] == identity['id'], 'Unexpected container identity'
    assert current['Name'] == '/' + NAME
    assert current['Config']['Labels'].get('wheretoo.task') == 'csv-export-v1'
    assert 'cron.launch_active_jobs=off' in current['Config']['Cmd'], 'Cron execution must be disabled before any migration'
    assert current['NetworkSettings']['Ports']['5432/tcp'] == [{'HostIp': '127.0.0.1', 'HostPort': '55625'}]
    return current['Id']

def sql(text):
    container_id = verify()  # Immediately before each write, never accept a URL/target override.
    return run(['docker', 'exec', '-i', container_id, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'], input=text, capture_output=True).stdout

def expand(path):
    return '\n'.join(expand(path.parent / line[4:]) if line.startswith('\\ir ') else line for line in path.read_text().splitlines())

def main():
    action = sys.argv[1] if len(sys.argv) > 1 else 'test'
    if action == 'reset':
        # Preserve container identity. This database has no shared or provider data.
        sql("begin; delete from cron.job; drop schema if exists storage cascade; drop schema if exists private cascade; drop schema public cascade; create schema public authorization postgres; grant all on schema public to postgres,supabase_admin; grant usage on schema public to anon,authenticated,service_role; truncate auth.users cascade; commit;")
        fixture = ROOT / '.superpowers/csv-export/browser-fixture.json'
        if fixture.exists(): fixture.unlink()
        print('Reset only the recorded disposable app schemas; container identity preserved')
        return
    if action == 'create':
        assert not IDENTITY.exists(), 'Identity already recorded; refusing replacement'
        inspection = subprocess.run(['docker', 'inspect', NAME], capture_output=True)
        assert inspection.returncode != 0, 'Existing container; refusing replacement'
        container_id = run(['docker', 'run', '--pull', 'never', '--name', NAME, '--label', LABEL, '-p', '127.0.0.1:55625:5432', '-e', 'POSTGRES_PASSWORD=csv-export-disposable-only', '-d', 'public.ecr.aws/supabase/postgres:17.6.1.155', '-c', 'listen_addresses=*', '-c', 'shared_preload_libraries=pg_stat_statements,pg_cron', '-c', 'cron.database_name=postgres', '-c', 'cron.launch_active_jobs=off'], capture_output=True).stdout.strip()
        IDENTITY.parent.mkdir(parents=True, exist_ok=True)
        IDENTITY.write_text(json.dumps({'id': container_id, 'name': NAME}) + '\n')
        for _ in range(30):
            verify()
            if subprocess.run(['docker', 'exec', container_id, 'pg_isready', '-h', '127.0.0.1', '-U', 'supabase_admin'], capture_output=True).returncode == 0:
                print('CSV Export disposable database ready:', container_id); return
            time.sleep(1)
        raise RuntimeError('Database not ready')
    if action == 'migrate':
        assert 'f' in sql("select to_regclass('public.organizers') is not null;").split(), 'Already initialized; use apply for explicit new migration files'
        # Cached image extension owner is supabase_admin; postgres is the migration role.
        # Grant only the registration entry point. The launcher remains disabled.
        sql("create extension if not exists postgis with schema extensions; create extension if not exists btree_gist with schema extensions; create extension if not exists pg_cron; grant usage on schema cron to postgres; grant execute on function cron.schedule(text,text,text) to postgres;")
        sql((ROOT / 'tests/integration/spec13-platform-bootstrap.sql').read_text())
        sql((ROOT / 'tests/integration/csv-export-platform-bootstrap.sql').read_text())
        files = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
        for file in files:
            # This owner-only extension ACL migration creates no application functions.
            # The cached image owns pg_cron as supabase_admin, unlike application objects.
            role = 'supabase_admin' if file.name == '20260826011350_schedule_report_retention.sql' else 'postgres'
            print('MIGRATION:', file.name, 'ROLE:', role, flush=True)
            sql('begin;\nset local role ' + role + ';\n' + file.read_text() + '\ncommit;')
        sql((ROOT / 'tests/integration/spec09-database-bootstrap.sql').read_text())
        sql((ROOT / 'tests/integration/spec08-database-bootstrap.sql').read_text())
        print('Replayed migrations:', len(files)); return
    if action == 'apply':
        for argument in sys.argv[2:]:
            file = (ROOT / argument).resolve()
            assert file.parent == ROOT / 'supabase/migrations' and file.name.startswith('20260923'), 'Only explicit CSV Export migrations accepted'
            sql('begin;\nset local role postgres;\n' + file.read_text() + '\ncommit;')
            print('Applied:', file.name)
        return
    if action == 'sql':
        print(sql(sys.stdin.read())); return
    assert action == 'test'
    files = [ROOT / f for f in sys.argv[2:]] or sorted((ROOT / 'supabase/tests/database').glob('organizer_csv_export*.test.sql'))
    assert files, 'No tests selected'
    for file in files:
        print('FILE:', file.name, flush=True)
        assert file.resolve().parent == ROOT / 'supabase/tests/database' and file.name.endswith('.test.sql'), 'Only repository SQL suites accepted'
        contents = expand(file)
        assert 'begin;' in contents.lower() and 'rollback;' in contents.lower(), 'SQL suites must be rollback-only'
        # Regression fixtures use fixed IDs: require an empty dedicated database.
        assert '0' in sql('select count(*) from public.orders;').split(), 'Reset/replay the dedicated database before SQL regression suites'
        if file.name == 'spec08_checkout_expiry.test.sql':
            contents = contents.replace('begin;', 'begin;\nset local role postgres;', 1)
        output = sql(contents); print(output)
        assert 'not ok ' not in output and 'Looks like you failed' not in output, file.name

if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as error:
        print(error.stdout or '', file=sys.stderr)
        print(error.stderr or str(error), file=sys.stderr)
        raise SystemExit(1)
