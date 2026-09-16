"""Local transport must preserve real requests without opening external routing."""
import base64
import copy
import importlib.util
import io
import json
from pathlib import Path
import queue
import unittest
from unittest.mock import patch


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


bridge = load('spec14-bridge')


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.record = {
            'task': 'spec14-final-assembly',
            'instanceId': '11111111-1111-4111-8111-111111111111',
            'network': {'id': 'network-id', 'name': bridge.local.NETWORK},
            'containers': {
                role: {
                    'id': role + '-id', 'name': 'wheretoo-spec14-' + role,
                    'image': role + '-image', 'internalPort': port,
                    'internalOnly': True,
                }
                for role, port in [('db', '5432/tcp'), ('rest', '3000/tcp')]
            },
        }

    def live(self, role):
        known = self.record['containers'][role]
        return {
            'Id': known['id'], 'Name': '/' + known['name'], 'Image': known['image'],
            'Config': {
                'Labels': {'wheretoo.task': 'spec14-final-assembly'},
                'Cmd': ['-c', 'cron.launch_active_jobs=off'] if role == 'db' else [],
            },
            'NetworkSettings': {
                'Ports': {known['internalPort']: []},
                'Networks': {bridge.local.NETWORK: {'NetworkID': 'network-id'}},
            },
        }

    def transport(self):
        raw = b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}'
        worker = type('Worker', (), {})()
        worker.stdin = io.BytesIO()
        worker.stdout = io.BytesIO(base64.b64encode(raw) + b'\n')
        worker.poll = lambda: None
        value = object.__new__(bridge.Bridge)
        value.db = self.record['containers']['db']['id']
        value.record = copy.deepcopy(self.record)
        value.workers = queue.Queue()
        value.workers.put(worker)
        return value, worker

    def test_fixed_target_and_literal_payload(self):
        value = bridge.curl_config('rest', 'POST', '/rpc/function', {'Authorization': 'Bearer local', 'Host': 'evil.test'}, b'{"value":"$(evil)\\n\\\""}')
        self.assertIn('url = "http://wheretoo-spec14-rest:3000/rpc/function"', value)
        self.assertIn('$(evil)', value)
        self.assertNotIn('evil.test', value)
        self.assertNotIn('location', value)
        self.assertIn('proto = "=http"', value)

    def test_rejects_external_target_and_header_injection(self):
        for path in ['https://evil.test', '//evil.test', '/rpc/x\r\nurl=evil']:
            with self.subTest(path=path), self.assertRaises(RuntimeError):
                bridge.curl_config('rest', 'GET', path, {}, b'')
        with self.assertRaises(RuntimeError):
            bridge.curl_config('rest', 'GET', '/', {'a': 'b\r\nc'}, b'')

    def test_real_chunked_response_decodes(self):
        import http.client
        response = http.client.HTTPResponse(bridge.MemorySocket(b'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n'))
        response.begin()
        self.assertEqual(response.read(), b'hello')

    def test_request_verifies_both_recorded_containers_before_worker_write(self):
        transport, worker = self.transport()
        live = [self.live('db'), self.live('rest')]
        with patch.object(bridge.local, 'identity', return_value=copy.deepcopy(self.record)), patch.object(bridge.local, 'output', return_value=json.dumps(live)) as inspect:
            status, _, content = transport.request('rest', 'POST', '/rpc/read', {}, b'{}')
        self.assertEqual((status, content), (200, b'{}'))
        inspect.assert_called_once_with(['docker', 'inspect', 'db-id', 'rest-id'])
        self.assertNotEqual(worker.stdin.getvalue(), b'')

    def test_request_rejects_every_identity_or_transport_mismatch_before_worker_write(self):
        scenarios = {}
        scenarios['short inspect output'] = [self.live('db')]
        target_id = [self.live('db'), self.live('rest')]
        target_id[1]['Id'] = 'replacement'
        scenarios['target id'] = target_id
        target_name = [self.live('db'), self.live('rest')]
        target_name[1]['Name'] = '/replacement'
        scenarios['target name'] = target_name
        target_image = [self.live('db'), self.live('rest')]
        target_image[1]['Image'] = 'replacement'
        scenarios['target image'] = target_image
        target_label = [self.live('db'), self.live('rest')]
        target_label[1]['Config']['Labels'] = {}
        scenarios['target label'] = target_label
        target_exposed = [self.live('db'), self.live('rest')]
        target_exposed[1]['NetworkSettings']['Ports']['3000/tcp'] = [{'HostIp': '127.0.0.1', 'HostPort': '55646'}]
        scenarios['target exposure'] = target_exposed
        extra_network = [self.live('db'), self.live('rest')]
        extra_network[1]['NetworkSettings']['Networks']['other'] = {'NetworkID': 'other'}
        scenarios['extra network'] = extra_network
        wrong_network = [self.live('db'), self.live('rest')]
        wrong_network[1]['NetworkSettings']['Networks'][bridge.local.NETWORK]['NetworkID'] = 'replacement'
        scenarios['network id'] = wrong_network
        active_cron = [self.live('db'), self.live('rest')]
        active_cron[0]['Config']['Cmd'] = ['-c', 'cron.launch_active_jobs=on']
        scenarios['active cron'] = active_cron

        for name, live in scenarios.items():
            transport, worker = self.transport()
            with self.subTest(name=name), patch.object(bridge.local, 'identity', return_value=copy.deepcopy(self.record)), patch.object(bridge.local, 'output', return_value=json.dumps(live)):
                with self.assertRaises(RuntimeError):
                    transport.request('rest', 'POST', '/rpc/write', {}, b'{}')
                self.assertEqual(worker.stdin.getvalue(), b'')

        transport, worker = self.transport()
        changed = copy.deepcopy(self.record)
        changed['instanceId'] = '22222222-2222-4222-8222-222222222222'
        with patch.object(bridge.local, 'identity', return_value=changed), patch.object(bridge.local, 'output') as inspect:
            with self.assertRaises(RuntimeError):
                transport.request('rest', 'POST', '/rpc/write', {}, b'{}')
        inspect.assert_not_called()
        self.assertEqual(worker.stdin.getvalue(), b'')


class AppTests(unittest.TestCase):
    def test_deep_link_and_asset_resolution(self):
        app = load('spec14-app')
        self.assertEqual(app.safe_path('/organizer/events?x=1'), 'organizer/events')
        self.assertEqual(app.safe_path('/assets/app.js'), 'assets/app.js')
        for path in ['/%2e%2e/local-secrets.json', '/a/../../local-secrets.json', '//foreign/path', '/%00']:
            with self.subTest(path=path), self.assertRaises(RuntimeError):
                app.safe_path(path)


if __name__ == '__main__':
    unittest.main()
