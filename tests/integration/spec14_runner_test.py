"""Wrong identity/ports/cron must prevent a task runner from accepting a DB."""
import copy
import importlib.util
import pathlib
import unittest
import json
import tempfile
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('runner', pathlib.Path(__file__).with_name('spec14-local.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class OwnershipTests(unittest.TestCase):
    def setUp(self):
        self.known = {'id': 'abc123', 'name': 'wheretoo-spec14-db', 'image': 'sha256:image', 'port': 55645, 'internalPort': '5432/tcp'}
        self.live = {
            'Id': 'abc123', 'Name': '/wheretoo-spec14-db', 'Image': 'sha256:image',
            'Config': {'Labels': {'wheretoo.task': 'spec14-final-assembly'}, 'Cmd': ['-c', 'cron.launch_active_jobs=off']},
            'NetworkSettings': {'Ports': {'5432/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '55645'}]}},
        }

    def test_accepts_recorded_local_database(self):
        runner.verify_container(self.live, self.known, database=True)

    def test_rejects_replaced_or_unowned_database(self):
        for key, value in [('Id', 'replacement'), ('Name', '/other-spec-db'), ('Image', 'sha256:other')]:
            live = copy.deepcopy(self.live)
            live[key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                runner.verify_container(live, self.known, database=True)
        live = copy.deepcopy(self.live)
        live['Config']['Labels'] = {}
        with self.assertRaises(RuntimeError):
            runner.verify_container(live, self.known, database=True)

    def test_rejects_shared_or_moved_port(self):
        for host, port in [('0.0.0.0', '55645'), ('127.0.0.1', '54322')]:
            live = copy.deepcopy(self.live)
            live['NetworkSettings']['Ports']['5432/tcp'] = [{'HostIp': host, 'HostPort': port}]
            with self.subTest(host=host, port=port), self.assertRaises(RuntimeError):
                runner.verify_container(live, self.known, database=True)

    def test_rejects_active_cron_before_database_access(self):
        live = copy.deepcopy(self.live)
        live['Config']['Cmd'] = ['-c', 'cron.launch_active_jobs=on']
        with self.assertRaises(RuntimeError):
            runner.verify_container(live, self.known, database=True)

    def test_internal_backend_requires_no_host_exposure(self):
        known = {**self.known, 'internalOnly': True}
        live = copy.deepcopy(self.live)
        live['NetworkSettings']['Ports']['5432/tcp'] = []
        runner.verify_container(live, known, database=True)
        live['NetworkSettings']['Ports']['5432/tcp'] = [{'HostIp': '0.0.0.0', 'HostPort': '55645'}]
        with self.assertRaises(RuntimeError):
            runner.verify_container(live, known, database=True)


class ProcessRegistryTests(unittest.TestCase):
    def exact_processes(self):
        return {
            'instanceId': 'instance',
            'processes': [
                {'name': 'bridge', 'pid': 101, 'command': 'python bridge.py'},
                {'name': 'edge', 'pid': 102, 'command': 'deno gateway.ts'},
                {'name': 'app', 'pid': 103, 'command': 'python app.py'},
            ],
        }

    def test_running_guard_accepts_only_exact_live_process_commands(self):
        processes = self.exact_processes()
        commands = {row['pid']: row['command'] for row in processes['processes']}
        self.assertEqual(
            runner.verify_process_registry({'instanceId': 'instance'}, processes, commands.get),
            ['app', 'bridge', 'edge'],
        )

    def test_running_guard_rejects_stale_or_reused_pid(self):
        processes = self.exact_processes()
        commands = {row['pid']: row['command'] for row in processes['processes']}
        commands[102] = 'unrelated reused pid'
        with self.assertRaisesRegex(RuntimeError, 'stopped or replaced'):
            runner.verify_process_registry({'instanceId': 'instance'}, processes, commands.get)

    def test_running_guard_rejects_wrong_names_or_instance(self):
        processes = self.exact_processes()
        commands = {row['pid']: row['command'] for row in processes['processes']}
        for changed in [
            {**processes, 'instanceId': 'other-instance'},
            {**processes, 'processes': [{**row, 'name': 'gateway' if row['name'] == 'edge' else row['name']} for row in processes['processes']]},
        ]:
            with self.subTest(changed=changed), self.assertRaises(RuntimeError):
                runner.verify_process_registry({'instanceId': 'instance'}, changed, commands.get)

    def test_running_guard_rejects_stale_served_build_identity(self):
        record = {'task': runner.TASK, 'root': str(runner.ROOT), 'instanceId': 'instance'}
        build = {
            'sourceSha256': 'a' * 64,
            'assetsSha256': 'b' * 64,
            'files': {'index.html': {'kind': 'file', 'sha256': 'c' * 64}},
        }
        served = {
            'task': runner.TASK,
            'instanceId': 'instance',
            'application': runner.ORIGIN,
            'sourceSha256': build['sourceSha256'],
            'assetsSha256': build['assetsSha256'],
            'indexSha256': build['files']['index.html']['sha256'],
            'providers': 'local simulation only',
        }
        self.assertEqual(runner.verify_served_identity(record, build, served)['task'], runner.TASK)
        for key, value in [('task', 'another-task'), ('instanceId', 'stale'), ('sourceSha256', 'd' * 64), ('assetsSha256', 'e' * 64)]:
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, 'identity'):
                runner.verify_served_identity(record, build, {**served, key: value})

    def test_incomplete_start_never_claims_all_servers_running(self):
        for names in [[], ['bridge'], ['bridge', 'edge'], ['bridge', 'bridge', 'app']]:
            with tempfile.TemporaryDirectory() as directory:
                state = pathlib.Path(directory)
                (state / 'processes.json').write_text(json.dumps({'instanceId': 'instance', 'processes': [{'name': name, 'pid': 1, 'command': 'owned'} for name in names]}))
                with self.subTest(names=names), patch.object(runner, 'STATE', state), patch.object(runner, 'verify'), patch.object(runner, 'identity', return_value={'instanceId': 'instance'}), patch.object(runner, 'process_command', return_value='owned'):
                    with self.assertRaises(RuntimeError):
                        runner.start()

    def test_private_logs_are_private_before_payload_write(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'error.log'
            path.write_text('old')
            path.chmod(0o644)
            with runner.private_open(path, 'w') as stream:
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                stream.write('synthetic-private-proof')
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_runner_errors_are_action_specific_timestamped_and_preserve_prior_detail(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(runner, 'STATE', pathlib.Path(directory)), \
                patch.object(runner.time, 'time_ns', side_effect=[101, 102]):
            first = runner.record_runner_error('start', OSError('first private bind detail'))
            second = runner.record_runner_error('../unsafe', RuntimeError('second private detail'))

            self.assertEqual(first.name, 'runner-error-101-start.log')
            self.assertEqual(second.name, 'runner-error-102-unknown.log')
            self.assertIn('first private bind detail', first.read_text())
            self.assertIn('second private detail', second.read_text())
            self.assertEqual(first.stat().st_mode & 0o777, 0o600)
            self.assertEqual(second.stat().st_mode & 0o777, 0o600)
            latest = (pathlib.Path(directory) / 'last-runner-error.log').read_text()
            self.assertIn(second.name, latest)
            self.assertNotIn('first private bind detail', latest)

    def test_stop_keeps_registry_if_a_task_child_still_listens(self):
        with tempfile.TemporaryDirectory() as directory:
            state = pathlib.Path(directory)
            registry = state / 'processes.json'
            registry.write_text(json.dumps({'instanceId': 'instance', 'processes': [{'name': 'edge', 'pid': 1, 'command': 'owned'}]}))
            with patch.object(runner, 'STATE', state), patch.object(runner, 'identity', return_value={'instanceId': 'instance'}), patch.object(runner, 'process_command', return_value=None), patch.object(runner.socket.socket, 'connect_ex', return_value=0):
                with self.assertRaises(RuntimeError):
                    runner.stop()
            self.assertTrue(registry.exists())

    def test_atomic_save_makes_parent_private(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'state' / 'identity.json'
            runner.save(path, {'safe': True})
            self.assertEqual(path.parent.stat().st_mode & 0o777, 0o700)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)


if __name__ == '__main__':
    unittest.main()
