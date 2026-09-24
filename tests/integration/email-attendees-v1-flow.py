#!/usr/bin/env python3
"""Real local owner API → DB → worker → injected transport → signed webhook proof."""
import importlib.util,json,pathlib,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('proof',ROOT/'tests/integration/email-attendees-v1-concurrency.py')
proof=importlib.util.module_from_spec(spec);spec.loader.exec_module(proof)
subprocess.run(['python3',str(ROOT/'tests/integration/email-attendees-v1-fixture.py')]+(['--bulk'] if '--bulk' in sys.argv else []),cwd=ROOT,check=True)
counts="select jsonb_build_object('tickets',(select count(*) from public.tickets),'grants',(select count(*) from private.ticket_email_grants),'members',(select count(*) from private.ticket_email_members),'ticket_outbox',(select count(*) from private.ticket_email_outbox));"
before=proof.sql(counts)
try:
    subprocess.run(['pnpm','dlx','deno','run','--allow-env','--allow-read=.superpowers/email-proof/browser.json','--allow-net=127.0.0.1:61321','tests/integration/edge/email-attendees/local.ts']+(['--bulk'] if '--bulk' in sys.argv else []),cwd=ROOT,check=True,timeout=900)
    assert proof.sql(counts)==before,'Messaging changed ticket/grant/member/outbox counts'
    print('PASS real flow creates no tickets, grants, ticket members or ticket outbox entries')
finally:
    proof.sql("select public.server_configure_organizer_messages('{\"acceptingSends\":false,\"workerEnabled\":false}');")
