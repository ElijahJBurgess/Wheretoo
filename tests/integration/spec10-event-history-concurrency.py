#!/usr/bin/env python3
"""Real parallel-session proof on Spec 10's identity-checked cron-disabled DB only.
Synthetic committed fixtures stay in that disposable DB for failed-run inspection.
"""
import concurrent.futures
import importlib.util
import json
import pathlib
import subprocess
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('spec10_database', ROOT / 'tests/integration/spec10-database.py')
db = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(db)


def command():
    return ['docker', 'exec', '-i', db.verify(), 'psql', '-X', '-qAt', '-v',
            'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres']


def query(statement):
    return subprocess.run(command(), input=statement, text=True, capture_output=True,
                          check=True, timeout=25).stdout.strip()


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def parsed(statement):
    return json.loads(next(line for line in reversed(query(statement).splitlines()) if line.startswith('{')))


def main():
    nonce = uuid.uuid4().hex
    owner, other, event = (str(uuid.uuid4()) for _ in range(3))
    fixture = db.expand(ROOT / 'supabase/tests/database/helpers/spec10_event_history_setup.inc')
    fixture = fixture.replace('aa100000-0000-4000-8000-000000000001', owner)
    fixture = fixture.replace('aa100000-0000-4000-8000-000000000002', other)
    fixture = fixture.replace('aa200000-0000-4000-8000-000000000001', event)
    fixture = fixture.replace('spec10-history-owner@example.invalid', f'history-{nonce}@example.invalid')
    fixture = fixture.replace('spec10-history-other@example.invalid', f'other-{nonce}@example.invalid')
    query('begin;\n' + fixture + '\ncommit;')
    auth = f"select set_config('request.jwt.claim.sub',{quote(owner)},true); set local role authenticated;"
    ctx_call = f'public.get_owned_event_change_context({quote(event)})'

    def context():
        return parsed(f'begin; {auth} select {ctx_call}; commit;')

    for operation in ('save', 'requirements', 'accept', 'publish'):
        before = context()
        token = quote(before['context_token'])
        facts = before['current_saved']['facts']
        payload = {key: value for key, value in facts.items() if key != 'disclosures'}
        payload['capacity'] += 1
        save = f'public.save_owned_event_revision_if_current({quote(event)},{quote(json.dumps(payload))}::jsonb,{token})'
        calls = {
            'save': save,
            'requirements': f'public.save_owned_event_requirements_if_current({quote(event)},{quote(json.dumps(facts["disclosures"]))}::jsonb,{token})',
            'accept': f'public.accept_current_event_policies_if_current({quote(event)},{token})',
            'publish': f'public.publish_event_if_current({quote(event)},{token})',
        }
        holder = subprocess.Popen(command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True)
        try:
            db.verify()
            holder.stdin.write(f"begin; set local statement_timeout='20s'; {auth} select {save}; select 'HISTORY_WRITE_HELD';\n")
            holder.stdin.flush()
            reply = None
            while True:
                line = holder.stdout.readline().strip()
                if line.startswith('{'):
                    reply = json.loads(line)
                if line == 'HISTORY_WRITE_HELD':
                    break
                if not line and holder.poll() is not None:
                    raise RuntimeError(holder.stderr.read())
            assert reply['result']['capacity'] == payload['capacity']
            assert reply['context']['event']['capacity'] == payload['capacity']
            assert reply['context']['context_token'] != before['context_token']
            assert reply['context']['current_saved']['content_revision'] == before['current_saved']['content_revision']
            app = f'spec10_history_{nonce}_{operation}'
            waiter = f'''begin; set local statement_timeout='15s'; set local application_name={quote(app)};
{auth}
create function pg_temp.try_stale() returns text language plpgsql as $body$
begin perform {calls[operation]}; return 'UNEXPECTED_SUCCESS';
exception when sqlstate 'P0001' then return sqlerrm; end; $body$;
select pg_temp.try_stale(); commit;'''
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(query, waiter)
                blocked = False
                for _ in range(75):
                    if query(f"select exists(select 1 from pg_stat_activity where application_name={quote(app)} and wait_event_type='Lock' and wait_event='advisory');") == 't':
                        blocked = True
                        break
                    time.sleep(0.04)
                assert blocked, f'{operation} did not wait on the event advisory lock'
                assert not future.done(), 'stale operation must remain blocked until writer commits'
                db.verify()
                holder.stdin.write('commit;\n\\q\n')
                holder.stdin.flush()
                holder.wait(timeout=20)
                assert holder.returncode == 0, holder.stderr.read()
                assert future.result(timeout=20).splitlines()[-1] == 'EVENT_CONTEXT_CONFLICT', operation
            after = context()
            assert after['context_token'] == reply['context']['context_token'], 'reply token represents exactly committed winner'
            assert after['current_saved']['snapshot_id'] == reply['context']['current_saved']['snapshot_id']
            assert after['notice_required'] is False, 'capacity race must not create a material notice'
            print(f'PASS {operation}: blocked behind capacity save; stale context rejected after commit; winner reply remains exact')
        finally:
            if holder.poll() is None:
                db.verify()
                holder.stdin.write('rollback;\n\\q\n')
                holder.stdin.flush()
                holder.wait(timeout=20)
            holder.stdin.close()
            holder.stdout.close()
            holder.stderr.close()
    print('4 real parallel-session serialization scenarios passed')


if __name__ == '__main__':
    main()
