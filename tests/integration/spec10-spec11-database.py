#!/usr/bin/env python3
"""Operate only Spec 10's recorded, labelled, loopback disposable database."""
import json, pathlib, subprocess, sys, time
ROOT = pathlib.Path(__file__).resolve().parents[2]
NAME = 'whereto-spec10-spec11-db'
LABEL = 'wheretoo.task=spec10-spec11-integration'
IDENTITY = ROOT / '.superpowers/spec10-spec11/database-identity.json'

def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)

def verify():
    identity = json.loads(IDENTITY.read_text())
    current = json.loads(run(['docker', 'inspect', NAME], capture_output=True).stdout)[0]
    assert current['Id'] == identity['id'], 'Unexpected container identity'
    assert current['Name'] == '/' + NAME
    assert current['Config']['Labels'].get('wheretoo.task') == 'spec10-spec11-integration'
    assert 'cron.launch_active_jobs=off' in current['Config']['Cmd'], 'Cron execution must be disabled before any migration'
    assert current['NetworkSettings']['Ports']['5432/tcp'] == [{'HostIp': '127.0.0.1', 'HostPort': '55545'}]
    return current['Id']

def sql(text):
    container_id = verify()  # Immediately before each write, never accept a URL/target override.
    return run(['docker', 'exec', '-i', container_id, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'], input=text, capture_output=True).stdout

def expand(path):
    return '\n'.join(expand(path.parent / line[4:]) if line.startswith('\\ir ') else line for line in path.read_text().splitlines())

def main():
    action = sys.argv[1] if len(sys.argv) > 1 else 'test'
    if action == 'rebuild':
        container_id = verify()
        run(['docker', 'rm', '-f', container_id], capture_output=True)
        IDENTITY.unlink()
        sys.argv = [sys.argv[0], 'create']; main()
        sys.argv = [sys.argv[0], 'migrate']; main()
        return
    if action == 'create':
        assert not IDENTITY.exists(), 'Identity already recorded; refusing replacement'
        inspection = subprocess.run(['docker', 'inspect', NAME], capture_output=True)
        assert inspection.returncode != 0, 'Existing container; refusing replacement'
        container_id = run(['docker', 'run', '--pull', 'never', '--name', NAME, '--label', LABEL, '-p', '127.0.0.1:55545:5432', '-e', 'POSTGRES_PASSWORD=spec10-spec11-disposable-only', '-d', 'public.ecr.aws/supabase/postgres:17.6.1.155', '-c', 'listen_addresses=*', '-c', 'shared_preload_libraries=pg_stat_statements,pg_cron', '-c', 'cron.database_name=postgres', '-c', 'cron.launch_active_jobs=off'], capture_output=True).stdout.strip()
        IDENTITY.parent.mkdir(parents=True, exist_ok=True)
        IDENTITY.write_text(json.dumps({'id': container_id, 'name': NAME}) + '\n')
        for _ in range(30):
            verify()
            if subprocess.run(['docker', 'exec', container_id, 'pg_isready', '-h', '127.0.0.1', '-U', 'supabase_admin'], capture_output=True).returncode == 0:
                print('Spec 10 disposable database ready:', container_id); return
            time.sleep(1)
        raise RuntimeError('Database not ready')
    if action == 'migrate':
        assert 'f' in sql("select to_regclass('public.organizers') is not null;").split(), 'Already initialized; use apply for explicit new migration files'
        files = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
        for file in files:
            sql('begin;\n' + file.read_text() + '\ncommit;')
        sql((ROOT / 'tests/integration/spec09-database-bootstrap.sql').read_text())
        sql((ROOT / 'tests/integration/spec08-database-bootstrap.sql').read_text())
        print('Replayed migrations:', len(files)); return
    if action == 'apply':
        for argument in sys.argv[2:]:
            file = (ROOT / argument).resolve()
            assert file.parent == ROOT / 'supabase/migrations' and file.name.startswith('20260915'), 'Only explicit Spec 10 migrations accepted'
            sql('begin;\n' + file.read_text() + '\ncommit;')
            print('Applied:', file.name)
        return
    if action == 'sql':
        print(sql(sys.stdin.read())); return
    assert action == 'test'
    files = [ROOT / f for f in sys.argv[2:]] or sorted((ROOT / 'supabase/tests/database').glob('spec10*.test.sql'))
    assert files, 'No tests selected'
    for file in files:
        print('FILE:', file.name, flush=True)
        output = sql(expand(file)); print(output)
        assert 'not ok ' not in output and 'Looks like you failed' not in output, file.name

if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as error:
        print(error.stderr or str(error), file=sys.stderr)
        raise SystemExit(1)
