#!/usr/bin/env python3
"""Focused local regression proof for review findings, ownership and ordinary RSVP."""
import importlib.util,json,uuid,hashlib
from pathlib import Path
spec=importlib.util.spec_from_file_location('p',Path(__file__).with_name('event-import-proof.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
f=json.loads((p.ROOT/'.superpowers/event-import-proof/browser.json').read_text());a=f['actors'];admin=a['admin'];s=p.Session();p.sql=s.sql
salt=uuid.uuid4().hex
# Later same-batch row verifies/imports first. Earlier row must see its resulting event.
b=p.upload(admin,[p.row(0,salt),p.row(1,salt)]);first=p.verify(admin,b,dict(kind='retryable',code='PROVIDER_UNAVAILABLE',retryAfterSeconds=3600));later=p.verify(admin,b);p.select(admin,b,[later]);e=p.imported(admin,b,later)['eventId'];p.sql(f"update private.event_import_rows set next_attempt_at=now() where id='{first}';");p.verify(admin,b);r=p.rows(b)[0];assert r['state']=='duplicate_possible' and r['duplicate_count']==1
# Candidate edits invalidate old approval and persist new review evidence, avoiding rollback loops.
p.sql(f"update public.events set description='A changed event description for re-review.' where id='{e}';")
assert p.sql(f"select public.server_resolve_event_import_row('{admin}','{b}','{first}','override_duplicate','{r['duplicate_digest']}');")=='f'
r2=p.rows(b)[0];assert r2['duplicate_digest']!=r['duplicate_digest'];assert p.sql(f"select public.server_resolve_event_import_row('{admin}','{b}','{first}','override_duplicate','{r2['duplicate_digest']}');")=='t'
p.select(admin,b,[first]);assert p.imported(admin,b,first)['kind']=='imported'
# Authenticated normal owner flow: foreign admin cannot publish or edit. Owner supplies synthetic explicit disclosures.
b=p.upload(admin,[p.row(0,salt+' RSVP')]);rid=p.verify(admin,b);p.select(admin,b,[rid]);event=p.imported(admin,b,rid)['eventId']
def as_actor(actor,statement):return p.sql(f"begin;select set_config('request.jwt.claim.sub','{actor}',true);set local role authenticated;{statement};commit;")
# Use transaction-local pgTAP throws to keep connection alive after expected denial.
p.sql('create extension if not exists pgtap with schema extensions;set search_path=public,extensions;select extensions.no_plan();')
result=as_actor(admin,f"select extensions.throws_ok($$select public.publish_event('{event}')$$)");assert 'not ok' not in result,result
p.sql("select private.configure_policy_environment('development');")
requirements=dict(minimum_age='all_ages',alcohol_present=False,cannabis_present=False,explicit_adult_content=False,gambling_present=False,weapons_present=False,high_risk_activity=False)
as_actor(a['owner'],f"select public.save_owned_event_requirements('{event}',{p.j(requirements)});select public.accept_current_event_policies('{event}');select public.publish_event('{event}')")
assert p.sql(f"select status from public.events where id='{event}';")=='published'
public=p.value(f"select public.get_public_free_rsvp('{event}');");assert public['availability']['remaining'] is None;assert 'source_url' not in json.dumps(public) and 'PRIVATE_PROVENANCE' not in json.dumps(public)
req=str(uuid.uuid4());proof=hashlib.sha256(req.encode()).hexdigest();manifest=[dict(unit_sequence=n,credential_hash=hashlib.sha256((req+str(n)).encode()).hexdigest()) for n in range(1,3)]
q=f"select public.server_confirm_free_registration('{req}','{event}','Pat Guest','synthetic@example.invalid',2,'{proof}',{p.j(manifest)});";receipt=p.value(q);assert receipt['kind']=='confirmed',receipt;assert p.value(q)==receipt
collection=p.value(f"select public.server_lookup_free_ticket_collection('{proof}');");assert len(collection['tickets'])==2
for expected in ['admitted','already_used']:
 assert p.sql(f"select outcome from public.server_redeem_organizer_ticket('{a['owner']}','{event}',decode('{manifest[0]['credential_hash']}','hex'));")==expected
assert p.sql(f"select count(*) from public.tickets where event_id='{event}';")=='2'
# Existing email ledger is created by ordinary RSVP, never the import path. No provider send is enabled.
email=p.sql(f"select count(*) from private.ticket_email_outbox where registration_id in (select id from public.free_registrations where event_id='{event}');")
result=dict(reverseCompletionDuplicate=True,candidateEditInvalidates=True,ownerPublish=True,foreignPublishDenied=True,unlimitedRsvp=True,issuedTickets=2,registrationReplay=True,checkInDuplicateRejected=True,ordinaryEmailOutbox=int(email),event=event)
(p.EVIDENCE/'supplement.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));s.close()
