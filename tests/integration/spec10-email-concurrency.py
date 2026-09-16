# Spec10 regression copy: only the verified database target differs.
#!/usr/bin/env python3
"""Local race proof. Every write uses the recorded Spec 07 container identity."""
import concurrent.futures, hashlib, importlib.util, json, pathlib, subprocess, uuid
ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('spec07_db', ROOT / 'tests/integration/spec10-database.py')
db = importlib.util.module_from_spec(spec)
spec.loader.exec_module(db)

def query(statement):
    container = db.verify()
    return subprocess.run(['docker','exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'], input=statement, text=True, capture_output=True, check=True).stdout.strip()

def json_query(statement):
    output = query(statement)
    return json.loads(output.splitlines()[-1] or 'null') if output else None

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"

def race(count, action):
    with concurrent.futures.ThreadPoolExecutor(max_workers=count) as pool:
        return list(pool.map(action, range(count)))

def main():
    # A per-run synthetic UUID prefix isolates this fixture from every rollback suite.
    prefix = uuid.uuid4().hex[:4]
    def identity(group, n=1):
        return f'{prefix}{group:04x}-0000-4000-8000-{n:012d}'
    fixture = db.expand(ROOT / 'supabase/tests/database/spec07_email_fixture.inc')
    for old, group in [('b6100000',0x1000),('b6200000',0x2000),('b6300000',0x3000)]:
        fixture = fixture.replace(old, f'{prefix}{group:04x}')
    fixture = fixture.replace('free-owner@example.invalid',f'owner-{prefix}@example.invalid').replace('free-other@example.invalid',f'other-{prefix}@example.invalid')
    owner, event, request_id = identity(0x1000), identity(0x2000), identity(0x3000)
    claimed = None
    try:
        query('begin;\n' + fixture + '\nselect pg_temp.register(1,2);\ncommit;')
        before = json_query(f"select jsonb_agg(to_jsonb(t) order by t.id) from public.tickets t where event_id={quote(event)};")
        manifest = json.dumps([{'unit_sequence':n,'credential_hash':hashlib.sha256(f'1:{n}'.encode()).hexdigest()} for n in (1,2)])
        args = ','.join([quote(request_id),quote(event),quote('Pat Guest'),quote('pat@example.invalid'),'2',quote(hashlib.sha256(b'proof:1').hexdigest()),quote(manifest)+'::jsonb'])
        results = race(8, lambda _: json_query('select public.server_confirm_free_registration('+args+');'))
        assert len({json.dumps(r,sort_keys=True) for r in results}) == 1
        registration = results[0]['registrationId']
        assert query(f"select count(*) from private.ticket_email_outbox where registration_id={quote(registration)} and purpose='initial';") == '1'
        print('PASS: eight authoritative replay races preserve one registration, two tickets and one initial intent')

        claims = race(2, lambda _: json_query('select public.server_claim_ticket_email();'))
        real = [c for c in claims if c is not None]
        assert len(real) == 1, 'Expected one claim; run before seeding unrelated pending UI intents'
        claimed = real[0]
        assert claimed['registration_id'] == registration
        print('PASS: two workers cannot claim the same intent')

        resend_id = str(uuid.uuid4())
        resend_sql = f"begin; set local role authenticated; select set_config('request.jwt.claim.sub',{quote(owner)},true); select public.request_ticket_email_resend({quote(event)},'free_registration',{quote(registration)},{quote(resend_id)}); commit;"
        def resend(_):
            lines = query(resend_sql).splitlines()
            return json.loads(next(line for line in lines if line.startswith('{')))
        resends = race(8,resend)
        assert len({r['attemptId'] for r in resends}) == 1
        assert all(r['kind']=='queued' for r in resends)
        print('PASS: eight organizer retries share one request identity and one durable resend')

        attempt, lease = claimed['id'], claimed['lease_id']
        context = json_query(f"select public.server_prepare_ticket_email_context({quote(attempt)},{quote(lease)});")
        envelope = quote(json.dumps({'version':1,'keyId':'local','nonce':'A'*16,'ciphertext':'A'*22}))+'::jsonb'
        assert query(f"select public.server_save_ticket_email_payload({quote(attempt)},{quote(lease)},{quote(hashlib.sha256(attempt.encode()).hexdigest())},{envelope});")=='t'
        first = json_query(f"select public.server_begin_ticket_email_dispatch({quote(attempt)},{quote(lease)});")
        # Make only this intent eligible for a replacement worker, leaving resend untouched.
        query(f"update private.ticket_email_outbox set lease_until=now()-interval '1 second',next_attempt_at=now()-interval '1 minute' where id={quote(attempt)}; update private.ticket_email_outbox set next_attempt_at=now()+interval '1 hour' where request_id={quote(resend_id)};")
        replacement = json_query('select public.server_claim_ticket_email();')
        assert replacement['id']==attempt and replacement['lease_id']!=lease
        assert query(f"select public.server_finish_ticket_email_dispatch({quote(attempt)},{quote(lease)},'failed');")=='f'
        new_lease = replacement['lease_id']
        second = json_query(f"select public.server_begin_ticket_email_dispatch({quote(attempt)},{quote(new_lease)});")
        assert first['payload']==second['payload'] and first['idempotencyKey']==second['idempotencyKey']
        assert first['firstPossibleDispatchAt']==second['firstPossibleDispatchAt']
        print('PASS: stale worker is fenced; replacement preserves payload, key and original dispatch anchor')

        webhook_id = 'local-race-'+str(uuid.uuid4())
        observation = f"select public.server_observe_ticket_email({quote(webhook_id)},{quote(attempt)},'local-provider-id','delivered','2026-09-11T00:00:00Z');"
        assert all(value=='t' for value in race(8,lambda _:query(observation)))
        assert query(f"select public.server_finish_ticket_email_dispatch({quote(attempt)},{quote(new_lease)},'unknown');")=='t'
        assert query(f"select state||':'||observation from private.ticket_email_outbox where id={quote(attempt)};")=='accepted:delivered'
        assert query(f"select count(*) from private.ticket_email_observations where webhook_id={quote(webhook_id)};")=='1'
        after = json_query(f"select jsonb_agg(to_jsonb(t) order by t.id) from public.tickets t where event_id={quote(event)};")
        assert before==after
        print('PASS: eight duplicate observations reconcile before lost response persistence without changing any ticket record')
        print('5 concurrency scenarios passed; synthetic fixture namespace:',prefix)
    finally:
        # No scheduler exists. Restore inactive settings even if a proof fails.
        query('update private.ticket_email_settings set enabled_at=null,worker_enabled=false,limits=null;')

if __name__=='__main__':
    try:
        main()
    except subprocess.CalledProcessError as error:
        print(error.stderr)
        raise
