#!/usr/bin/env python3
"""True lock-delay review regression. Run after clean legacy suites, before reset.
Uses only the dedicated local DB/port and marks persistent fixture sentinel.
"""
import json
import pathlib
import runpy
import subprocess
import uuid

ROOT=pathlib.Path(__file__).resolve().parents[2]
helper=runpy.run_path(str(ROOT/'tests/integration/email-attendees-v1-concurrency.py'))
sql=helper['sql']
DB=helper['DB']


def locked_call(lock,query):
    # Explicit handshake proves the blocking lock is held before the contender enters.
    proc=subprocess.Popen(['docker','exec','-i',DB,'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    proc.stdin.write('begin;'+lock+";select 'LOCK_READY';select pg_sleep(2);commit;\n")
    proc.stdin.close()
    while True:
        line=proc.stdout.readline()
        if line.strip()=='LOCK_READY':break
        if not line:raise RuntimeError(proc.stderr.read())
    result=sql(query).strip()
    proc.wait(timeout=10)
    assert proc.returncode==0,proc.stderr.read()
    return result


def main():
    owner,event=helper['create_fixture']()
    selector='{"kind":"everyone"}'
    prefix=f"begin;select set_config('request.jwt.claim.sub','{owner}',true);"
    preview=json.loads(next(l for l in sql(prefix+f"select public.preview_owned_organizer_message('{event}','{selector}','Locks','Body');commit;").splitlines() if l.startswith('{')))
    receipt=json.loads(next(l for l in sql(prefix+f"select public.submit_owned_organizer_message('{event}','{selector}','Locks','Body','{preview['fingerprint']}','{uuid.uuid4()}');commit;").splitlines() if l.startswith('{')))
    source=receipt['messageId']
    # Synthetic recipient ledger fixtures are independent; no actual transport occurs.
    def recipient(state='queued',first='null',count=0):
        mid,rid,lid=map(str,(uuid.uuid4(),uuid.uuid4(),uuid.uuid4()))
        sql(f"insert into private.organizer_messages(id,event_id,requested_by,request_id,request_digest,selector,preview_fingerprint,subject,body,facts,deadline_basis,recipient_count) select '{mid}',event_id,requested_by,gen_random_uuid(),repeat('4',64),selector,preview_fingerprint,subject,body,facts,deadline_basis,1 from private.organizer_messages where id='{source}';insert into private.organizer_message_recipients(id,message_id,normalized_email,recipient_hash,state,payload,first_possible_dispatch_at,dispatch_count,lease_id,lease_until,next_attempt_at) values('{rid}','{mid}','{rid}@example.invalid',private.ticket_email_fingerprint('{rid}@example.invalid'),'{state}','{{\"version\":1,\"keyId\":\"local\",\"nonce\":\"AAAAAAAAAAAAAAAA\",\"ciphertext\":\"AAAAAAAAAAAAAAAAAAAAAA\"}}',{first},{count},'{lid}',clock_timestamp()+interval '21 seconds',clock_timestamp()-interval '1 day');")
        return rid,lid
    failures=[]
    def check(ok,label):
        print(('PASS ' if ok else 'FAIL ')+label)
        if not ok:failures.append(label)
    cap="select pg_advisory_xact_lock(hashtextextended('organizer-message-capacity',0))"
    rid,lid=recipient()
    before=sql("select count(*) from private.organizer_message_rate_events where lane='dispatch';").strip()
    result=locked_call(cap,f"select coalesce(public.server_begin_organizer_message_dispatch('{rid}','{lid}')::text,'null');")
    check(result=='null','begin rejects lease whose 20-second headroom elapsed while waiting for capacity')
    check(sql(f"select dispatch_count from private.organizer_message_recipients where id='{rid}';").strip()=='0','expired headroom does not record dispatch')
    check(sql("select count(*) from private.organizer_message_rate_events where lane='dispatch';").strip()==before,'expired headroom does not debit capacity')
    sql(f"update private.organizer_message_recipients set lease_until=null,dispatch_stopped_reason='fixture' where id='{rid}';")
    rid,lid=recipient('unknown',"clock_timestamp()-interval '23 hours'+interval '1 second'",1)
    sql(f"update private.organizer_message_recipients set lease_until=clock_timestamp()+interval '1 minute' where id='{rid}';")
    result=locked_call(f"select id from private.organizer_message_recipients where id='{rid}' for update",f"select coalesce(public.server_begin_organizer_message_dispatch('{rid}','{lid}')::text,'null');")
    check(result=='null','begin rejects retry window elapsed while waiting for recipient row')
    check(sql(f"select dispatch_count from private.organizer_message_recipients where id='{rid}';").strip()=='1','elapsed retry boundary does not increment dispatch')
    sql(f"update private.organizer_message_recipients set lease_until=null,dispatch_stopped_reason='fixture' where id='{rid}';")
    rid,lid=recipient('sending',"clock_timestamp()-interval '1 minute'",1)
    sql(f"update private.organizer_message_recipients set lease_until=clock_timestamp()+interval '1 second' where id='{rid}';")
    result=locked_call(f"select id from private.organizer_message_recipients where id='{rid}' for update",f"select public.server_finish_organizer_message_dispatch('{rid}','{lid}','accepted','provider-lock-proof');")
    check(result=='f','finish rejects lease that expired waiting for recipient row')
    check(sql(f"select state from private.organizer_message_recipients where id='{rid}';").strip()=='sending','expired finish cannot manufacture acceptance')
    sql(f"update private.organizer_message_recipients set lease_until=null,dispatch_stopped_reason='fixture' where id='{rid}';")
    rid,lid=recipient()
    sql(f"update private.organizer_message_recipients set lease_until=null where id='{rid}';")
    # Rollback-only isolation from earlier persistent concurrency fixtures. No
    # existing delivery outcome or receipt is permanently changed by this check.
    operation=f"begin;update private.organizer_message_recipients set lease_until=null,dispatch_stopped_reason='fixture-isolation' where id<>'{rid}';update private.ticket_email_outbox set dispatch_stopped_reason='fixture-isolation';select coalesce(public.server_claim_organizer_message_recipient()::text,'null');select jsonb_build_object('fresh',lease_until>clock_timestamp()+interval '119 seconds') from private.organizer_message_recipients where id='{rid}';rollback;"
    result=locked_call(cap,operation)
    results=[json.loads(line) for line in result.splitlines() if line.startswith('{') or line=='null']
    claim,fresh=results
    check(claim is not None and claim['attemptId']==rid,'claim after capacity contention still selects eligible oldest recipient')
    check(fresh['fresh'],'claim creates full fresh lease after lock acquisition')
    assert not failures,failures

if __name__=='__main__':
    try:main()
    finally:sql("select public.server_configure_organizer_messages('{\"acceptingSends\":false,\"workerEnabled\":false}');")
