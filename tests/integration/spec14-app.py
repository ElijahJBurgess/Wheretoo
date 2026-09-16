#!/usr/bin/env python3
"""Serve unchanged production assets, task APIs and explicit local address tools."""
import hashlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import mimetypes
from pathlib import Path
from urllib.parse import unquote, urlsplit

spec = importlib.util.spec_from_file_location('spec14', Path(__file__).with_name('spec14-local.py'))
local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local)
HOP = {'connection', 'host', 'transfer-encoding', 'content-length'}
ADDRESS_TOOLS = {
    '__spec14/address-testing': ('tests/integration/spec14-address-testing.html', 'text/html'),
    '__spec14/address-setup.js': ('tests/integration/spec14-address-setup.js', 'application/javascript'),
    '__spec14/address-worker.js': ('tests/integration/spec14-address-worker.js', 'application/javascript'),
    '__spec14/address-fixture.json': ('tests/e2e/support/spec14-address-fixture.json', 'application/json'),
}


def safe_path(raw):
    value = unquote(urlsplit(raw).path)
    local.require(raw.startswith('/') and not raw.startswith('//') and '\x00' not in value and '\\' not in value, 'Invalid path')
    local.require(all(part not in {'.', '..'} for part in value.split('/')), 'Invalid path segments')
    return value.lstrip('/')


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Never log private token-bearing URLs.

    def dispatch(self):
        try:
            path = safe_path(self.path)
            if path.startswith(('auth/v1/', 'rest/v1/', 'functions/v1/')):
                size = int(self.headers.get('Content-Length', '0'))
                local.require(0 <= size <= 4 * 1024 * 1024, 'Request too large')
                headers = {name: value for name, value in self.headers.items() if name.lower() not in HOP}
                connection = http.client.HTTPConnection('127.0.0.1', 55647, timeout=60)
                connection.request(self.command, self.path, body=self.rfile.read(size), headers=headers)
                response = connection.getresponse()
                body = response.read()
                self.send_response(response.status)
                for name, value in response.getheaders():
                    if name.lower() not in HOP:
                        self.send_header(name, value)
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                if self.command != 'HEAD':
                    self.wfile.write(body)
                connection.close()
                return
            local.require(self.command in {'GET', 'HEAD'}, 'Static content is read-only')
            if path in ADDRESS_TOOLS:
                local.require(self.headers.get('Host') in {'127.0.0.1:3040', 'localhost:3040'}, 'Address tools are task-loopback only')
                record = local.identity()
                local.require(record['task'] == local.TASK and record['root'] == str(local.ROOT), 'Wrong task address tools')
                name, kind = ADDRESS_TOOLS[path]
                self.reply(200, (local.ROOT / name).read_bytes(), kind, worker=path.endswith('/address-worker.js'))
                return
            if path == '__spec14/identity':
                record = local.identity()
                index_sha = hashlib.sha256((local.ROOT / 'dist/index.html').read_bytes()).hexdigest()
                build = json.loads((local.STATE / 'build-identity.json').read_text())
                local.require(build['files']['index.html']['kind'] == 'file' and build['files']['index.html']['sha256'] == index_sha, 'Served index differs from recorded build')
                self.reply(200, json.dumps({'task': local.TASK, 'instanceId': record['instanceId'], 'application': local.ORIGIN, 'indexSha256': index_sha, 'assetsSha256': build['assetsSha256'], 'sourceSha256': build['sourceSha256'], 'providers': 'local simulation only'}).encode(), 'application/json')
                return
            file = local.ROOT / 'dist' / (path or 'index.html')
            if not file.is_file():
                if path.startswith('assets/') or '.' in path.rsplit('/', 1)[-1]:
                    self.reply(404, b'Not found', 'text/plain')
                    return
                file = local.ROOT / 'dist/index.html'
            local.require(file.resolve().is_relative_to((local.ROOT / 'dist').resolve()), 'Outside build directory')
            self.reply(200, file.read_bytes(), mimetypes.guess_type(file.name)[0] or 'application/octet-stream')
        except Exception:
            self.reply(503, b'{"message":"Task application unavailable"}', 'application/json')

    def reply(self, status, body, kind, worker=False):
        self.send_response(status)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if worker:
            self.send_header('Service-Worker-Allowed', '/')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    do_GET = do_HEAD = do_POST = do_PATCH = do_PUT = do_DELETE = do_OPTIONS = dispatch


if __name__ == '__main__':
    local.verify()
    local.require((local.ROOT / 'dist/index.html').exists(), 'Build before serving')
    local.available(3040)
    print('Production artifact at ' + local.ORIGIN + '/discover; original CSP retained.', flush=True)
    with ThreadingHTTPServer(('127.0.0.1', 3040), Handler) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
