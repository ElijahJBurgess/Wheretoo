#!/usr/bin/env python3
"""SQL and true multi-connection proof against the dedicated local email stack only.
No remote URL, credentials, provider transport or stack reset accepted.
Run legacy suites on a clean DB BEFORE this runner. Persistent synthetic fixtures
mark .supabase/email-attendees/.proof-fixtures-present; reset the dedicated stack
before later legacy suites. Never delete durable receipt evidence to clean fixtures.
"""
import concurrent.futures
import json
import pathlib
import subprocess
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[2]
DB = 'supabase_db_wheretoo-email-attendees'

def sql(statement):
    state = json.loads(subprocess.check_output(['docker', 'inspect', DB], text=True))[0]
    assert state['Name'] == '/' + DB
    ports = state['NetworkSettings']['Ports']['5432/tcp']
    assert all(p['HostPort'] == '61322' for p in ports), 'Wrong dedicated database port'
    result=subprocess.run(['docker', 'exec', '-i', DB, 'psql', '-X', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], input=statement, text=True, capture_output=True)
    if result.returncode: raise RuntimeError(result.stderr)
    return result.stdout

def expand(path):
    return '\n'.join(expand(path.parent / line[4:]) if line.startswith('\\ir ') else line for line in path.read_text().splitlines())

def create_fixture():
    sentinel=ROOT / '.supabase/email-attendees/.proof-fixtures-present'
    sentinel.write_text('Persistent synthetic email proof fixtures: reset dedicated feature DB before legacy suites.\n')
    fixture = expand(ROOT / 'supabase/tests/database/free_registration_fixture.inc')
    replacements = {prefix: str(uuid.uuid4())[:8] for prefix in ['b6100000','b6200000','b6300000']}
    for old,new in replacements.items(): fixture=fixture.replace(old,new)
    fixture=fixture.replace('free-owner@example.invalid',str(uuid.uuid4())+'@example.invalid').replace('free-other@example.invalid',str(uuid.uuid4())+'@example.invalid')
    fixture=fixture.replace("'proof:'","'"+str(uuid.uuid4())+":'")
    fixture=fixture.replace('p_number::text));',"'"+str(uuid.uuid4())+":'||p_number::text));")
    event = replacements['b6200000']+'-0000-4000-8000-000000000002'
    owner = replacements['b6100000']+'-0000-4000-8000-000000000001'
    sql("begin;"+fixture+"update private.ticket_email_settings set enabled_at=null,worker_enabled=false;select pg_temp.register(1,2,2);select public.server_configure_organizer_messages('{\"acceptingSends\":true,\"workerEnabled\":true,\"senderEmail\":\"notify@example.invalid\",\"replyTo\":\"support@example.invalid\",\"appOrigin\":\"https://example.invalid\",\"capacityPerMinute\":10,\"capacityPerDay\":100,\"capacityPerMonth\":1000,\"healthMaxAgeSeconds\":300}');select public.server_acknowledge_organizer_message_worker();commit;")
    return owner,event

def main():
    for proof_file in ['email-attendees-v1.sql','email-attendees-v1-review.sql','email-attendees-v1-policy.sql','email-attendees-v1-audiences.sql']:
        proof=sql(expand(ROOT / 'tests/integration' / proof_file))
        assert 'not ok' not in proof,proof
        print(proof_file)
        print('\n'.join(line for line in proof.splitlines() if line.startswith(('ok ', '1..'))))
    # Committed canonical fixtures are visible to independent connections.
    # Unique IDs, emails and credentials keep repeated runs separate.
    owner,event=create_fixture()
    prefix = f"begin;select set_config('request.jwt.claim.sub','{owner}',true);set local role authenticated;"
    preview=json.loads(sql(prefix+f"select public.preview_owned_organizer_message('{event}','{{\"kind\":\"everyone\"}}','Concurrent','Body');commit;").splitlines()[-2])
    request = str(uuid.uuid4())
    statement=prefix+f"select public.submit_owned_organizer_message('{event}','{{\"kind\":\"everyone\"}}','Concurrent','Body','{preview['fingerprint']}','{request}');select pg_sleep(0.3);commit;"
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(sql,[statement,statement]))
    receipts=[json.loads(next(line for line in result.splitlines() if line.startswith('{'))) for result in results]
    assert receipts[0]==receipts[1], receipts
    counts=sql(f"select (select count(*) from private.organizer_messages where request_id='{request}')||','||(select count(*) from private.organizer_message_recipients where message_id='{receipts[0]['messageId']}')||','||(select count(*) from private.organizer_message_rate_events where lane='send' and message_id='{receipts[0]['messageId']}');").strip()
    assert counts=='1,1,1',counts
    print('PASS two live connections: same UUID → one message, one unique recipient, one debit')
    replay=sql(prefix+f"select public.get_owned_organizer_message_receipt('{event}','{request}');commit;")
    assert json.loads(next(line for line in replay.splitlines() if line.startswith('{')))==receipts[0]
    print('PASS committed lost-response receipt reconciliation')
    delivery=sql(f"select id from private.organizer_message_recipients where message_id='{receipts[0]['messageId']}';").strip()
    ticket=str(uuid.uuid4())
    sql(f"update private.organizer_message_recipients set state='unknown',first_possible_dispatch_at=clock_timestamp(),dispatch_count=1 where id='{delivery}';insert into private.ticket_email_outbox(id,purpose,registration_id,state,first_possible_dispatch_at,dispatch_count) select '{ticket}','initial',id,'unknown',clock_timestamp(),1 from public.free_registrations where event_id='{event}';")
    webhook='concurrent-'+str(uuid.uuid4())
    observer=lambda attempt,provider: f"begin;set local role service_role;select public.server_observe_email('{webhook}','{attempt}','{provider}','sent','2026-09-23T00:00:00Z');select pg_sleep(0.2);commit;"
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        evidence=list(pool.map(sql,[observer(delivery,'org-'+delivery),observer(ticket,'ticket-'+ticket)]))
    answers=[next(line for line in result.splitlines() if line in ('t','f')) for result in evidence]
    assert sorted(answers)==['f','t'],answers
    print('PASS simultaneous cross-ledger webhook ID: exactly one observer accepts')
    ambiguous=str(uuid.uuid4())
    sql(f"insert into private.ticket_email_outbox(id,purpose,registration_id,requested_by,request_id,state,first_possible_dispatch_at,dispatch_count) select '{delivery}','resend',id,'{owner}','{ambiguous}','unknown',clock_timestamp(),1 from public.free_registrations where event_id='{event}';")
    result=sql(f"select public.server_observe_email('ambiguous-{ambiguous}','{delivery}','ambiguous-provider','sent','2026-09-23T00:00:00Z');").strip()
    assert result=='f',result
    print('PASS attempt UUID present in both ledgers is rejected')
    sql("select public.server_configure_organizer_messages('{\"acceptingSends\":false,\"workerEnabled\":false}');")

if __name__=='__main__':
    try: main()
    finally: sql("select public.server_configure_organizer_messages('{\"acceptingSends\":false,\"workerEnabled\":false}');")
