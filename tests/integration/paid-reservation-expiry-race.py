#!/usr/bin/env python3
"""Committed local fixtures: admission waiting on locks must observe event expiry.

Run directly with python3. Hard-pinned to the disposable public-availability
container with cron disabled. No HTTP, Stripe calls, hosted DBs or scheduler
changes. Restores every public/private/auth table count and paid gate on exit.
"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import subprocess
import select
import time
import uuid
import tempfile

ROOT = Path(__file__).resolve().parents[2]
CONTAINER = 'supabase_db_wheretoo-public-availability'
PSQL = ['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def query(statement):
    return subprocess.run(PSQL, input=statement, text=True, capture_output=True, check=True, timeout=45).stdout.strip()


def verify():
    project = subprocess.check_output(['docker', 'inspect', '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}', CONTAINER], text=True, timeout=15).strip()
    assert project == 'wheretoo-public-availability', 'Disposable local project only'
    assert query('show cron.launch_active_jobs') == 'off', 'Cron must already be disabled'


def counts(tables):
    union = ' union all '.join(f'select {quote(table)} t,count(*) n from {table}' for table in tables)
    return json.loads(query(f'select jsonb_object_agg(t,n) from ({union}) x'))


def reserve(event, tier, request, app):
    items = json.dumps([{'tier_id': tier, 'quantity': 1}])
    token = hashlib.sha256(request.encode()).hexdigest()
    args = ','.join([quote(event), quote(items) + '::jsonb', "'Expiry Buyer'", "'expiry@example.invalid'", quote(request), quote(token)])
    statement = f"begin; set local statement_timeout='25s'; set local application_name={quote(app)}; set local role service_role; select row_to_json(r) from public.server_reserve_checkout({args}) r; commit;"
    try:
        return {'ok': True, 'rows': query(statement)}
    except subprocess.CalledProcessError as error:
        return {'ok': False, 'error': error.stderr}


def fixture(prefix):
    owner = f'{prefix}0000-0000-4000-8000-000000000001'
    events = [f'{prefix}1000-0000-4000-8000-{n:012d}' for n in (1, 2)]
    tier = f'{prefix}2000-0000-4000-8000-000000000001'
    source = (ROOT / 'supabase/tests/database/checkout_integrity_concurrency.test.sh').read_text()
    # Extract SQL only; never execute the shell helper or linked CLI commands.
    setup = source.split('run_query setup "', 1)[1].split('commit;"', 1)[0] + 'commit;'
    setup = setup.replace('$fixture_organizer', owner).replace('$fixture_lost_event', events[1]).replace('$fixture_event', events[0])
    setup = setup.replace('97200000', prefix + '2000').replace('acct_checkoutintegrity', 'acct_expiry' + prefix)
    setup = setup.replace('checkout-integrity-concurrency@example.invalid', prefix + '@example.invalid')
    # All rows commit with canonical policy/disclosure/publication provenance.
    # Expiry is set by this initial insert, never an eligibility-breaking edit.
    for day in (2, 3):
        setup = setup.replace(f"now() + interval '{day} days 2 hours'", "clock_timestamp() + interval '12 seconds'")
        setup = setup.replace(f"now() + interval '{day} days'", "clock_timestamp() - interval '1 hour'")
    query(setup)
    return owner, events, tier


def compete(case, owner, event, tier):
    app = 'paid_expiry_' + uuid.uuid4().hex
    request = str(uuid.uuid4())
    original = reserve(event, tier, request, app + '_initial') if case == 'replay' else None
    if original:
        assert original['ok'] and original['rows'], original
    holder = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        lock = {
            'event': f'select public.lock_event_ticketing_operation({quote(event)})',
            'account': f'select organizer_id from public.organizer_stripe_accounts where organizer_id={quote(owner)} for update',
            'fee': "select id from public.platform_fee_rules where not livemode and currency='usd' for update",
            'replay': f'select public.lock_event_ticketing_operation({quote(event)})',
        }[case]
        holder.stdin.write(f"begin; {lock}; select 'HELD:' || pg_backend_pid();\n")
        holder.stdin.flush()
        held_deadline = time.monotonic() + 15
        held_output = ''
        while True:
            assert select.select([holder.stdout], [], [], max(0, held_deadline - time.monotonic()))[0], 'Holder did not acquire lock within 15s'
            chunk = os.read(holder.stdout.fileno(), 4096).decode()
            if not chunk:
                raise RuntimeError(holder.stderr.read())
            held_output += chunk
            markers = [line for line in held_output.splitlines() if line.startswith('HELD:')]
            if markers:
                holder_pid = int(markers[0].split(':')[1])
                break
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            waiter = pool.submit(reserve, event, tier, request, app)
            deadline = time.monotonic() + 8
            while True:
                observed = json.loads(query(f"""select json_build_object(
                  'blocked',exists(select 1 from pg_stat_activity where application_name={quote(app)} and wait_event_type='Lock' and {holder_pid}=any(pg_blocking_pids(pid))),
                  'eligibleWhileBlocked',private.event_is_publicly_eligible({quote(event)},clock_timestamp()),
                  'endsAt',(select ends_at from public.events where id={quote(event)}),
                  'observedAt',clock_timestamp())"""))
                if observed['blocked']:
                    assert observed['eligibleWhileBlocked'], observed
                    break
                assert time.monotonic() < deadline, f'{case}: no confirmed blocking session'
                time.sleep(.03)
            # Wait to the stored deadline; clock verification precedes COMMIT.
            # This proves actual blocking across expiry, independent of timing.
            holder.stdin.write(f"select pg_sleep(greatest(0,extract(epoch from ((select ends_at from public.events where id={quote(event)})-clock_timestamp())))+.05); select 'EXPIRED:' || (ends_at<=clock_timestamp()) from public.events where id={quote(event)}; commit;\\q\n")
            holder.stdin.flush()
            holder.wait(timeout=20)
            released = holder.stdout.read()
            assert holder.returncode == 0 and 'EXPIRED:true' in released, (released, holder.stderr.read())
            result = waiter.result(timeout=30)
        truth = json.loads(query(f"""select json_build_object(
          'expired',ends_at<=clock_timestamp(), 'observedAt',clock_timestamp(),
          'orders',(select count(*) from public.orders where event_id=e.id),
          'items',(select count(*) from public.order_items i join public.orders o on o.id=i.order_id where o.event_id=e.id),
          'tickets',(select count(*) from public.tickets where event_id=e.id)) from public.events e where id={quote(event)}"""))
        passed = truth['expired'] and truth['tickets'] == 0
        if case == 'replay':
            passed = passed and result == original and truth['orders'] == 1 and truth['items'] == 1
        else:
            passed = passed and not result['ok'] and 'EVENT_NOT_SELLABLE' in result.get('error', '') and truth['orders'] == 0 and truth['items'] == 0
        evidence = {'case': case, 'passed': passed, 'wait': observed, 'after': truth, 'outcome': result}
        print(json.dumps(evidence), flush=True)
        return evidence
    finally:
        if holder.poll() is None:
            holder.kill()
            holder.wait()


def cleanup(owners, events, control):
    owner_ids, event_ids = ','.join(map(quote, owners)), ','.join(map(quote, events))
    order_ids = ','.join(map(quote, json.loads(query(f"select coalesce(json_agg(id),'[]'::json) from public.orders where event_id in ({event_ids})")))) or "'00000000-0000-0000-0000-000000000000'"
    columns = json.loads(query("""select json_agg(x) from (select format('%I.%I',n.nspname,c.relname) tablename,array_agg(quote_ident(a.attname)) cols from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid where n.nspname in ('public','private') and c.relkind='r' and a.attnum>0 and not a.attisdropped and a.atttypid='uuid'::regtype and a.attname in ('event_id','organizer_id','order_id') group by n.nspname,c.relname) x"""))
    # Synthetic namespace cleanup follows existing local concurrency proofs.
    statements = ['begin;set local session_replication_role=replica;']
    for row in columns:
        conditions = [f"{col} in ({ {'event_id': event_ids, 'organizer_id': owner_ids, 'order_id': order_ids}[col] })" for col in row['cols']]
        statements.append('delete from ' + row['tablename'] + ' where ' + ' or '.join(conditions) + ';')
    statements.extend([f'delete from public.events where id in ({event_ids});', f'delete from public.organizers where id in ({owner_ids});', f'delete from auth.users where id in ({owner_ids});', f"update private.checkout_runtime_control set checkout_creation_enabled={'true' if control == 't' else 'false'} where singleton;", 'commit;'])
    query('\n'.join(statements))


def main():
    verify()
    tables = json.loads(query("select json_agg(format('%I.%I',schemaname,tablename)) from pg_tables where schemaname in ('public','private','auth')"))
    before = counts(tables)
    control = query('select checkout_creation_enabled from private.checkout_runtime_control where singleton')
    owners, events, results = [], [], []
    recovery = Path(tempfile.mkdtemp(prefix='wheretoo-paid-expiry-')) / 'recovery.json'
    print(f'Recovery manifest: {recovery}', flush=True)
    def save_recovery():
        recovery.write_text(json.dumps({'container': CONTAINER, 'owners': owners, 'events': events, 'control': control, 'before': before, 'tables': tables}, indent=2))
    save_recovery()
    try:
        for case in ('event', 'account', 'fee', 'replay'):
            while True:
                prefix = uuid.uuid4().hex[:4]
                # Never let fixture cleanup include a pre-existing namespace.
                occupied = query(f"select exists(select 1 from auth.users where id::text like '{prefix}%' union all select 1 from public.events where id::text like '{prefix}%' union all select 1 from public.ticket_tiers where id::text like '{prefix}%')")
                if occupied == 'f':
                    break
            # Record unused IDs before setup so partial setup failures clean up.
            owners.append(f'{prefix}0000-0000-4000-8000-000000000001')
            case_events = [f'{prefix}1000-0000-4000-8000-{n:012d}' for n in (1, 2)]
            events.extend(case_events)
            save_recovery()
            owner, _, tier = fixture(prefix)
            results.append(compete(case, owner, case_events[0], tier))
    finally:
        if owners:
            cleanup(owners, events, control)
        after = counts(tables)
        assert before == after, {t: (before[t], after[t]) for t in tables if before[t] != after[t]}
        assert query('select checkout_creation_enabled from private.checkout_runtime_control where singleton') == control
        verify()
        recovery.unlink()
        print(f'PASS cleanup: all {len(tables)} table counts and paid gate restored; cron remains off; no provider calls', flush=True)
    assert all(row['passed'] for row in results), 'Expired new reservation accepted after a confirmed lock wait'
    print('PASS: event/account/fee lock waits reject ended events; exact persisted request recovery survives event expiry')


if __name__ == '__main__':
    main()
