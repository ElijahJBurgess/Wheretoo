#!/usr/bin/env python3
"""Run two hash-pinned admission shell suites through only the task DB container.

The inherited shell and assertion bytes execute unchanged. A private PATH shim
redirects their constrained psql grammar to the recorded database container.
Every requested connection rechecks all invoked source hashes, task resource
identity, database marker and disabled cron. The marker/cron assertion is also
prepended inside the target psql connection before any inherited SQL.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import uuid


ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / '.superpowers/spec14'
SENTINEL = 'postgresql://127.0.0.1:1/spec14-task-transport'
TRANSPORT_MARKER = 'SPEC14_SHELL_TRANSPORT_ROOT'
SOURCES = {
    'supabase/tests/database/core_ticket_truth_lite_redemption_concurrency.test.sh': '0da61655a7c2e3c56dc36d253ffed292ce271ea307aa4d37c749d0435f9023e9',
    'supabase/tests/database/core_ticket_truth_lite_redemption_collision.test.sh': '450c28cdc9fd104ea674d5d23fe007aa230291958493a6b5aaf00cb1692f6471',
}
INCLUDES = {
    'supabase/tests/database/helpers/core_ticket_truth_lite_setup.inc': '5d08b7c3361ef570499932400f2888fcd78c0775b4c322bf55b852878ec52c97',
    'supabase/tests/database/helpers/ticket_manifest.inc': '03ebd257b75efd00f765e3d3fa0813e0b24fcfe355f48de17abc8edf56271e55',
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def load_local():
    spec = importlib.util.spec_from_file_location('spec14_local', ROOT / 'tests/integration/spec14-local.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def verify_hash(path, expected):
    require(path.is_file(), 'Missing reviewed regression source: ' + str(path))
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    require(actual == expected, 'Reviewed regression source changed: ' + str(path.relative_to(ROOT) if path.is_relative_to(ROOT) else path))


def check_invoked_sources():
    selection = json.loads((ROOT / 'Docs/testing/spec14-regression-selection.json').read_text())['sha256']
    for name, expected in SOURCES.items():
        require(selection.get(name) == expected, 'Gate A regression selection changed: ' + name)
        verify_hash(ROOT / name, expected)
    for name, expected in INCLUDES.items():
        verify_hash(ROOT / name, expected)


def parse_psql(arguments):
    require(arguments and arguments[0] == SENTINEL, 'Only the fixed task transport sentinel is accepted')
    parsed = []
    index = 1
    command_seen = False
    while index < len(arguments):
        item = arguments[index]
        if item in {'-X', '-qAt'}:
            require(not command_seen, 'psql option after command is not allowed')
            parsed.append(item)
            index += 1
        elif item in {'-v', '-c'}:
            require(index + 1 < len(arguments), 'Missing value for inherited psql option ' + item)
            require(not command_seen, 'psql option after command is not allowed')
            parsed.extend([item, arguments[index + 1]])
            index += 2
            if item == '-c':
                command_seen = True
                require(index == len(arguments), 'Only one final psql command is allowed')
        else:
            raise RuntimeError('Unsupported inherited psql argument: ' + item)
    require(parsed[:3] == ['-X', '-qAt', '-v'] and len(parsed) >= 4 and parsed[3] == 'ON_ERROR_STOP=1', 'Required inherited psql safety options missing')
    return parsed


def identity_guard(instance_id):
    normalized = str(uuid.UUID(instance_id))
    require(normalized == instance_id, 'Invalid recorded task instance ID')
    return (
        'do $spec14_transport$\n'
        'begin\n'
        "  if (select instance_id from spec14_control.identity) is distinct from '" + normalized + "'\n"
        "     or current_setting('cron.launch_active_jobs') is distinct from 'off' then\n"
        "    raise exception 'Spec 14 task database identity or cron mismatch';\n"
        '  end if;\n'
        'end\n'
        '$spec14_transport$;\n'
    )


def guard_command(arguments, instance_id):
    guarded = list(arguments)
    if '-c' in guarded:
        index = guarded.index('-c') + 1
        guarded[index] = identity_guard(instance_id) + guarded[index]
    return guarded


def include_lines(line, relative_to=ROOT):
    try:
        text = line.decode('utf-8').strip()
    except (UnicodeDecodeError, ValueError) as error:
        raise RuntimeError('Invalid psql input line') from error
    match = re.fullmatch(r'\\(i|ir)\s+(.+)', text)
    if match is None:
        yield line
        return
    try:
        targets = shlex.split(match.group(2))
    except ValueError as error:
        raise RuntimeError('Invalid psql include path') from error
    require(len(targets) == 1, 'Unsupported psql include syntax')
    requested = Path(targets[0])
    path = (requested if requested.is_absolute() else relative_to / requested).resolve()
    require(path.is_relative_to(ROOT), 'psql include outside the task repository refused')
    name = str(path.relative_to(ROOT))
    require(name in INCLUDES, 'Unreviewed psql include refused: ' + name)
    verify_hash(path, INCLUDES[name])
    content = path.read_bytes().splitlines(keepends=True)
    for included in content:
        yield from include_lines(included, path.parent)
    if content and not content[-1].endswith((b'\n', b'\r')):
        yield b'\n'


def forward_input(source, destination, instance_id):
    destination.write(identity_guard(instance_id).encode())
    destination.flush()
    for line in source:
        for expanded in include_lines(line):
            destination.write(expanded)
            destination.flush()


def docker_command(database_id, environment):
    require(re.fullmatch(r'[a-f0-9]{12,64}', database_id) is not None or database_id == 'recorded-db', 'Invalid recorded database container ID')
    require(environment.get('PGOPTIONS') == '-c statement_timeout=20000', 'Inherited PGOPTIONS changed')
    require(environment.get('PGCONNECT_TIMEOUT') == '5', 'Inherited PGCONNECT_TIMEOUT changed')
    application_name = environment.get('PGAPPNAME')
    require(application_name is None or re.fullmatch(r'lite_scan_[0-9]+_[ab]', application_name) is not None, 'Unexpected PostgreSQL application name')
    command = ['docker', 'exec', '-i']
    for name in ('PGAPPNAME', 'PGOPTIONS', 'PGCONNECT_TIMEOUT'):
        value = environment.get(name)
        if value is not None:
            require(0 < len(value) <= 512 and not any(character in value for character in '\0\r\n'), 'Invalid ' + name)
            command.extend(['-e', name + '=' + value])
    return command + [database_id, 'psql', '-U', 'supabase_admin', '-d', 'postgres']


def launch_psql(command, arguments, instance_id):
    guarded = guard_command(arguments, instance_id)
    if '-c' in guarded:
        return subprocess.Popen(command + guarded).wait()
    process = subprocess.Popen(command + guarded, stdin=subprocess.PIPE)
    try:
        forward_input(sys.stdin.buffer, process.stdin, instance_id)
    except BrokenPipeError:
        pass
    finally:
        try:
            process.stdin.close()
        except BrokenPipeError:
            pass
    return process.wait()


def psql_transport(arguments, environment=None, local_module=None, launch=launch_psql):
    environment = os.environ if environment is None else environment
    require(environment.get(TRANSPORT_MARKER) == str(ROOT), 'Direct or foreign shell transport invocation refused')
    require(environment.get('WHERETO_TICKETING_DB_URL') == SENTINEL, 'Task database sentinel changed')
    parsed = parse_psql(arguments)
    check_invoked_sources()
    local = load_local() if local_module is None else local_module
    database_id = local.verify()
    record = local.identity()
    require(database_id == record['containers']['db']['id'], 'Verified database differs from the recorded task database')
    return launch(docker_command(database_id, environment), parsed, record['instanceId'])


def write_shim(directory, local_module=None):
    local = load_local() if local_module is None else local_module
    path = directory / 'psql'
    body = '#!/usr/bin/env bash\nexec ' + shlex.quote(sys.executable) + ' ' + shlex.quote(str(Path(__file__).resolve())) + ' --psql "$@"\n'
    with local.private_open(path) as stream:
        stream.write(body)
    path.chmod(0o700)
    return path


def adapt_concurrency_deadlines(local_module=None):
    """Create a private exact-source copy with only task-transport poll budgets widened."""
    local = load_local() if local_module is None else local_module
    name = 'supabase/tests/database/core_ticket_truth_lite_redemption_concurrency.test.sh'
    source = ROOT / name
    verify_hash(source, SOURCES[name])
    text = source.read_text()
    gate = 'for ((attempt=0;attempt<100;attempt++)); do'
    workers = 'for ((attempt=0;attempt<80;attempt++)); do'
    require(text.count(gate) == 1 and text.count(workers) == 1, 'Reviewed transport deadline anchors changed')
    adapted_text = text.replace(gate, 'for ((attempt=0;attempt<400;attempt++)); do', 1).replace(
        workers, 'for ((attempt=0;attempt<400;attempt++)); do', 1,
    )
    directory = STATE / 'shell-transport/adapted/supabase/tests/database'
    path = directory / source.name
    with local.private_open(path) as stream:
        stream.write(adapted_text)
    path.chmod(0o700)
    helpers = directory / 'helpers'
    expected_helpers = ROOT / 'supabase/tests/database/helpers'
    if helpers.exists() or helpers.is_symlink():
        require(helpers.is_symlink() and helpers.resolve() == expected_helpers, 'Adapted helper identity changed')
    else:
        helpers.symlink_to(expected_helpers, target_is_directory=True)
    local.save(STATE / 'shell-transport/deadline-adaptation.json', {
        'source': name,
        'sourceSha256': SOURCES[name],
        'adaptedSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'changes': {'gatePollAttempts': [100, 400], 'workerPollAttempts': [80, 400]},
        'pollIntervalSeconds': 0.05,
        'reason': 'Verified task transport startup measured 9.38s; inherited polls allowed 5s and 4s.',
    })
    return path


def task_environment(shim):
    preserved = {name: os.environ[name] for name in ('HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM') if name in os.environ}
    preserved['PATH'] = str(shim.parent) + os.pathsep + os.environ.get('PATH', os.defpath)
    preserved[TRANSPORT_MARKER] = str(ROOT)
    preserved['WHERETO_TICKETING_DB_URL'] = SENTINEL
    return preserved


def run_suites(names, transport_deadlines=False):
    check_invoked_sources()
    local = load_local()
    # Early refusal before the shell starts. Every actual psql repeats this proof.
    local.verify()
    shim = write_shim(STATE / 'shell-transport', local)
    environment = task_environment(shim)
    results = []
    for name in names:
        check_invoked_sources()
        executable = adapt_concurrency_deadlines(local) if transport_deadlines and name.endswith('_concurrency.test.sh') else ROOT / name
        log = STATE / ('shell-' + Path(name).stem + '.log')
        with local.private_open(log) as output:
            completed = subprocess.run(['bash', str(executable)], cwd=ROOT, env=environment, stdout=output, stderr=subprocess.STDOUT)
        results.append({
            'path': name,
            'exitCode': completed.returncode,
            'sourceSha256': SOURCES[name],
            'transportDeadlinesAdapted': executable != ROOT / name,
            **({'adaptedSha256': hashlib.sha256(executable.read_bytes()).hexdigest()} if executable != ROOT / name else {}),
        })
        print(('PASS ' if completed.returncode == 0 else 'FAIL ') + name, flush=True)
        local.save(STATE / 'shell-regressions.json', results)
    return 1 if any(row['exitCode'] for row in results) else 0


def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--psql':
        return psql_transport(sys.argv[2:])
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--transport-deadlines', action='store_true', help='Use the recorded private poll-budget adaptation after an original transport timeout')
    parser.add_argument('paths', nargs='+', choices=tuple(SOURCES))
    arguments = parser.parse_args()
    return run_suites(arguments.paths, transport_deadlines=arguments.transport_deadlines)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, FileNotFoundError, subprocess.CalledProcessError, OSError) as error:
        # Keep detailed local diagnostics private; do not echo SQL/environment.
        try:
            local = load_local()
            with local.private_open(STATE / 'shell-runner-error.log') as stream:
                stream.write(type(error).__name__ + ': ' + str(error) + '\n')
        except Exception:
            pass
        print('Spec 14 shell transport stopped; inspect its private task log.', file=sys.stderr)
        sys.exit(1)
