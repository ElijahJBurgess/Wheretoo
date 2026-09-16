#!/usr/bin/env python3
"""Explicit Spec14-only moderation races, with unique fixtures and exact cleanup.

Root must quiesce explicit worker calls before invocation. The unchanged global
claim is used only after proving the exact next candidate and absence of outside
processing leases at the attempt limit (regardless of age); every outside
evaluation is compared after all races.
"""
import concurrent.futures
import importlib.util
import json
from pathlib import Path
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('moderation_spec14_database', ROOT / 'tests/integration/spec14-local.py')
db = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(db)
MIGRATION = ROOT / 'supabase/migrations/20260918010100_guard_incomplete_moderation_jobs.sql'
REQUIREMENTS = json.dumps({
    'minimum_age': 'all_ages', 'alcohol_present': False, 'cannabis_present': False,
    'explicit_adult_content': False, 'gambling_present': False,
    'weapons_present': False, 'high_risk_activity': False,
})


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def command():
    return ['docker', 'exec', '-i', db.verify(), 'psql', '-X', '-qAt', '-v',
            'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres']


def query(statement):
    try:
        return subprocess.run(command(), input=statement, text=True, capture_output=True,
                              check=True, timeout=90).stdout.strip()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        # Keep database diagnostics private, including failures during cleanup.
        db.save(db.STATE / ('moderation-query-error-' + uuid.uuid4().hex + '.json'), {
            'error': type(error).__name__,
            'stdout': error.stdout.decode(errors='replace') if isinstance(error.stdout, bytes) else error.stdout,
            'stderr': error.stderr.decode(errors='replace') if isinstance(error.stderr, bytes) else error.stderr,
        })
        raise


def parsed(statement):
    return json.loads(query(statement).splitlines()[-1])


def outside(owner):
    return parsed(f"""select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]'::jsonb)
      from private.event_moderation_evaluations q join public.events e on e.id=q.event_id
      where e.organizer_id<>{quote(owner)};""")


def assert_retirement_safe(owner):
    assert query(f"""select not exists(select 1 from private.event_moderation_evaluations q
      join public.events e on e.id=q.event_id where e.organizer_id<>{quote(owner)}
      and q.source in ('contextual','report') and q.status in ('queued','processing')
      and not private.event_has_moderation_disclosures(e.id));""") == 't', 'outside incomplete jobs: abort replay'


def claim_sql(evaluation, owner):
    # These are preconditions, not a replacement/filter of the production claim.
    # Refuse every outside attempt-limit processing lease: its expiry cutoff can
    # advance between this guard and the unchanged claim's later UPDATE.
    # Likewise include every processing row in the candidate-order precheck, so
    # an older lease crossing expiry cannot become the claim's actual candidate.
    return f"""do $guard$ begin
      if exists(select 1 from private.event_moderation_evaluations q
        join public.events e on e.id=q.event_id
        where e.organizer_id<>{quote(owner)} and q.source in ('contextual','report')
        and q.status='processing' and q.attempt_count>=3) then
        raise exception 'ASSERT_OUTSIDE_EXHAUSTED_LEASE';
      end if;
      if (select q.id from private.event_moderation_evaluations q
        where q.source in ('contextual','report') and q.attempt_count<3
        and q.status in ('queued','processing')
        order by q.created_at,q.id limit 1) is distinct from {quote(evaluation)}::uuid then
        raise exception 'ASSERT_FIXTURE_IS_NOT_NEXT_GLOBAL_CLAIM';
      end if;
    end $guard$;
    set local role service_role;
    select to_jsonb(c) from public.server_claim_moderation_evaluation('spec14-input-race') c;
    reset role;"""


def reject_sql(envelope):
    return 'public.server_reject_moderation_evaluation_input(' + ','.join([
        quote(envelope['id']), quote(envelope['event_id']), str(envelope['content_revision']),
        quote(envelope['input_sha256']), str(envelope['queued_moderation_version']),
        str(envelope['attempt_count']),
    ]) + ')'


def save_requirements(owner, event):
    return f"""select set_config('request.jwt.claim.sub',{quote(owner)},true);
      set local role authenticated;
      select public.save_owned_event_requirements_if_current({quote(event)},
        {quote(REQUIREMENTS)}::jsonb,
        public.get_owned_event_change_context({quote(event)})->>'context_token');
      reset role;"""


def compete(label, first, finish, second, wait_event=None):
    application = 'spec14_moderation_' + uuid.uuid4().hex
    holder = subprocess.Popen(command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True)
    try:
        # Identity verification launches several Docker commands on this host.
        # Allow that transport time while retaining an observed real lock wait.
        holder.stdin.write("begin; set local statement_timeout='60s'; set local deadlock_timeout='100ms';\n" +
                           first + "\nselect 'FIXTURE_LOCK_HELD';\n")
        holder.stdin.flush()
        while True:
            line = holder.stdout.readline().strip()
            if line == 'FIXTURE_LOCK_HELD':
                break
            if not line and holder.poll() is not None:
                raise RuntimeError('holder failed before lock marker: ' + holder.stderr.read())
        waiter = f"begin; set local statement_timeout='60s'; set local application_name={quote(application)};\n{second}\ncommit;"
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(query, waiter)
            observed = False
            for _ in range(60):
                condition = f" and wait_event={quote(wait_event)}" if wait_event else ''
                if query(f"select exists(select 1 from pg_stat_activity where application_name={quote(application)} and wait_event_type='Lock'{condition});") == 't':
                    observed = True
                    break
                time.sleep(0.025)
            assert observed and not future.done(), label + ' did not overlap on its expected lock'
            db.verify()
            holder.stdin.write(finish + '\ncommit;\n\\q\n')
            holder.stdin.flush()
            holder.wait(timeout=75)
            error = holder.stderr.read()
            assert holder.returncode == 0, label + ' holder failed: ' + error
            return future.result(timeout=75)
    finally:
        if holder.poll() is None:
            db.verify()
            holder.stdin.write('rollback;\n\\q\n')
            holder.stdin.flush()
            holder.wait(timeout=75)
        holder.stdin.close()
        holder.stdout.close()
        holder.stderr.close()


def main():
    # The append-only approved manifest must already admit these exact bytes.
    db.verify()
    db.migration_files()
    assert query("select to_regprocedure('public.server_reject_moderation_evaluation_input(uuid,uuid,bigint,text,bigint,integer)') is not null;") == 't'
    owner = str(uuid.uuid4())
    nonce = uuid.uuid4().hex
    events = []
    before = outside(owner)
    assert_retirement_safe(owner)
    # Execute the exact approved production retirement block, without replacing
    # unrelated function definitions or recording another applied migration.
    source = MIGRATION.read_text()
    start = source.index('do $$\n')
    retirement = source[start:source.index('\n$$;', start) + 4]
    evidence = {'owner': owner, 'events': events, 'cases': []}
    evidence_path = db.STATE / ('moderation-concurrency-' + nonce + '.json')
    db.save(evidence_path, evidence)
    query(f"begin; insert into auth.users(id,email) values({quote(owner)},{quote('moderation-race-' + nonce + '@example.invalid')}); insert into public.organizers(id,display_name) values({quote(owner)},'Moderation race fixture'); commit;")

    def fixture(status='processing', attempt=1, complete=False, source='contextual', created='2000-01-01T00:00:00Z'):
        event, evaluation = str(uuid.uuid4()), str(uuid.uuid4())
        events.append(event)
        db.save(evidence_path, evidence)
        disclosure = ''
        if complete:
            disclosure = f"""insert into private.event_risk_disclosures(event_id,minimum_age,
              alcohol_present,cannabis_present,explicit_adult_content,gambling_present,weapons_present,high_risk_activity)
              values({quote(event)},'all_ages',false,false,false,false,false,false);"""
        started = 'null' if status == 'queued' else "'2001-01-01T00:00:00Z'::timestamptz"
        query(f"""begin;
          insert into public.events(id,organizer_id,moderation_status) values({quote(event)},{quote(owner)},'under_review');
          {disclosure}
          insert into private.event_moderation_evaluations(id,event_id,content_revision,input_sha256,
            queued_moderation_version,status,source,attempt_count,created_at,started_at)
          values({quote(evaluation)},{quote(event)},1,private.compute_event_input_sha256({quote(event)}),
            0,{quote(status)},{quote(source)},{attempt},{quote(created)}::timestamptz,{started}); commit;""")
        return event, evaluation, parsed(f'select to_jsonb(q) from private.event_moderation_evaluations q where id={quote(evaluation)};')

    def check_complete(event, old):
        facts = parsed(f"""select jsonb_build_object('disclosures',private.event_has_moderation_disclosures(e.id),
          'revision',e.content_revision,'version',e.moderation_version,
          'queued',(select jsonb_agg(to_jsonb(q)) from private.event_moderation_evaluations q where q.event_id=e.id and q.status='queued'),
          'hash',private.compute_event_input_sha256(e.id),
          'old',(select to_jsonb(q) from private.event_moderation_evaluations q where q.id={quote(old)}))
          from public.events e where e.id={quote(event)};""")
        assert facts['disclosures'] and facts['revision'] == 2 and facts['version'] == 1
        assert len(facts['queued']) == 1 and facts['queued'][0]['input_sha256'] == facts['hash']
        assert facts['queued'][0]['content_revision'] == 2 and facts['queued'][0]['attempt_count'] == 0
        assert facts['old']['status'] == 'superseded' and facts['old']['failure_code'] == 'CONTENT_REVISION_CHANGED'
        return facts

    def passed(label):
        assert outside(owner) == before, label + ' changed an outside evaluation'
        evidence['cases'].append(label)
        db.save(evidence_path, evidence)
        print('PASS ' + label, flush=True)

    try:
        event, evaluation, old = fixture()
        valid_event, valid_evaluation, _ = fixture(status='queued', attempt=0, complete=True,
                                                  source='report', created='2000-01-02T00:00:00Z')
        claim = parsed('begin;' + claim_sql(evaluation, owner) + 'commit;')
        assert claim['evaluation_id'] == evaluation and claim['attempt_count'] == 2
        assert query(f'begin; set local role service_role; select {reject_sql(old)}; commit;') == 'conflict'
        current = parsed(f'select to_jsonb(q) from private.event_moderation_evaluations q where id={quote(evaluation)};')
        assert current['status'] == 'processing' and current['attempt_count'] == 2
        assert query(f'begin; set local role service_role; select {reject_sql(current)}; commit;') == 'superseded'
        next_claim = parsed('begin;' + claim_sql(valid_evaluation, owner) + 'commit;')
        assert next_claim['evaluation_id'] == valid_evaluation and next_claim['attempt_count'] == 1
        assert next_claim['prior_reason_codes'] == []
        passed('unchanged global FIFO and reclaimed-attempt fencing')

        event, evaluation, old = fixture()
        lock = f'select public.lock_event_ticketing_operation({quote(event)}); select 1 from public.events where id={quote(event)} for update;'
        reply = compete('requirements versus rejection', lock, save_requirements(owner, event),
                        f'set local role service_role; select {reject_sql(old)};', 'advisory')
        assert reply.splitlines()[-1] == 'superseded'
        check_complete(event, evaluation)
        passed('requirements completion preserves newer job against in-flight rejection')

        event, evaluation, _ = fixture()
        lock = f'select public.lock_event_ticketing_operation({quote(event)}); select 1 from public.events where id={quote(event)} for update;'
        assert_retirement_safe(owner)
        compete('requirements versus retirement', lock, save_requirements(owner, event), retirement, 'advisory')
        check_complete(event, evaluation)
        passed('retirement rechecks completeness after event-lock wait')

        event, evaluation, _ = fixture(status='queued', attempt=0)
        assert_retirement_safe(owner)
        # The holder initially owns only the evaluation lock. Its unchanged claim
        # starts after retirement is waiting, so started_at is newer than the
        # retirement statement timestamp. Retirement must use post-lock time.
        lock = f'select 1 from private.event_moderation_evaluations where id={quote(evaluation)} for update;'
        compete('claim versus retirement', lock, claim_sql(evaluation, owner), retirement)
        row = parsed(f'select to_jsonb(q) from private.event_moderation_evaluations q where id={quote(evaluation)};')
        assert row['status'] == 'superseded' and row['failure_code'] == 'INCOMPLETE_MODERATION_INPUT'
        assert row['attempt_count'] == 1
        assert query(f'select finished_at>=started_at and started_at>=created_at from private.event_moderation_evaluations where id={quote(evaluation)};') == 't'
        passed('retirement timestamp remains monotonic after unchanged claim commits')
    finally:
        evidence['remainingFixtureEvaluations'] = parsed(f"""select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]'::jsonb)
          from private.event_moderation_evaluations q join public.events e on e.id=q.event_id where e.organizer_id={quote(owner)};""")
        db.save(evidence_path, evidence)
        # Replica mode bypasses immutable-history delete guards for these unique
        # synthetic test rows only. No principal IDs are accepted by this script.
        query(f"""begin; set local session_replication_role=replica;
          delete from private.event_change_state where event_id in(select id from public.events where organizer_id={quote(owner)});
          delete from private.event_change_snapshots where event_id in(select id from public.events where organizer_id={quote(owner)});
          delete from private.event_public_eligibility_intervals where event_id in(select id from public.events where organizer_id={quote(owner)});
          delete from private.event_moderation_actions where event_id in(select id from public.events where organizer_id={quote(owner)});
          delete from private.event_moderation_evaluations where event_id in(select id from public.events where organizer_id={quote(owner)});
          delete from private.event_risk_disclosures where event_id in(select id from public.events where organizer_id={quote(owner)});
          delete from public.events where organizer_id={quote(owner)};
          delete from public.organizers where id={quote(owner)};
          delete from auth.users where id={quote(owner)}; commit;""")
        assert query(f'select not exists(select 1 from public.events where organizer_id={quote(owner)}) and not exists(select 1 from auth.users where id={quote(owner)});') == 't'
        assert outside(owner) == before, 'outside evaluation snapshot changed'
        evidence['cleanupVerified'] = True
        db.save(evidence_path, evidence)
    print('4 moderation concurrency scenarios passed; outside evaluations unchanged; fixture cleanup verified.')


if __name__ == '__main__':
    main()
