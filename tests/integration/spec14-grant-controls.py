#!/usr/bin/env python3
"""Explicit negative grant controls; never writes a source, ticket or payment.

JSON input uses stdin so private access proof never enters command arguments.
Output contains only a private task evidence filename, never a bearer grant.
"""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import secrets
import sys
import uuid

spec = importlib.util.spec_from_file_location('local', Path(__file__).with_name('spec14-local.py'))
local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local)


def token_hash(token):
    local.require(isinstance(token, str) and re.fullmatch(r'em1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]', token), 'Invalid negative-control grant format')
    return hashlib.sha256(('wheretoo:email-access:v1\n' + token).encode()).hexdigest()


def execute(request):
    local.require(isinstance(request, dict), 'Expected explicit negative grant control')
    action = request.get('action')
    expected = {'action', 'alias'} if action == 'expired' else {'action', 'alias', 'token'}
    local.require(action in {'expired', 'revoke'} and set(request) == expected, 'Unsupported negative grant control')
    alias = request['alias']
    local.require(isinstance(alias, str) and re.fullmatch(r'j04-[a-z0-9-]{1,48}', alias), 'Control alias must be a bounded J04 negative fixture')
    path = local.STATE / 'negative-grants' / (alias + '.json')
    identity = local.identity()
    if action == 'expired':
        if path.exists():
            record = json.loads(path.read_text())
            local.require(record['instanceId'] == identity['instanceId'] and record['action'] == action, 'Existing control belongs to another task/action')
        else:
            token = 'em1_' + base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip('=')
            record = {'instanceId': identity['instanceId'], 'action': action, 'grantId': str(uuid.uuid4()), 'token': token, 'tokenHash': token_hash(token), 'status': 'prepared'}
            local.save(path, record)
        grant_id = str(uuid.UUID(record['grantId']))
        hashed = token_hash(record['token'])
        # Deliberate negative metadata only: no members, outbox, source or
        # ticket fixtures. Existing grant expiration is immutable and untouched.
        statement = "begin; insert into private.ticket_email_grants(id,token_hash,purpose,prepared_at,expires_at,scheduled_end_at) values ('" + grant_id + "','" + hashed + "','recovery',clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day',null) on conflict(id) do nothing; select (count(*)=1)::text from private.ticket_email_grants where id='" + grant_id + "' and token_hash='" + hashed + "' and purpose='recovery' and expires_at<clock_timestamp(); commit;"
        result = local.sql(statement, tuples=True)
        local.require('true' in result.splitlines(), 'Expired negative grant did not match its original identity')
        record['status'] = 'verified-expired'
    else:
        hashed = token_hash(request['token'])
        prior = None
        if path.exists():
            prior = json.loads(path.read_text())
            local.require(
                set(prior) == {'instanceId', 'action', 'grantId', 'tokenHash', 'status'}
                and prior['instanceId'] == identity['instanceId']
                and prior['action'] == action
                and prior['tokenHash'] == hashed
                and prior['status'] in {'prepared', 'verified-revoked'},
                'Refusing replacement revocation identity',
            )
        result = local.sql(
            "select coalesce(json_agg(json_build_object('id',g.id,'purpose',g.purpose,"
            "'unexpired',g.expires_at>clock_timestamp(),'unrevoked',g.revoked_at is null,"
            "'recoveryOutboxCount',(select count(*) from private.ticket_email_outbox q where q.grant_id=g.id and q.purpose='recovery'),"
            "'memberCount',(select count(*) from private.ticket_email_members m where m.grant_id=g.id))),'[]'::json) "
            "from private.ticket_email_grants g where g.token_hash='" + hashed + "';",
            tuples=True,
        )
        ledger = json.loads(result)
        local.require(len(ledger) == 1, 'Revoke requires one existing recovery grant created by the real flow')
        grant = ledger[0]
        local.require(
            isinstance(grant, dict)
            and set(grant) == {'id', 'purpose', 'unexpired', 'unrevoked', 'recoveryOutboxCount', 'memberCount'}
            and grant['purpose'] == 'recovery'
            and isinstance(grant['recoveryOutboxCount'], int) and not isinstance(grant['recoveryOutboxCount'], bool)
            and grant['recoveryOutboxCount'] == 1
            and isinstance(grant['memberCount'], int) and not isinstance(grant['memberCount'], bool)
            and grant['memberCount'] >= 1
            and isinstance(grant['unexpired'], bool)
            and isinstance(grant['unrevoked'], bool),
            'Revoke requires one existing recovery grant created by the real flow',
        )
        grant_id = str(uuid.UUID(grant['id']))
        if prior is not None:
            local.require(prior['grantId'] == grant_id, 'Refusing replacement revocation identity')
            if not grant['unrevoked']:
                record = {**prior, 'status': 'verified-revoked'}
                local.save(path, record)
                return {'evidence': str(path.relative_to(local.ROOT)), 'status': record['status']}
            local.require(prior['status'] == 'prepared', 'Previously verified revocation is no longer present')
        else:
            local.require(grant['unexpired'] and grant['unrevoked'], 'First revoke requires a live recovery grant created by the real flow')
        record = {'instanceId': identity['instanceId'], 'action': action, 'grantId': grant_id, 'tokenHash': hashed, 'status': 'prepared'}
        local.save(path, record)
        local.sql("select public.server_revoke_ticket_email_grant('" + grant_id + "'::uuid);")
        verified = local.sql("select (revoked_at is not null)::text from private.ticket_email_grants where id='" + grant_id + "';", tuples=True).strip()
        local.require(verified == 'true', 'Canonical grant revocation was not observed')
        record['status'] = 'verified-revoked'
    local.save(path, record)
    return {'evidence': str(path.relative_to(local.ROOT)), 'status': record['status']}


if __name__ == '__main__':
    try:
        raw = sys.stdin.read(4097)
        local.require(len(raw) <= 4096, 'Negative control input too large')
        print(json.dumps(execute(json.loads(raw))))
    except Exception:
        print('Negative grant control stopped; original identities retained.', file=sys.stderr)
        sys.exit(1)
