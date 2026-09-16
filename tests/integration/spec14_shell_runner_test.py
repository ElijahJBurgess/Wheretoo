"""The inherited admission shell suites must reach only the verified task DB."""
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch


PATH = Path(__file__).with_name('spec14-shell-regressions.py')
spec = importlib.util.spec_from_file_location('shell_runner', PATH)
shell_runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shell_runner)


class RecordingDestination(io.BytesIO):
    def __init__(self):
        super().__init__()
        self.flushes = 0

    def flush(self):
        self.flushes += 1
        super().flush()


class ShellTransportTests(unittest.TestCase):
    def test_pinned_original_and_include_hashes_match(self):
        shell_runner.check_invoked_sources()

    def test_hash_check_refuses_changed_source(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'source.sh'
            path.write_text('changed')
            with self.assertRaises(RuntimeError):
                shell_runner.verify_hash(path, '0' * 64)

    def test_parser_accepts_only_fixed_sentinel_and_inherited_psql_grammar(self):
        arguments = [shell_runner.SENTINEL, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'prior_switch=t', '-c', 'select 1']
        self.assertEqual(shell_runner.parse_psql(arguments), arguments[1:])
        for invalid in [
            ['postgresql://example.invalid/db', '-X'],
            [shell_runner.SENTINEL, '-h', 'elsewhere'],
            [shell_runner.SENTINEL, '-f', '/tmp/source.sql'],
            [shell_runner.SENTINEL, 'another-database'],
        ]:
            with self.subTest(arguments=invalid), self.assertRaises(RuntimeError):
                shell_runner.parse_psql(invalid)

    def test_command_sql_receives_same_connection_identity_guard_first(self):
        arguments = shell_runner.parse_psql([shell_runner.SENTINEL, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', 'select 42'])
        guarded = shell_runner.guard_command(arguments, 'd986d000-0000-4000-8000-000000000001')
        sql = guarded[guarded.index('-c') + 1]
        self.assertLess(sql.index('spec14_control.identity'), sql.index('select 42'))
        self.assertIn("cron.launch_active_jobs", sql)

    def test_streaming_input_flushes_guard_and_each_fifo_line(self):
        destination = RecordingDestination()
        source = iter([b'begin;\n', b"select 'barrier-ready';\n", b'commit;\n'])
        shell_runner.forward_input(source, destination, 'd986d000-0000-4000-8000-000000000001')
        content = destination.getvalue()
        self.assertTrue(content.startswith(b'do $spec14_transport$'))
        self.assertIn(b"select 'barrier-ready';", content)
        self.assertEqual(destination.flushes, 4)

    def test_real_fifo_line_reaches_psql_stream_before_writer_closes(self):
        with tempfile.TemporaryDirectory() as directory:
            fifo = Path(directory) / 'gate'
            os.mkfifo(fifo)
            destination = RecordingDestination()
            observed = threading.Event()

            class ObservedDestination:
                def write(self, value):
                    destination.write(value)
                    if b'barrier-ready' in value:
                        observed.set()

                def flush(self):
                    destination.flush()

            def consume():
                with open(fifo, 'rb') as source:
                    shell_runner.forward_input(source, ObservedDestination(), 'd986d000-0000-4000-8000-000000000001')

            worker = threading.Thread(target=consume)
            worker.start()
            with open(fifo, 'wb') as gate:
                gate.write(b"select 'barrier-ready';\n")
                gate.flush()
                self.assertTrue(observed.wait(1), 'FIFO input was buffered until close')
                gate.write(b'commit;\n')
            worker.join(1)
            self.assertFalse(worker.is_alive())

    def test_host_include_is_hash_checked_and_expanded_for_container_psql(self):
        setup = shell_runner.ROOT / 'supabase/tests/database/helpers/core_ticket_truth_lite_setup.inc'
        destination = RecordingDestination()
        shell_runner.forward_input(iter([(f"\\i '{setup}'\n").encode()]), destination, 'd986d000-0000-4000-8000-000000000001')
        content = destination.getvalue()
        self.assertNotIn(b'\\i ', content)
        self.assertNotIn(b'\\ir ', content)
        self.assertIn(b'create function pg_temp.ticket_manifest', content)

    def test_transport_verifies_before_fixed_docker_launch_and_forwards_app_name(self):
        events = []

        class Local:
            @staticmethod
            def verify():
                events.append('verify')
                return 'recorded-db'

            @staticmethod
            def identity():
                events.append('identity')
                return {'instanceId': 'd986d000-0000-4000-8000-000000000001', 'containers': {'db': {'id': 'recorded-db'}}}

        def launch(command, arguments, instance_id):
            events.append(('launch', command, arguments, instance_id))
            return 19

        environment = {
            'SPEC14_SHELL_TRANSPORT_ROOT': str(shell_runner.ROOT),
            'WHERETO_TICKETING_DB_URL': shell_runner.SENTINEL,
            'PGAPPNAME': 'lite_scan_123_a',
            'PGOPTIONS': '-c statement_timeout=20000',
            'PGCONNECT_TIMEOUT': '5',
        }
        with patch.object(shell_runner, 'check_invoked_sources', side_effect=lambda: events.append('hash')):
            result = shell_runner.psql_transport(
                [shell_runner.SENTINEL, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', 'select 1'],
                environment=environment,
                local_module=Local,
                launch=launch,
            )
        self.assertEqual(result, 19)
        self.assertEqual(events[:3], ['hash', 'verify', 'identity'])
        command = events[3][1]
        self.assertEqual(command[:3], ['docker', 'exec', '-i'])
        self.assertIn('PGAPPNAME=lite_scan_123_a', command)
        self.assertEqual(command[-6:-3], ['recorded-db', 'psql', '-U'])
        self.assertNotIn(shell_runner.SENTINEL, command)

    def test_private_shim_exists_before_content_write(self):
        with tempfile.TemporaryDirectory() as directory:
            mode_seen = []

            class Local:
                @staticmethod
                def private_open(path, mode='w'):
                    stream = open(path, mode)
                    os.chmod(path, 0o600)
                    mode_seen.append(path.stat().st_mode & 0o777)
                    return stream

            path = shell_runner.write_shim(Path(directory), local_module=Local)
            self.assertEqual(mode_seen, [0o600])
            self.assertEqual(path.stat().st_mode & 0o777, 0o700)

    def test_child_environment_does_not_inherit_provider_or_database_configuration(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            'PATH': '/usr/bin', 'HOME': directory, 'STRIPE_SECRET_KEY': 'private',
            'SUPABASE_SERVICE_ROLE_KEY': 'private', 'PGHOST': 'elsewhere',
            'DATABASE_URL': 'postgresql://elsewhere/private', 'BASH_ENV': '/tmp/untrusted',
        }, clear=True):
            environment = shell_runner.task_environment(Path(directory) / 'psql')
        self.assertEqual(environment['WHERETO_TICKETING_DB_URL'], shell_runner.SENTINEL)
        self.assertEqual(environment['PATH'].split(os.pathsep)[0], directory)
        for name in ('STRIPE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'PGHOST', 'DATABASE_URL', 'BASH_ENV'):
            self.assertNotIn(name, environment)

    def test_private_deadline_adapter_changes_only_two_transport_poll_budgets(self):
        with tempfile.TemporaryDirectory(dir=shell_runner.STATE) as directory, patch.object(shell_runner, 'STATE', Path(directory)):
            class Local:
                @staticmethod
                def private_open(path, mode='w'):
                    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    stream = open(path, mode)
                    os.chmod(path, 0o600)
                    return stream

                @staticmethod
                def save(path, value):
                    with Local.private_open(path) as stream:
                        json.dump(value, stream)

            adapted = shell_runner.adapt_concurrency_deadlines(Local)
            original = (shell_runner.ROOT / 'supabase/tests/database/core_ticket_truth_lite_redemption_concurrency.test.sh').read_text()
            expected = original.replace('attempt<100', 'attempt<400', 1).replace('attempt<80', 'attempt<400', 1)
            self.assertEqual(adapted.read_text(), expected)
            self.assertEqual(adapted.stat().st_mode & 0o777, 0o700)
            helpers = adapted.parent / 'helpers'
            self.assertTrue(helpers.is_symlink())
            self.assertEqual(helpers.resolve(), shell_runner.ROOT / 'supabase/tests/database/helpers')
            evidence = json.loads((Path(directory) / 'shell-transport/deadline-adaptation.json').read_text())
            self.assertEqual(evidence['changes'], {'gatePollAttempts': [100, 400], 'workerPollAttempts': [80, 400]})


if __name__ == '__main__':
    unittest.main()
