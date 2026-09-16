import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('grants', Path(__file__).with_name('spec14-grant-controls.py'))
grants = importlib.util.module_from_spec(spec)
spec.loader.exec_module(grants)


class GrantControls(unittest.TestCase):
    token = 'em1_' + 'A' * 43
    grant_id = '10000000-0000-4000-8000-000000000001'

    def recovery_ledger(self, *, revoked=False, unexpired=True, outboxes=1, members=1, grant_id=None):
        return json.dumps([{
            'id': grant_id or self.grant_id,
            'purpose': 'recovery',
            'unexpired': unexpired,
            'unrevoked': not revoked,
            'recoveryOutboxCount': outboxes,
            'memberCount': members,
        }])

    def test_malformed_control_never_touches_task_database(self):
        for request in [{}, {'action': 'expire-principal', 'alias': 'j04-a'}, {'action': 'expired', 'alias': '../main'}, {'action': 'expired', 'alias': 'j04-a', 'extra': True}]:
            with self.subTest(request=request), patch.object(grants.local, 'identity') as identity, patch.object(grants.local, 'sql') as sql:
                with self.assertRaises(RuntimeError): grants.execute(request)
                identity.assert_not_called()
                sql.assert_not_called()

    def test_hash_matches_production_email_access_domain(self):
        self.assertEqual(grants.token_hash(self.token), hashlib.sha256(('wheretoo:email-access:v1\n' + self.token).encode()).hexdigest())
        for invalid in ['wh_test_anything', 'em1_' + 'A' * 42 + 'B', "em1_';select 1"]:
            with self.assertRaises(RuntimeError): grants.token_hash(invalid)

    def test_first_revoke_requires_one_real_unexpired_recovery_outbox_and_member(self):
        for ledger in [
            self.recovery_ledger(outboxes=0),
            self.recovery_ledger(outboxes=2),
            self.recovery_ledger(members=0),
            self.recovery_ledger(revoked=True),
            self.recovery_ledger(unexpired=False),
        ]:
            with self.subTest(ledger=ledger), tempfile.TemporaryDirectory(dir=grants.local.STATE) as state, \
                 patch.object(grants.local, 'STATE', Path(state)), \
                 patch.object(grants.local, 'identity', return_value={'instanceId': 'task-instance'}), \
                 patch.object(grants.local, 'sql', return_value=ledger) as sql:
                with self.assertRaises(RuntimeError):
                    grants.execute({'action': 'revoke', 'alias': 'j04-real-recovery', 'token': self.token})
                self.assertEqual(sql.call_count, 1)
                self.assertFalse((Path(state) / 'negative-grants' / 'j04-real-recovery.json').exists())

    def test_first_revoke_records_identity_then_uses_canonical_revoker(self):
        with tempfile.TemporaryDirectory(dir=grants.local.STATE) as state, \
             patch.object(grants.local, 'STATE', Path(state)), \
             patch.object(grants.local, 'identity', return_value={'instanceId': 'task-instance'}), \
             patch.object(grants.local, 'sql', side_effect=[self.recovery_ledger(), '', 'true']) as sql:
            result = grants.execute({'action': 'revoke', 'alias': 'j04-real-recovery', 'token': self.token})

            self.assertEqual(result['status'], 'verified-revoked')
            self.assertIn("server_revoke_ticket_email_grant('" + self.grant_id + "'::uuid)", sql.call_args_list[1].args[0])
            record = json.loads((Path(state) / 'negative-grants' / 'j04-real-recovery.json').read_text())
            self.assertEqual(record, {
                'instanceId': 'task-instance',
                'action': 'revoke',
                'grantId': self.grant_id,
                'tokenHash': grants.token_hash(self.token),
                'status': 'verified-revoked',
            })

    def test_retry_reconciles_committed_revocation_for_same_record_without_second_write(self):
        with tempfile.TemporaryDirectory(dir=grants.local.STATE) as state, \
             patch.object(grants.local, 'STATE', Path(state)), \
             patch.object(grants.local, 'identity', return_value={'instanceId': 'task-instance'}), \
             patch.object(grants.local, 'sql', return_value=self.recovery_ledger(revoked=True, unexpired=False)) as sql:
            path = Path(state) / 'negative-grants' / 'j04-real-recovery.json'
            grants.local.save(path, {
                'instanceId': 'task-instance', 'action': 'revoke', 'grantId': self.grant_id,
                'tokenHash': grants.token_hash(self.token), 'status': 'prepared',
            })

            result = grants.execute({'action': 'revoke', 'alias': 'j04-real-recovery', 'token': self.token})

            self.assertEqual(result['status'], 'verified-revoked')
            self.assertEqual(sql.call_count, 1)
            self.assertEqual(json.loads(path.read_text())['status'], 'verified-revoked')

    def test_retry_never_replaces_recorded_token_or_grant_identity(self):
        other_token = 'em1_' + 'Q' * 43
        with tempfile.TemporaryDirectory(dir=grants.local.STATE) as state, \
             patch.object(grants.local, 'STATE', Path(state)), \
             patch.object(grants.local, 'identity', return_value={'instanceId': 'task-instance'}), \
             patch.object(grants.local, 'sql', return_value='[]') as sql:
            path = Path(state) / 'negative-grants' / 'j04-real-recovery.json'
            grants.local.save(path, {
                'instanceId': 'task-instance', 'action': 'revoke', 'grantId': self.grant_id,
                'tokenHash': grants.token_hash(self.token), 'status': 'prepared',
            })
            with self.assertRaises(RuntimeError):
                grants.execute({'action': 'revoke', 'alias': 'j04-real-recovery', 'token': other_token})
            sql.assert_not_called()
            self.assertEqual(json.loads(path.read_text())['tokenHash'], grants.token_hash(self.token))


if __name__ == '__main__': unittest.main()
