#!/usr/bin/env python3
"""Review regressions: direct draft updates and policy releases, Spec10 DB only."""
import concurrent.futures
import importlib.util
import json
import pathlib
import subprocess
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('history_races', ROOT / 'tests/integration/spec10-event-history-concurrency.py')
h = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(h)


def fixture():
    nonce = uuid.uuid4().hex
    owner, other, event = (str(uuid.uuid4()) for _ in range(3))
    setup = h.db.expand(ROOT / 'supabase/tests/database/helpers/spec10_event_history_setup.inc')
    setup = '\n'.join(line for line in setup.splitlines() if 'select public.publish_event(' not in line)
    for old, new in [('aa100000-0000-4000-8000-000000000001', owner),
                     ('aa100000-0000-4000-8000-000000000002', other),
                     ('aa200000-0000-4000-8000-000000000001', event),
                     ('spec10-history-owner@example.invalid', f'review-{nonce}@example.invalid'),
                     ('spec10-history-other@example.invalid', f'other-{nonce}@example.invalid')]:
        setup = setup.replace(old, new)
    h.query('begin;\n' + setup + '\ncommit;')
    auth = f"select set_config('request.jwt.claim.sub',{h.quote(owner)},true); set local role authenticated;"
    context_call = f'public.get_owned_event_change_context({h.quote(event)})'
    before = h.parsed(f'begin; {auth} select {context_call}; commit;')
    assert before['event']['status'] == 'draft'
    return event, auth, context_call, before


def compete(label, first, finish, second):
    app = 'spec10_review_' + uuid.uuid4().hex
    holder = subprocess.Popen(h.command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True)
    try:
        h.db.verify()
        holder.stdin.write(f"begin; set local statement_timeout='10s'; set local deadlock_timeout='100ms'; {first}; select 'ROW_HELD';\n")
        holder.stdin.flush()
        while True:
            line = holder.stdout.readline().strip()
            if line == 'ROW_HELD':
                break
            if not line and holder.poll() is not None:
                raise RuntimeError(holder.stderr.read())
        waiter = f"begin; set local statement_timeout='10s'; set local application_name={h.quote(app)}; {second}; commit;"
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(h.query, waiter)
            blocked = False
            for _ in range(75):
                if h.query(f"select exists(select 1 from pg_stat_activity where application_name={h.quote(app)} and wait_event_type='Lock');") == 't':
                    blocked = True
                    break
                time.sleep(0.04)
            assert blocked, label + ' did not reach competing row lock'
            h.db.verify()
            holder.stdin.write(f'{finish}; commit;\n\\q\n')
            holder.stdin.flush()
            holder.wait(timeout=15)
            holder_error = holder.stderr.read()
            try:
                result = future.result(timeout=15)
            except subprocess.CalledProcessError as error:
                raise AssertionError(f'{label}: waiter failed: {error.stderr}') from error
            assert holder.returncode == 0, f'{label}: first writer failed: {holder_error}'
            return result
    finally:
        if holder.poll() is None:
            h.db.verify()
            holder.stdin.write('rollback;\n\\q\n')
            holder.stdin.flush()
            holder.wait(timeout=15)
        holder.stdin.close()
        holder.stdout.close()
        holder.stderr.close()


def main():
    failures = []
    for case in ('direct_draft', 'direct_draft_read', 'direct_disclosure', 'policy_release', 'cancel_disclosure'):
        try:
            event, auth, context_call, before = fixture()
            if case == 'cancel_disclosure':
                h.query(f'begin; {auth} select public.publish_event({h.quote(event)}); commit;')
                before = h.parsed(f'begin; {auth} select {context_call}; commit;')
                assert before['currently_publicly_eligible'] is True
            token = h.quote(before['context_token'])
            if case in ('direct_draft', 'direct_draft_read'):
                payload = {k: v for k, v in before['current_saved']['facts'].items() if k != 'disclosures'}
                call = f'public.save_owned_event_revision_if_current({h.quote(event)},{h.quote(json.dumps(payload))}::jsonb,{token})'
                first = f"{auth} update public.events set capacity=41 where id={h.quote(event)}"
                finish = 'select 1'
                if case == 'direct_draft_read':
                    call = context_call
            elif case == 'direct_disclosure':
                call = f'public.accept_current_event_policies_if_current({h.quote(event)},{token})'
                first = f"update private.event_risk_disclosures set minimum_age='18_plus' where event_id={h.quote(event)}"
                finish = 'select 1'
            elif case == 'cancel_disclosure':
                call = context_call
                first = f'{auth} select public.cancel_owned_event({h.quote(event)})'
                finish = 'select 1'
            else:
                call = f'public.accept_current_event_policies_if_current({h.quote(event)},{token})'
                first = 'select environment from private.organizer_policy_release_settings where singleton_id for update'
                finish = "select private.configure_policy_environment('development')"
            second = f'''{auth}
create function pg_temp.try_context() returns text language plpgsql as $body$
begin perform {call}; return 'UNEXPECTED_SUCCESS';
exception when sqlstate 'P0001' then return sqlerrm; end; $body$;
select pg_temp.try_context()'''
            if case == 'direct_draft_read':
                second = f'{auth} select {context_call}'
            if case == 'cancel_disclosure':
                second = f"update private.event_risk_disclosures set minimum_age='21_plus' where event_id={h.quote(event)}"
            result = compete(case, first, finish, second)
            if case == 'direct_draft_read':
                read_reply = json.loads(result.splitlines()[-1])
                assert read_reply['event']['capacity'] == 41
                assert read_reply['current_saved']['facts']['capacity'] == 41
            elif case != 'cancel_disclosure':
                assert result.splitlines()[-1] == 'EVENT_CONTEXT_CONFLICT', result
            after = h.parsed(f'begin; {auth} select {context_call}; commit;')
            assert after['context_token'] != before['context_token']
            if case in ('direct_draft', 'direct_draft_read'):
                assert after['event']['capacity'] == 41
                assert after['current_saved']['facts']['capacity'] == 41
                assert after['previous_saved']['snapshot_id'] == before['current_saved']['snapshot_id']
            elif case == 'direct_disclosure':
                assert after['current_saved']['facts']['disclosures']['minimum_age'] == '18_plus'
                assert after['requirements']['minimum_age'] == '18_plus'
            elif case == 'cancel_disclosure':
                assert after['event']['status'] == 'cancelled'
                assert after['currently_publicly_eligible'] is False
                assert after['requirements']['minimum_age'] == '21_plus'
                assert after['current_saved']['facts']['disclosures']['minimum_age'] == '21_plus'
                assert after['current_publicly_eligible']['snapshot_id'] == before['current_publicly_eligible']['snapshot_id']
            print(f'PASS {case}: first writer commits without deadlock; waiting operation observes current facts or rejects stale context')
        except (AssertionError, subprocess.CalledProcessError) as error:
            failures.append(case)
            print(f'FAIL {case}: {error}')
    assert not failures, 'Concurrency regressions: ' + ', '.join(failures)
    print('5 history review serialization scenarios passed')


if __name__ == '__main__':
    main()
