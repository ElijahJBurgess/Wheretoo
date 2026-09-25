#!/usr/bin/env python3
"""Existing local email contracts for a normally published imported event. Entire proof rolls back."""
import importlib.util,json,uuid,hashlib
from pathlib import Path
spec=importlib.util.spec_from_file_location('p',Path(__file__).with_name('event-import-proof.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
event=json.loads((p.EVIDENCE/'supplement.json').read_text())['event'];s=p.Session();p.sql=s.sql;s.sql('begin;')
try:
 s.sql('update private.ticket_email_settings set enabled_at=now()-interval \'1 minute\',worker_enabled=true,limits=\'{"access_ip":[{"seconds":60,"max":600}],"verified_grant":[{"seconds":60,"max":60}],"invalid_access_ip":[{"seconds":60,"max":60}],"recovery_recipient":[{"seconds":60,"max":3}],"recovery_ip":[{"seconds":60,"max":10}]}\'::jsonb;')
 request=str(uuid.uuid4());proof=hashlib.sha256(request.encode()).hexdigest();email=request+'@example.invalid';credential=hashlib.sha256((request+'ticket').encode()).hexdigest();manifest=[dict(unit_sequence=1,credential_hash=credential)]
 q=f"select public.server_confirm_free_registration('{request}','{event}','Email Guest','{email}',1,'{proof}',{p.j(manifest)});";receipt=p.value(q);assert receipt['kind']=='confirmed';assert p.value(q)==receipt
 assert s.sql(f"select count(*) from private.ticket_email_outbox where registration_id in (select id from public.free_registrations where request_id='{request}');")=='1'
 claim=p.value('select public.server_claim_ticket_email();');context=p.value(f"select public.server_prepare_ticket_email_context('{claim['id']}','{claim['lease_id']}');");assert context['kind']=='ready',context
 envelope=dict(version=1,keyId='local',nonce='AAAAAAAAAAAAAAAA',ciphertext='AAAAAAAAAAAAAAAAAAAAAA');access=hashlib.sha256((request+'access').encode()).hexdigest()
 assert s.sql(f"select public.server_save_ticket_email_payload('{claim['id']}','{claim['lease_id']}','{access}',{p.j(envelope)});")=='t'
 member=p.value(f"select public.server_read_ticket_email_access('{access}',repeat('a',64),0,1);");assert member['sourceKind']=='free_registration'
 # Resolve the local initial claim without a network dispatch, then exercise ordinary anonymous recovery.
 s.sql(f"select public.server_begin_ticket_email_dispatch('{claim['id']}','{claim['lease_id']}');select public.server_finish_ticket_email_dispatch('{claim['id']}','{claim['lease_id']}','accepted','synthetic-provider');")
 recovery=str(uuid.uuid4());s.sql(f"select public.server_request_ticket_recovery('{recovery}',repeat('b',64),repeat('c',64),{p.j(envelope)});")
 recover=p.value('select public.server_claim_ticket_email();');ctx=p.value(f"select public.server_prepare_ticket_email_context('{recover['id']}','{recover['lease_id']}','{email}');");assert len(ctx['sources'])==1,ctx
 assert s.sql(f"select count(*) from public.tickets where event_id='{event}' and credential_hash=decode('{credential}','hex');")=='1'
 result={'initialOutboxOnce':True,'ordinaryEmailAccess':True,'recoverySources':1,'newTicketsFromEmail':0,'providerCalls':0,'rolledBack':True};(p.EVIDENCE/'email.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
finally:s.sql('rollback;');s.close()
