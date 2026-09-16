#!/usr/bin/env python3
"""Explicit Spec14-only forward recovery races. Root must release the runtime.

No providers/workers/global queue claims. Own UUID fixtures are removed after
complete outside-table hashes are compared. Never executes an inherited shell.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('j08g_race_transport', ROOT / 'tests/integration/spec14-moderation-input-concurrency.py')
transport = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(transport)
query, parsed, quote, db = transport.query, transport.parsed, transport.quote, transport.db


def identifier(value):
    if not re.fullmatch(r'[a-z_][a-z0-9_]*', value):
        raise ValueError('invalid SQL identifier')
    return '"' + value + '"'


def predicate(ids, receipt_prefix):
    if not ids or any(str(uuid.UUID(v)) != v for v in ids) or not re.fullmatch(r'evt_J08gRace[0-9a-f]{32}', receipt_prefix):
        raise ValueError('invalid fixture scope')
    values = ','.join(quote(v) for v in ids)
    return ("exists(select 1 from jsonb_each_text(to_jsonb(t)) kv where kv.key in "
            "('id','user_id','organizer_id','event_id','order_id','order_item_id','ticket_tier_id','source_id') "
            f"and kv.value=any(array[{values}]::text[])) or "
            f"coalesce(to_jsonb(t)->>'stripe_event_id' like {quote(receipt_prefix + '%')},false)")


def inventory():
    return parsed("select jsonb_agg(jsonb_build_array(schemaname,tablename) order by schemaname,tablename) from pg_tables where schemaname in ('public','private') or (schemaname='auth' and tablename='users');")


def capture(tables, ids, prefix):
    pred = predicate(ids, prefix)
    statements = []
    for schema, table in tables:
        name = identifier(schema) + '.' + identifier(table)
        statements.append(f"select {quote(schema + '.' + table)} name, encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]')::text,'sha256'),'hex') hash from {name} t where not ({pred})")
    hashes = parsed('select jsonb_object_agg(name,hash) from (' + ' union all '.join(statements) + ') s;')
    return hashes


def count_owned(tables, ids, prefix):
    pred = predicate(ids, prefix)
    return int(query('select sum(n) from (' + ' union all '.join(
        f'select count(*) n from {identifier(s)}.{identifier(t)} t where ({pred})' for s, t in tables) + ') s;'))


def apply(plan):
    return 'select to_jsonb(r) from public.server_reconcile_unattached_paid_checkout(' + ','.join([
        quote(plan['order_id']), quote(plan['session_id']), quote(plan['stripe_event_id']),
        quote(plan['snapshot']['snapshot_digest']), quote(json.dumps(plan['payment'])) + '::jsonb',
        quote(json.dumps(plan['manifest'])) + '::jsonb']) + ') r;'


def main():
    nonce = uuid.uuid4().hex
    namespace = nonce[:4]
    prefix = 'evt_J08gRace' + nonce
    source_path = ROOT / 'supabase/tests/database/unattached_checkout_forward.test.sql'
    source = source_path.read_text()
    fixed = re.findall(r"ad[123]00000-0000-4000-8000-[0-9]{12}", source)
    # Change the first four UUID digits, keeping fixture groups distinct.
    for group in ('10', '20', '30', '40'):
        source = source.replace('ad' + group + '0000', namespace + group + '00')
    ids = sorted({v.replace('ad' + v[2:4] + '0000', namespace + v[2:4] + '00') for v in fixed})
    owner1, owner2 = namespace + '1000-0000-4000-8000-000000000001', namespace + '1000-0000-4000-8000-000000000002'
    event2 = namespace + '2000-0000-4000-8000-000000000002'
    tables = inventory()
    assert len(tables) == 48, 'unexpected table inventory'
    assert count_owned(tables, ids, prefix) == 0, 'fixture namespace collision'
    assert query('select checkout_creation_enabled from private.checkout_runtime_control where singleton;') == 't', 'checkout already must be enabled by Root'
    before = capture(tables, ids, prefix)
    evidence = {'status': 'running', 'nonce': nonce, 'sourceSha256': hashlib.sha256(source_path.read_bytes()).hexdigest(), 'outsideBefore': before, 'cases': []}
    path = db.STATE / ('j08g-forward-concurrency-' + nonce + '.json')
    db.save(path, evidence)
    setup = source[source.index('insert into auth.users'):source.index("select pg_temp.forward_inputs('eligible');")]
    setup = setup.replace("update private.checkout_runtime_control\nset checkout_creation_enabled = true\nwhere singleton;", '')
    setup = setup.replace("'evt_ForwardUnattachedOwn'", quote(prefix + 'eligible')).replace("'evt_Forward'||p_kind", quote(prefix) + '||p_kind')
    setup = setup.replace('acct_integrityfulfillment', 'acct_J08gRace' + nonce + 'A')
    setup = setup.replace('cs_test_ForwardUnattachedOwn', 'cs_test_J08gRace' + nonce + 'eligible')
    for provider_prefix in ('cs_test', 'pi', 'ch', 'tr', 'fee', 'txn'):
        setup = setup.replace("'" + provider_prefix + "_Forward'||p_kind", quote(provider_prefix + '_J08gRace' + nonce) + '||p_kind')
    # TAP-only observations do not mutate; suppress them in the setup connection.
    setup = re.sub(r'select (?:is|ok)\(.*?;\n', '', setup, flags=re.S)
    setup += "\nselect pg_temp.forward_inputs('eligible');\n"
    for kind in ('Cancel', 'Attach', 'Conflict', 'Q1'):
        setup += f'select pg_temp.forward_new({quote(kind)});\n'
    # A second publicly eligible event proves cross-order Session serialization,
    # rather than obtaining accidental serialization on the first event lock.
    setup += f"""
insert into public.organizer_stripe_accounts(organizer_id,stripe_account_id,transfers_status,payouts_status,requirements_status,requirements_currently_due_count,requirements_past_due_count,last_synced_at)
values({quote(owner2)},'acct_J08gRace{nonce}','active','active','clear',0,0,now());
insert into private.event_risk_disclosures(event_id,minimum_age,alcohol_present,cannabis_present,explicit_adult_content,gambling_present,weapons_present,high_risk_activity)
values({quote(event2)},'all_ages',false,false,false,false,false,false);
select set_config('request.jwt.claim.sub',{quote(owner2)},true);
set local role authenticated;
select public.accept_current_event_policies({quote(event2)});
select public.publish_event({quote(event2)});
reset role;
insert into forward_fixture(order_id,session_id,stripe_event_id,kind)
select order_id,(select session_id from forward_fixture where kind='Q1'),{quote(prefix+'Q2')},'Q2'
from public.server_reserve_checkout({quote(event2)},'[{{"tier_id":"{namespace}3000-0000-4000-8000-000000000003","quantity":1}}]',
'Race Control','race-{nonce}@example.invalid',{quote(str(uuid.uuid4()))},repeat('4',64));
insert into public.stripe_webhook_events(stripe_event_id,event_type,livemode,stripe_object_id,api_version,stripe_created_at,payload_sha256)
select stripe_event_id,'checkout.session.completed',false,session_id,'2026-07-29.dahlia',now(),repeat('5',64) from forward_fixture where kind='Q2';
select pg_temp.forward_inputs('Q2');
update public.orders set status='expired' where id in (select order_id from forward_fixture where kind in ('Q1','Q2'));
select jsonb_agg(to_jsonb(f) order by kind) from forward_fixture f;
"""
    if re.search(r'\b(?:commit|rollback)\s*;', setup, re.I):
        raise ValueError('fixture setup contains a transaction terminator')
    committed = False
    try:
        rows = parsed("begin; set local search_path=public,extensions;\n" + setup + '\ncommit;')
        committed = True
        plans = {r['kind']: r for r in rows}
        ids += [r['order_id'] for r in rows]
        evidence['plans'] = rows; db.save(path, evidence)
        def order_lock(p): return f"select * from private.lock_payment_order({quote(p['order_id'])});"
        p = plans['eligible']
        transport.compete('two paid writers', order_lock(p), apply(p), apply(p), 'advisory')
        evidence['cases'].append('two paid writers: one source unit set'); db.save(path, evidence)
        p = plans['Attach']
        transport.compete('UI attach wins', order_lock(p) + f"select public.server_attach_checkout_session({quote(p['order_id'])},{quote(p['session_id'])},{quote(p['snapshot']['checkout_expires_at'])});", '', apply(p), 'advisory')
        evidence['cases'].append('same-Session UI attach: one source unit set'); db.save(path, evidence)
        p = plans['Cancel']
        transport.compete('cancel wins', order_lock(p) + f"update public.orders set status='cancelled' where id={quote(p['order_id'])};", '', apply(p), 'advisory')
        evidence['cases'].append('cancellation wins: quarantine preserves terminal'); db.save(path, evidence)
        p = plans['Conflict']
        try:
            transport.compete('conflicting Session wins', order_lock(p) + f"select public.server_attach_checkout_session({quote(p['order_id'])},'cs_test_J08gOther{nonce}',{quote(p['snapshot']['checkout_expires_at'])});", '', apply(p), 'advisory')
            raise AssertionError('conflicting Session accepted')
        except subprocess.CalledProcessError as error:
            assert 'PAYMENT_SNAPSHOT_MISMATCH' in error.stderr
        evidence['cases'].append('conflicting Session wins: original receipt cannot replace it'); db.save(path, evidence)
        try:
            transport.compete('cross-event quarantine Session reuse', apply(plans['Q1']), '', apply(plans['Q2']), 'advisory')
            raise AssertionError('quarantined Session reused across orders')
        except subprocess.CalledProcessError as error:
            assert 'PAYMENT_OBJECT_ALREADY_USED' in error.stderr
        evidence['cases'].append('cross-event Session reuse: exactly one review anchor'); db.save(path, evidence)
        for kind, p in plans.items():
            current = parsed(f"select jsonb_build_object('status',o.status,'session',o.stripe_checkout_session_id,'failure',o.failure_code,'tickets',(select count(*) from public.tickets t where t.order_id=o.id),'emails',(select count(*) from private.ticket_email_outbox e where e.order_id=o.id)) from public.orders o where id={quote(p['order_id'])};")
            if kind in ('eligible', 'Attach'):
                assert current['status'] == 'paid' and current['session'] == p['session_id'] and current['tickets'] == 3 and current['emails'] == 1
            else:
                assert current['tickets'] == 0 and current['emails'] == 0
                if kind == 'Cancel': assert current['status'] == 'cancelled' and current['failure'] == 'UNATTACHED_PAID_CHECKOUT'
                if kind == 'Q1': assert current['status'] == 'expired' and current['failure'] == 'UNATTACHED_PAID_CHECKOUT'
                if kind == 'Q2': assert current['status'] == 'expired' and current['failure'] is None
        after = capture(tables, ids, prefix)
        assert after == before, 'outside table changed during races'
        evidence['outsideAfter'] = after
        evidence['status'] = 'checks-passed-awaiting-cleanup'; db.save(path, evidence)
    except Exception as error:
        evidence['status'] = 'failed'; evidence['failureType'] = type(error).__name__; db.save(path, evidence)
        raise
    finally:
        # Scope by preflight-empty known owner/event identifiers even if setup's
        # COMMIT acknowledgement was lost. No principal row matches this predicate.
        scoped = parsed(f"select coalesce(jsonb_agg(id),'[]') from public.orders where organizer_id in ({quote(owner1)},{quote(owner2)});")
        ids = sorted(set(ids + scoped))
        predicate_sql = predicate(ids, prefix)
        cleanup = 'begin; set local session_replication_role=replica;\n' + '\n'.join(
            f'delete from {identifier(s)}.{identifier(t)} t where ({predicate_sql});' for s, t in tables) + '\ncommit;'
        query(cleanup)
        evidence['cleanupVerified'] = count_owned(tables, ids, prefix) == 0
        evidence['outsideAfterCleanup'] = capture(tables, ids, prefix)
        evidence['setupAcknowledged'] = committed
        clean = evidence['cleanupVerified'] and evidence['outsideAfterCleanup'] == before
        if not clean: evidence['status'] = 'failed-cleanup'
        elif evidence['status'] == 'checks-passed-awaiting-cleanup': evidence['status'] = 'passed'
        db.save(path, evidence)
        assert clean, 'fixture cleanup/preservation failed'
    print('PASS: five forward concurrency cases; exact outside table hashes and fixture cleanup verified')
    print('Evidence:', path.relative_to(ROOT))


if __name__ == '__main__':
    main()
