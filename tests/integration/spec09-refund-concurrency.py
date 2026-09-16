#!/usr/bin/env python3
"""Offline refund race proof, exclusively on the identity-guarded Spec 09 DB.

The per-run synthetic fixture is retained in this disposable database so failure
artifacts remain inspectable. No production/provider connection is accepted.
"""
import concurrent.futures
import contextlib
import hashlib
import importlib.util
import json
import pathlib
import subprocess
import threading
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('spec09_database', ROOT / 'tests/integration/spec08-spec09-database.py')
db = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(db)


def command():
    # Verify recorded container ID, task label, loopback port and disabled cron
    # immediately before opening every SQL connection, including the lock holder.
    return ['docker', 'exec', '-i', db.verify(), 'psql', '-X', '-qAt',
            '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres']


def query(statement):
    return subprocess.run(command(), input=statement, text=True, capture_output=True,
                          check=True, timeout=30).stdout.strip()


def json_query(statement):
    lines = query(statement).splitlines()
    return json.loads(next(line for line in reversed(lines) if line.startswith(('{', '['))))


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


@contextlib.contextmanager
def hold_payment_lock(order):
    process = subprocess.Popen(command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True)
    try:
        db.verify()
        process.stdin.write(f"begin; set local statement_timeout='15s'; select * from private.lock_payment_order({quote(order)}); select 'SPEC09_LOCK_HELD';\n")
        process.stdin.flush()
        while True:
            line = process.stdout.readline()
            if not line:
                raise RuntimeError('Lock holder failed: ' + process.stderr.read())
            if line.strip() == 'SPEC09_LOCK_HELD':
                break
        yield
    finally:
        if process.poll() is None:
            # This session only holds locks; rollback releases the waiting calls.
            db.verify()
            process.stdin.write('rollback;\n\\q\n')
            process.stdin.flush()
            process.wait(timeout=20)
        process.stdin.close()
        process.stdout.close()
        process.stderr.close()
        assert process.returncode == 0, 'Lock holder failed'


def race(count, action):
    barrier = threading.Barrier(count)

    def run(index):
        barrier.wait(timeout=15)
        return action(index)

    with concurrent.futures.ThreadPoolExecutor(max_workers=count) as pool:
        return list(pool.map(run, range(count)))


def main():
    nonce = uuid.uuid4().hex
    prefixes = {old: uuid.uuid4().hex[:8] for old in ('a6100000', 'a6200000', 'a6300000', 'a6400000')}
    fixture = db.expand(ROOT / 'supabase/tests/database/helpers/spec09_refund_setup.inc')
    for old, new in prefixes.items():
        fixture = fixture.replace(old, new)
    fixture = fixture.replace('integrity-owner@example.invalid', f'owner-{nonce}@example.invalid')
    fixture = fixture.replace('integrity-other@example.invalid', f'other-{nonce}@example.invalid')
    fixture = fixture.replace('integrityfulfillment', 'spec09race' + nonce)
    fixture = fixture.replace('cs_test_integrityclean', 'cs_test_spec09race' + nonce)
    fixture = fixture.replace("repeat('1',64)", quote(hashlib.sha256(nonce.encode()).hexdigest()))
    owner = prefixes['a6100000'] + '-0000-4000-8000-000000000001'
    event = prefixes['a6200000'] + '-0000-4000-8000-000000000001'
    payment = 'spec09race' + nonce
    query('begin;\n' + fixture + f"\nselect pg_temp.record_and_fulfill({quote(payment)},{quote(payment)},id,session_id) from fulfillment_orders;\ncommit;")
    order = query(f'select id from public.orders where event_id={quote(event)};')
    assert uuid.UUID(order)
    query(f"select * from public.server_redeem_paid_ticket({quote(owner)},{quote(event)},(select credential_hash from public.tickets where order_id={quote(order)} and admission_label='General Admission' order by unit_sequence limit 1));")
    before = json_query(f'select jsonb_agg(to_jsonb(t) order by id) from public.tickets t where order_id={quote(order)};')
    assert len(before) == 3 and sorted(t['status'] for t in before) == ['used', 'valid', 'valid']
    used = next(t for t in before if t['status'] == 'used')
    assert used['used_at']
    claim = f'select public.server_claim_owned_refund({quote(owner)},{quote(event)},{quote(order)});'
    app = 'spec09-race-' + nonce

    # Observe eight actual PostgreSQL lock waiters before releasing the common
    # event/order lock. A barrier alone would not prove overlapping DB requests.
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        with hold_payment_lock(order):
            futures = [pool.submit(json_query, f"begin; set local role service_role; set local application_name={quote(app)}; set local statement_timeout='20s'; {claim} commit;") for _ in range(8)]
            deadline = time.monotonic() + 12
            waiters = 0
            while time.monotonic() < deadline:
                waiters = int(query(f"select count(*) from pg_stat_activity where application_name={quote(app)} and wait_event_type='Lock';"))
                if waiters == 8:
                    break
                if any(f.done() for f in futures):
                    raise AssertionError('A claim finished before the held payment lock was released')
                time.sleep(0.05)
            assert waiters == 8, f'Expected eight overlapping blocked claims, saw {waiters}'
        claims = [future.result(timeout=25) for future in futures]
    assert sum(result['dispatch'] is True for result in claims) == 1, claims
    assert all(result['state'] == 'submitting' for result in claims), claims
    operation = json_query(f'select to_jsonb(o) from private.order_refund_operations o where order_id={quote(order)};')
    assert operation['idempotency_key'] == 'whereto-refund-integrity-v1:' + order
    assert operation['first_possible_dispatch_at'] and operation['requested_at']
    assert operation['snapshot']['totalMinor'] == 7000
    assert query(f'select count(*) from private.order_refund_operations where order_id={quote(order)};') == '1'
    assert before == json_query(f'select jsonb_agg(to_jsonb(t) order by id) from public.tickets t where order_id={quote(order)};')
    print('PASS: eight observed concurrent lock waiters grant exactly one dispatch and persist one immutable operation; all admission fields unchanged')

    query(f"select public.server_note_refund_observation({quote(owner)},{quote(event)},{quote(order)},'unknown',null);")
    retried = race(8, lambda _: json_query(claim))
    assert all(result == {'dispatch': False, 'state': 'unknown'} for result in retried), retried
    after_unknown = json_query(f'select to_jsonb(o) from private.order_refund_operations o where order_id={quote(order)};')
    for key in ('id', 'idempotency_key', 'snapshot', 'requested_at', 'first_possible_dispatch_at'):
        assert operation[key] == after_unknown[key], key
    assert before == json_query(f'select jsonb_agg(to_jsonb(t) order by id) from public.tickets t where order_id={quote(order)};')
    print('PASS: eight concurrent retries after lost provider response cannot dispatch or rotate operation identity and preserve Used/Valid/Valid')

    query(f"select public.server_note_refund_observation({quote(owner)},{quote(event)},{quote(order)},'failed',null);")
    late_unknowns = race(8, lambda _: query(f"select public.server_note_refund_observation({quote(owner)},{quote(event)},{quote(order)},'unknown',null);"))
    assert len(late_unknowns) == 8
    assert query(f'select state from private.order_refund_operations where order_id={quote(order)};') == 'failed'
    assert all(result == {'dispatch': False, 'state': 'failed'} for result in race(8, lambda _: json_query(claim)))
    assert before == json_query(f'select jsonb_agg(to_jsonb(t) order by id) from public.tickets t where order_id={quote(order)};')
    print('PASS: eight delayed unknown observations cannot erase definite failure, reopen dispatch or mutate admissions')

    refund = 're_' + payment
    receipt = 'evt_refund' + nonce
    query(f"select public.server_note_refund_observation({quote(owner)},{quote(event)},{quote(order)},'processing',{quote(refund)});")
    # This is canonical SQL evidence, not a forged signature test or a provider
    # call. Actual webhook cryptography is covered by the separate Edge suite.
    completion = f"""begin;
      set local role service_role;
      select * from public.server_record_webhook_receipt({quote(receipt)},'refund.updated',false,{quote(refund)},'2026-07-29.dahlia','2026-09-11 00:00:00+00',repeat('b',64));
      select to_jsonb(r) from public.orders o cross join lateral public.server_apply_verified_refund(
        {quote(receipt)},o.id,{quote(refund)},o.stripe_payment_intent_id,o.stripe_charge_id,
        {quote('trr_' + payment)},{quote('fr_' + payment)},7000,'usd','succeeded','requested_by_customer',
        true,true,7000,o.application_fee_amount_minor,true,null) r where o.id={quote(order)};
      commit;"""
    completions = race(8, lambda _: json_query(completion))
    assert all(result['order_status'] == 'refunded' and result['ticket_status'] == 'mixed' for result in completions), completions
    after = json_query(f'select jsonb_agg(to_jsonb(t) order by id) from public.tickets t where order_id={quote(order)};')
    assert sorted(t['status'] for t in after) == ['refunded', 'refunded', 'used']
    assert next(t for t in after if t['id'] == used['id']) == used, 'Used record changed during concurrent completion'
    assert [t['id'] for t in before] == [t['id'] for t in after]
    assert [t['credential_hash'] for t in before] == [t['credential_hash'] for t in after]
    assert query(f'select count(*) from public.refunds where order_id={quote(order)};') == '1'
    assert query(f'select count(*) from public.stripe_webhook_events where stripe_event_id={quote(receipt)};') == '1'
    metrics = json_query(f"begin; set local role authenticated; select set_config('request.jwt.claim.sub',{quote(owner)},true); select public.get_organizer_event_metrics({quote(event)}); commit;")
    assert {key: metrics[key] for key in ('grossSalesMinor', 'sold', 'orderCount', 'issued', 'checkedIn')} == {'grossSalesMinor': 7000, 'sold': 3, 'orderCount': 1, 'issued': 3, 'checkedIn': 1}
    tiers = {tier['name']: tier for tier in metrics['tiers']}
    assert tiers['General Admission']['remaining'] == 14 and tiers['VIP']['remaining'] == 8
    completed = json_query(f'select to_jsonb(o) from private.order_refund_operations o where order_id={quote(order)};')
    assert completed['state'] == 'completed' and completed['completed_at']
    for key in ('id', 'idempotency_key', 'snapshot', 'requested_at', 'first_possible_dispatch_at'):
        assert operation[key] == completed[key], key
    assert all(result == {'dispatch': False, 'state': 'completed'} for result in race(8, lambda _: json_query(claim)))
    print('PASS: eight concurrent canonical completion replays retain one receipt/refund, Used history and ticket identities, release exactly two GA plus one VIP, and preserve $70/3 sold/1 order/1 of 3 entry')
    print('4 concurrency scenarios passed; local-only retained fixture:', json.dumps({'organizerId': owner, 'eventId': event, 'orderId': order, 'namespace': nonce}))


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as error:
        print(error.stderr)
        raise
