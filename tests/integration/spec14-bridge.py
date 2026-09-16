#!/usr/bin/env python3
"""Loopback access to isolated backend containers, with no external container route.

Only fixed task REST/Auth/inbox targets are reachable. Persistent docker-exec
streams run curl inside the recorded DB container; no shell evaluates requests.
"""
import base64
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import io
import json
from pathlib import Path
import queue
import subprocess
import threading
import time

spec = importlib.util.spec_from_file_location('spec14', Path(__file__).with_name('spec14-local.py'))
local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local)
TARGETS = {'rest': ('wheretoo-spec14-rest', 3000, 55646), 'auth': ('wheretoo-spec14-auth', 9999, 55648), 'inbox': ('wheretoo-spec14-inbox', 8025, 55649)}
HOP = {'connection', 'transfer-encoding', 'content-length', 'content-encoding', 'host', 'accept-encoding'}
SCRIPT = '''while IFS= read -r spec14_config; do
  spec14_marker=$(psql -X -At -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -c "select instance_id || ':' || current_setting('cron.launch_active_jobs') from spec14_control.identity;")
  if [ "$spec14_marker" != "INSTANCE:off" ]; then exit 77; fi
  printf '%s' "$spec14_config" | base64 -d | curl --config - | base64 -w 0
  printf '\\n'
done'''


def quote(value):
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\r', '\\r').replace('\t', '\\t') + '"'


def curl_config(role, method, path, headers, body):
    local.require(role in TARGETS and method in {'GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'}, 'Unsupported local request')
    local.require(path.startswith('/') and not path.startswith('//') and '\r' not in path and '\n' not in path, 'Invalid local request path')
    host, port, _ = TARGETS[role]
    rows = ['silent', 'include', 'raw', 'http1.1', 'max-time = 30', 'noproxy = "*"', 'proto = "=http"',
            'url = ' + quote(f'http://{host}:{port}' + path), 'request = ' + quote(method)]
    for name, value in headers.items():
        if name.lower() in HOP:
            continue
        local.require('\r' not in name + value and '\n' not in name + value, 'Invalid header')
        rows.append('header = ' + quote(name + ': ' + value))
    rows.append('header = "Accept-Encoding: identity"')
    if body:
        rows.append('data-raw = ' + quote(body.decode('utf-8')))
    return '\n'.join(rows) + '\n'


class MemorySocket:
    def __init__(self, content):
        self.content = content

    def makefile(self, *_):
        return io.BytesIO(self.content)


class Bridge:
    def __init__(self):
        self.workers = queue.Queue()
        self.processes = []
        self.db = local.verify()
        self.record = local.identity()
        for _ in range(4):
            worker = subprocess.Popen(['docker', 'exec', '-i', self.db, 'bash', '-c', SCRIPT.replace('INSTANCE', self.record['instanceId'])], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            self.workers.put(worker)
            self.processes.append(worker)

    def request(self, role, method, path, headers, body):
        # Validate both recorded source and destination for every forwarded write/read.
        local.require(local.identity() == self.record, 'Task configuration changed; restart transport after review')
        records = [self.record['containers'][key] for key in ['db', role]]
        live = json.loads(local.output(['docker', 'inspect', *[value['id'] for value in records]]))
        local.require(isinstance(live, list) and len(live) == len(records) == 2, 'Transport container inspection incomplete')
        for item, known in zip(live, records):
            local.verify_container(item, known, database=known['id'] == self.db)
            networks = item['NetworkSettings']['Networks']
            local.require(set(networks) == {local.NETWORK} and networks[local.NETWORK]['NetworkID'] == self.record['network']['id'], 'Transport network identity changed')
        payload = base64.b64encode(curl_config(role, method, path, headers, body).encode()) + b'\n'
        worker = self.workers.get(timeout=35)
        try:
            local.require(worker.poll() is None, 'Recorded transport stopped')
            worker.stdin.write(payload)
            worker.stdin.flush()
            raw = base64.b64decode(worker.stdout.readline().strip(), validate=True)
            response = http.client.HTTPResponse(MemorySocket(raw))
            response.begin()
            content = response.read()
            return response.status, response.getheaders(), content
        finally:
            self.workers.put(worker)

    def close(self):
        for worker in self.processes:
            worker.stdin.close()
            try:
                worker.wait(timeout=3)
            except subprocess.TimeoutExpired:
                worker.terminate()


def handler_for(role, bridge):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # Auth/private bearer URLs never enter access logs.

        def handle_request(self):
            try:
                length = int(self.headers.get('Content-Length', '0'))
                local.require(0 <= length <= 4 * 1024 * 1024, 'Request too large')
                status, headers, content = bridge.request(role, self.command, self.path, dict(self.headers), self.rfile.read(length))
                self.send_response(status)
                for name, value in headers:
                    if name.lower() not in HOP:
                        self.send_header(name, value)
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                if self.command != 'HEAD':
                    self.wfile.write(content)
            except Exception:
                self.send_response(503)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"message":"Task backend unavailable"}')

        do_GET = do_HEAD = do_POST = do_PATCH = do_PUT = do_DELETE = do_OPTIONS = handle_request
    return Handler


if __name__ == '__main__':
    bridge = Bridge()
    servers = []
    try:
        for role, (_, _, port) in TARGETS.items():
            local.available(port)
            server = ThreadingHTTPServer(('127.0.0.1', port), handler_for(role, bridge))
            servers.append(server)
            threading.Thread(target=server.serve_forever, daemon=True).start()
        print('Task REST/Auth/inbox loopback bridge ready; containers remain internal-only.', flush=True)
        while True:
            time.sleep(1)
    finally:
        for server in servers:
            server.shutdown()
        bridge.close()
