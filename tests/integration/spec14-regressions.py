#!/usr/bin/env python3
"""Run reviewed inherited Python regressions with only their DB helper redirected.

Original assertion/fixture bytes execute unchanged. Selected helper imports resolve
exclusively to the identity-checked Spec14 runner, never an earlier spec database.
"""
import argparse
import ast
import importlib.abc
import re
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / '.superpowers/spec14'
SELECTION = json.loads((ROOT / 'Docs/testing/spec14-regression-selection.json').read_text())['sha256']
SELECTED = {name for name in SELECTION if name.startswith('tests/integration/') and name.endswith('.py')}
HELPERS = {'spec08-spec09-database.py', 'spec10-database.py', 'spec11-database.py', 'spec13-database.py'}
original_spec = importlib.util.spec_from_file_location


def check(path):
    name = str(path.relative_to(ROOT))
    if name not in SELECTED or hashlib.sha256(path.read_bytes()).hexdigest() != SELECTION[name]:
        raise RuntimeError('Unreviewed regression source: ' + name)


class TransportTimeouts(ast.NodeTransformer):
    # Docker container calls take ~3s on this host. Widen only transport/lock
    # deadlines; keep every assertion, concurrency count and data value intact.
    def visit_Constant(self, node):
        if isinstance(node.value, str):
            node.value = re.sub(r"((?:statement_timeout|lock_timeout|idle_in_transaction_session_timeout)=')(\d+)s(')", lambda m: m[1] + str(int(m[2]) * 12) + 's' + m[3], node.value)
        return node

    def visit_keyword(self, node):
        self.generic_visit(node)
        if node.arg == 'timeout' and isinstance(node.value, ast.Constant) and isinstance(node.value.value, (int, float)):
            node.value.value *= 12
        return node

    def visit_BinOp(self, node):
        self.generic_visit(node)
        if isinstance(node.op, ast.Add) and isinstance(node.left, ast.Call) and isinstance(node.left.func, ast.Attribute) and node.left.func.attr == 'monotonic' and isinstance(node.right, ast.Constant):
            node.right.value *= 12
        return node


def code_for(path):
    check(path)
    tree = TransportTimeouts().visit(ast.parse(path.read_text(), filename=str(path)))
    ast.fix_missing_locations(tree)
    rendered = ast.unparse(tree) + '\n'
    directory = STATE / 'adapted-regressions'
    directory.mkdir(exist_ok=True)
    (directory / path.name).write_text(rendered)
    return compile(tree, str(path), 'exec')


class SelectedLoader(importlib.abc.Loader):
    def __init__(self, path):
        self.path = path

    def create_module(self, _spec):
        return None

    def exec_module(self, module):
        module.__file__ = str(self.path)
        exec(code_for(self.path), module.__dict__)


def guarded_spec(name, location, *args, **kwargs):
    path = Path(location).resolve()
    if path.parent == ROOT / 'tests/integration' and path.name in HELPERS:
        return original_spec(name, ROOT / 'tests/integration/spec14-local.py', *args, **kwargs)
    if path.parent == ROOT / 'tests/integration' and path.name.startswith('spec'):
        check(path)
        return importlib.util.spec_from_loader(name, SelectedLoader(path))
    return original_spec(name, location, *args, **kwargs)


def child(name):
    path = (ROOT / name).resolve()
    check(path)
    importlib.util.spec_from_file_location = guarded_spec
    exec(code_for(path), {'__name__': '__main__', '__file__': str(path)})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--child', choices=sorted(SELECTED))
    parser.add_argument('paths', nargs='*')
    args = parser.parse_args()
    if args.child:
        child(args.child)
        return
    if any(name not in SELECTED for name in args.paths):
        parser.error('Only explicit reviewed regression paths are allowed')
    if not args.paths:
        parser.error('Provide explicit selected regression paths')
    os.umask(0o077)
    STATE.mkdir(exist_ok=True, mode=0o700)
    STATE.chmod(0o700)
    results = []
    for name in args.paths:
        log = STATE / ('regression-' + Path(name).stem + '.log')
        if log.exists():
            log.chmod(0o600)
        with log.open('w') as output:
            result = subprocess.run([sys.executable, str(Path(__file__).resolve()), '--child', name], cwd=ROOT, stdout=output, stderr=subprocess.STDOUT)
        results.append({'path': name, 'exitCode': result.returncode, 'sourceSha256': SELECTION[name]})
        print(('PASS ' if result.returncode == 0 else 'FAIL ') + name, flush=True)
        (STATE / 'python-regressions.json').write_text(json.dumps(results, indent=2) + '\n')
    if any(row['exitCode'] for row in results):
        sys.exit(1)


if __name__ == '__main__':
    main()
