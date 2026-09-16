#!/usr/bin/env python3
"""Capture reviewed source identity and rebuild an explicit source-only export.

This tool never stages, commits, resets, deploys, or changes a database. Local
runtime secrets and developer configuration are never copied into the export.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import shutil
import stat
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / '.superpowers/spec14'
INHERITED = ROOT / 'Docs/testing/spec14-inherited-source.json'
CATALOG = ROOT / 'Docs/testing/spec14-source-paths.json'
spec = importlib.util.spec_from_file_location('local', Path(__file__).with_name('spec14-local.py'))
local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local)

EXCLUDED = ('.superpowers/spec14/', '.superpowers/sdd/Spec14-Gate-A-Plan/', '.superpowers/sdd/.gitignore', 'node_modules/', 'dist/', '.worktrees/', '.git/', 'supabase/.temp/')
GENERATED_DIRECTORIES = {'node_modules', 'dist', 'build', 'out', '.next', '.vercel', '.supabase', 'coverage', 'playwright-report', 'test-results', '.worktrees', '.git', '__pycache__', '.idea', '.vscode'}
GENERATED_SUFFIXES = ('.log', '.tsbuildinfo', '.pyc', '.swp')
REVIEWED_IGNORED_SOURCE = {'.env.example', 'supabase/functions/.env.example'}
HIDDEN_CONFIGURATION = {'.npmrc', '.pnpmfile.cjs', '.yarnrc', '.yarnrc.yml', '.netrc', '.pypirc', '.gitconfig', '.curlrc'}
TRUSTED_RUNTIME_DIRECTORIES = ('/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin')
PNPM_VERSION = '11.19.0'
PNPM_WORKSPACE_POLICY_SHA256 = 'c457635b1f0a979f763eaec4eaac04d2c3c98dd3e2f7d74a55a470388684ffd3'
PNPM_COREPACK_INTEGRITY = 'sha512.7881f3ed590d472c4a955e2b88b2121791116066dcc88cbca3849ec9b60f1bbaa6d2ccb221fa91da4e1c65bef2bcbe379365aea7ac539c7bf86dedc3a1b22dce'
PNPM_PACKAGE_TREE_SHA256 = '247cd14d235e4ab9419f98d981795cbeaba79f76f839ee84d964769368dd8ecf'


def digest(content):
    return hashlib.sha256(content).hexdigest()


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def describe(path):
    metadata = path.lstat()
    if stat.S_ISLNK(metadata.st_mode):
        return {'kind': 'symlink', 'mode': oct(stat.S_IMODE(metadata.st_mode)), 'target': os.readlink(path), 'sha256': digest(os.readlink(path).encode())}
    local.require(stat.S_ISREG(metadata.st_mode), 'Unsupported source file kind')
    return {'kind': 'file', 'mode': oct(stat.S_IMODE(metadata.st_mode)), 'sha256': digest(path.read_bytes())}


def excluded_name(name):
    path = Path(name)
    return name.startswith(EXCLUDED) or any(part in GENERATED_DIRECTORIES for part in path.parts) or path.name == 'next-env.d.ts' or path.name == '.DS_Store' or path.name.endswith(GENERATED_SUFFIXES)


def safe_name(name):
    path = Path(name)
    local.require(name and not path.is_absolute() and '..' not in path.parts, 'Unsafe source path')
    local.require(not excluded_name(name), 'Excluded runtime/dependency path in source selection')
    local.require(not any(part.startswith('.env') and part != '.env.example' for part in path.parts), 'Environment file in source selection')
    local.require(path.name not in HIDDEN_CONFIGURATION, 'Hidden package or developer configuration in source selection')


def git_inventory():
    environment = {**os.environ, 'GIT_OPTIONAL_LOCKS': '0'}
    root = subprocess.run(['git', 'rev-parse', '--show-toplevel'], cwd=ROOT, env=environment, capture_output=True, text=True)
    if root.returncode != 0 or Path(root.stdout.strip()).resolve() != ROOT.resolve():
        return None
    return [name for name in subprocess.run(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=ROOT, env=environment, check=True, capture_output=True).stdout.decode().split('\0') if name]


def git_ignored_paths(names):
    if not names:
        return []
    result = subprocess.run(
        ['git', 'check-ignore', '-z', '--stdin'],
        cwd=ROOT,
        env={**os.environ, 'GIT_OPTIONAL_LOCKS': '0'},
        input=('\0'.join(names) + '\0').encode(),
        capture_output=True,
    )
    local.require(result.returncode in {0, 1}, 'Unable to verify ignored source paths')
    ignored = [name for name in result.stdout.decode().split('\0') if name]
    return sorted(name for name in ignored if name not in REVIEWED_IGNORED_SOURCE)


def filesystem_inventory():
    names = []
    for base, directories, files in os.walk(ROOT, followlinks=False):
        relative_base = Path(base).relative_to(ROOT)
        retained = []
        for directory in directories:
            relative = str(relative_base / directory)
            if relative == '.':
                relative = directory
            prefix = relative + '/'
            if excluded_name(relative) or prefix.startswith(EXCLUDED) or any(part.startswith('.env') and part != '.env.example' for part in Path(relative).parts):
                continue
            path = Path(base) / directory
            if path.is_symlink():
                names.append(relative)
            else:
                retained.append(directory)
        directories[:] = retained
        for file in files:
            relative = str(relative_base / file)
            if relative.startswith('./'):
                relative = relative[2:]
            if excluded_name(relative) or (relative + '/').startswith(EXCLUDED) or any(part.startswith('.env') and part != '.env.example' for part in Path(relative).parts):
                continue
            names.append(relative)
    return names


def catalog_capture():
    inventory = git_inventory()
    local.require(inventory is not None, 'Source path catalog requires this checkout as the exact Git root')
    inherited = json.loads(INHERITED.read_text())['files']
    catalog_name = str(CATALOG.relative_to(ROOT))
    # The catalog is a complete standalone filesystem inventory. Git is used
    # only to prove that generation is happening in the intended checkout.
    present = sorted(set(filesystem_inventory()) | {catalog_name})
    for name in present:
        safe_name(name)
    local.require(not git_ignored_paths(present), 'Source inventory contains ignored hidden configuration or runtime evidence')
    removed = sorted(name for name in inherited if name not in set(present))
    for name in removed:
        safe_name(name)
    value = {
        'format': 1,
        'provenance': 'Explicit Spec14 source inventory; content hashes and modes are captured separately.',
        'paths': present,
        'deletions': removed,
    }
    CATALOG.parent.mkdir(parents=True, exist_ok=True)
    temporary = CATALOG.with_name(CATALOG.name + '.' + str(time.time_ns()) + '.tmp')
    temporary.write_bytes(canonical(value))
    temporary.chmod(0o644)
    temporary.replace(CATALOG)
    CATALOG.chmod(0o644)
    print(json.dumps({'paths': len(present), 'deletions': len(removed)}))


def selected_source():
    inherited = json.loads(INHERITED.read_text())['files']
    if CATALOG.exists():
        catalog = json.loads(CATALOG.read_text())
        local.require(catalog.get('format') == 1 and isinstance(catalog.get('paths'), list) and isinstance(catalog.get('deletions'), list), 'Invalid standalone source path catalog')
        names = sorted(set(catalog['paths']))
        removed = sorted(set(catalog['deletions']))
        local.require(len(names) == len(catalog['paths']) and len(removed) == len(catalog['deletions']), 'Duplicate standalone source catalog path')
        actual = sorted(set(filesystem_inventory()))
        local.require(actual == names, 'Standalone source files differ from reviewed path catalog')
        inventory = None
    else:
        inventory = git_inventory()
        local.require(inventory is not None, 'Standalone source path catalog is absent')
        names = sorted(set(inventory) | set(inherited))
        removed = []
    files = {}
    for name in names:
        safe_name(name)
        path = ROOT / name
        if not path.exists() and not path.is_symlink():
            if inventory is not None:
                removed.append(name)
            else:
                local.require(False, 'Catalog source file is absent: ' + name)
            continue
        record = describe(path)
        if record['kind'] == 'symlink':
            local.require(not Path(record['target']).is_absolute() and path.resolve().is_relative_to(ROOT), 'Source symlink leaves export')
        files[name] = record
    if inventory is None:
        for name in removed:
            safe_name(name)
            path = ROOT / name
            local.require(not path.exists() and not path.is_symlink(), 'Intended deletion exists in standalone source: ' + name)
    return {'format': 1, 'files': files, 'deletions': removed}


def source_capture():
    manifest = selected_source()
    inherited = json.loads(INHERITED.read_text())['files']
    changes = {'added': [], 'changed': [], 'deleted': []}
    for name, value in manifest['files'].items():
        before = inherited.get(name)
        if not before or before.get('kind') == 'deleted':
            changes['added'].append(name)
        elif any(before.get(key) != value.get(key) for key in ['kind', 'mode', 'sha256']):
            changes['changed'].append(name)
    for name in manifest['deletions']:
        if inherited.get(name, {}).get('kind') not in {None, 'deleted'}:
            changes['deleted'].append(name)
    identity = digest(canonical(manifest))
    local.save(STATE / 'source-manifest.json', manifest)
    local.save(STATE / 'source-identity.json', {'sha256': identity, 'present': len(manifest['files']), 'deletions': len(manifest['deletions']), 'changesFromResolvedSpec13': changes})
    print(json.dumps({'sourceSha256': identity, 'present': len(manifest['files']), 'deletions': len(manifest['deletions'])}))
    return manifest, identity


def tree_records(directory):
    local.require(directory.is_dir(), 'Artifact directory is absent')
    records = {}
    for path in sorted(directory.rglob('*')):
        if path.is_dir() and not path.is_symlink():
            continue
        records[str(path.relative_to(directory))] = describe(path)
    return records


def build_tree_records(directory):
    records = tree_records(directory)
    local.require(all(value['kind'] == 'file' for value in records.values()), 'Build output symlink is unsupported')
    return records


def regular_tree_records(directory):
    """Describe a complete owned package tree while rejecting link indirection."""
    local.require(directory.is_dir() and not directory.is_symlink(), 'Pinned pnpm package directory is unavailable')
    local.require(directory.stat().st_uid == os.getuid(), 'Pinned pnpm package belongs to another user')
    records = {}
    for path in sorted(directory.rglob('*')):
        metadata = path.lstat()
        local.require(metadata.st_uid == os.getuid(), 'Pinned pnpm package contains a path owned by another user')
        name = str(path.relative_to(directory))
        mode = oct(stat.S_IMODE(metadata.st_mode))
        if stat.S_ISDIR(metadata.st_mode):
            records[name] = {'kind': 'directory', 'mode': mode}
        elif stat.S_ISREG(metadata.st_mode):
            records[name] = {'kind': 'file', 'mode': mode, 'sha256': digest(path.read_bytes())}
        else:
            local.require(False, 'Pinned pnpm package contains a symlink or unsupported file')
    return records


def workspace_boundary():
    resolved = ROOT.resolve()
    for parent in resolved.parents:
        if parent.name == '.worktrees':
            return parent.parent
    return resolved


def validate_runtime_path(path, name):
    candidate = Path(path)
    local.require(candidate.is_absolute(), name + ' runtime path is not absolute')
    resolved = candidate.resolve()
    local.require(resolved.is_file() and os.access(resolved, os.X_OK), name + ' runtime is unavailable')
    local.require(not resolved.is_relative_to(workspace_boundary()) and '.worktrees' not in resolved.parts, name + ' runtime resolves inside source or sibling worktree')
    return resolved


def user_home():
    """Use the operating-system account record rather than caller HOME."""
    return Path(pwd.getpwuid(os.getuid()).pw_dir)


def trusted_pnpm_package(version):
    package = user_home() / '.cache/node/corepack/v1/pnpm' / version
    records = regular_tree_records(package)
    package_hash = digest(canonical(records))
    local.require(package_hash == PNPM_PACKAGE_TREE_SHA256, 'Pinned pnpm package tree differs from reviewed bytes or modes')
    metadata = json.loads((package / 'package.json').read_text())
    corepack = json.loads((package / '.corepack').read_text())
    local.require(metadata.get('name') == 'pnpm' and metadata.get('version') == version, 'Pinned pnpm package metadata is invalid')
    local.require(corepack.get('locator') == {'name': 'pnpm', 'reference': version}, 'Pinned pnpm Corepack locator is invalid')
    local.require(corepack.get('hash') == PNPM_COREPACK_INTEGRITY, 'Pinned pnpm Corepack integrity differs from reviewed metadata')
    entry_name = corepack.get('bin', {}).get('pnpm')
    local.require(isinstance(entry_name, str), 'Pinned pnpm Corepack entry is absent')
    entry_path = Path(entry_name)
    local.require(not entry_path.is_absolute() and '..' not in entry_path.parts, 'Pinned pnpm Corepack entry is unsafe')
    entry = (package / entry_path).resolve()
    local.require(entry.is_relative_to(package.resolve()) and entry.is_file(), 'Pinned pnpm Corepack entry is unavailable')
    return entry, package_hash


def trusted_runtime():
    search = os.pathsep.join(path for path in TRUSTED_RUNTIME_DIRECTORIES if Path(path).is_dir())
    node_found = shutil.which('node', path=search)
    local.require(node_found, 'Pinned Node runtime is unavailable outside the workspace')
    node = validate_runtime_path(node_found, 'Node')
    runtime_path = os.pathsep.join(dict.fromkeys([str(node.parent), '/usr/bin', '/bin']))
    environment = {'PATH': runtime_path, 'LANG': 'C'}
    node_version = subprocess.run([str(node), '--version'], env=environment, check=True, capture_output=True, text=True).stdout.strip()
    package_manager = json.loads((ROOT / 'package.json').read_text()).get('packageManager')
    local.require(package_manager == 'pnpm@' + PNPM_VERSION, 'Repository packageManager does not match reviewed pnpm package')
    local.require(node_version.startswith('v') and node_version[1:].replace('.', '').isdigit(), 'Node runtime version is invalid')
    pnpm, package_hash = trusted_pnpm_package(PNPM_VERSION)
    pnpm_version = subprocess.run([str(node), str(pnpm), '--version'], env=environment, check=True, capture_output=True, text=True).stdout.strip()
    local.require(pnpm_version == PNPM_VERSION, 'Pinned pnpm package does not report its reviewed version')
    return {
        'node': str(node),
        'nodeSha256': digest(node.read_bytes()),
        'nodeVersion': node_version,
        'path': runtime_path,
        'pnpmCommand': [str(node), str(pnpm)],
        'pnpmEntrySha256': digest(pnpm.read_bytes()),
        'pnpmPackageSha256': package_hash,
        'pnpmCorepackIntegrity': PNPM_COREPACK_INTEGRITY,
        'pnpmVersion': pnpm_version,
    }


def run_logged(stage, command, cwd, environment, log):
    with local.private_open(log, 'w') as stream:
        result = subprocess.run(command, cwd=cwd, env=environment, stdout=stream, stderr=subprocess.STDOUT, text=True)
    local.require(result.returncode == 0, 'Clean export child stage failed: ' + stage)
    return log.read_text()


def reviewed_store_candidates():
    home = user_home()
    if sys.platform == 'darwin':
        return [home / 'Library/pnpm/store/v11']
    if sys.platform.startswith('linux'):
        return [home / '.local/share/pnpm/store/v11']
    return []


def reviewed_store_structure(store):
    """Validate content without following the project registry's external links."""
    resolved = store.resolve()
    local.require(resolved == store and store.is_dir() and not store.is_symlink(), 'Reviewed pnpm offline store is unavailable')
    local.require(store.stat().st_uid == os.getuid(), 'Reviewed pnpm offline store belongs to another user')
    files = store / 'files'
    links = store / 'links'
    projects = store / 'projects'
    index = store / 'index.db'
    for directory in [files, links, projects]:
        local.require(directory.is_dir() and not directory.is_symlink() and directory.stat().st_uid == os.getuid(), 'Reviewed pnpm offline store structure is invalid')
    local.require(index.is_file() and not index.is_symlink() and index.stat().st_uid == os.getuid(), 'Reviewed pnpm offline store structure is invalid')

    content_entries = 0
    for base, directories, filenames in os.walk(files, followlinks=False):
        for name in list(directories) + filenames:
            path = Path(base) / name
            metadata = path.lstat()
            local.require(metadata.st_uid == os.getuid(), 'Reviewed pnpm store content belongs to another user')
            local.require(stat.S_ISDIR(metadata.st_mode) or stat.S_ISREG(metadata.st_mode), 'Reviewed pnpm store content contains a symlink or unsupported file')
            content_entries += 1

    contained_links = 0
    for base, directories, filenames in os.walk(links, followlinks=False):
        for name in list(directories):
            path = Path(base) / name
            if path.is_symlink():
                metadata = path.lstat()
                local.require(metadata.st_uid == os.getuid(), 'Reviewed pnpm store link belongs to another user')
                target = Path(os.readlink(path))
                lexical = target if target.is_absolute() else path.parent / target
                normalized = Path(os.path.normpath(str(lexical)))
                local.require(normalized.is_relative_to(store), 'Reviewed pnpm store link leaves the store')
                contained_links += 1
                directories.remove(name)
        for name in list(directories) + filenames:
            path = Path(base) / name
            metadata = path.lstat()
            local.require(metadata.st_uid == os.getuid(), 'Reviewed pnpm store link belongs to another user')
            if stat.S_ISLNK(metadata.st_mode):
                target = Path(os.readlink(path))
                lexical = target if target.is_absolute() else path.parent / target
                normalized = Path(os.path.normpath(str(lexical)))
                local.require(normalized.is_relative_to(store), 'Reviewed pnpm store link leaves the store')
                contained_links += 1
            else:
                local.require(stat.S_ISDIR(metadata.st_mode) or stat.S_ISREG(metadata.st_mode), 'Reviewed pnpm store link tree contains an unsupported file')

    project_links = 0
    for path in projects.iterdir():
        metadata = path.lstat()
        local.require(metadata.st_uid == os.getuid() and stat.S_ISLNK(metadata.st_mode), 'Reviewed pnpm project registry contains an unsupported entry')
        local.require(bool(os.readlink(path)), 'Reviewed pnpm project registry link is empty')
        project_links += 1
    return {'contentEntries': content_entries, 'containedLinks': contained_links, 'projectRegistryLinks': project_links}


def offline_store():
    """Select an owned fixed-platform cache without consulting pnpm config."""
    for candidate in reviewed_store_candidates():
        if not candidate.is_absolute() or not candidate.exists() or candidate.is_symlink():
            continue
        resolved = candidate.resolve()
        if resolved != candidate or resolved.is_relative_to(workspace_boundary()):
            continue
        try:
            reviewed_store_structure(resolved)
        except RuntimeError:
            continue
        return resolved
    local.require(False, 'Reviewed pnpm offline store is unavailable')


def isolated_environment(export, runtime):
    """Build without developer home, package-manager config, or task secrets."""
    root = export.parent / ('environment-' + export.name)
    local.require(not root.resolve().is_relative_to(ROOT.resolve()), 'Clean build environment must be outside source ancestry')
    root.mkdir(mode=0o700)
    root.chmod(0o700)
    directories = {name: root / name for name in ['config', 'cache', 'data', 'state', 'tmp']}
    for directory in directories.values():
        directory.mkdir(mode=0o700)
        directory.chmod(0o700)
    user_config = root / 'npm-userconfig'
    global_config = root / 'npm-globalconfig'
    for path in [user_config, global_config]:
        with local.private_open(path, 'w') as stream:
            stream.write('')
    environment = {key: value for key, value in os.environ.items() if key in {'LANG', 'LC_ALL'}}
    environment.update({
        'PATH': runtime['path'],
        'TMPDIR': str(directories['tmp']),
        'XDG_CONFIG_HOME': str(directories['config']),
        'XDG_CACHE_HOME': str(directories['cache']),
        'XDG_DATA_HOME': str(directories['data']),
        'XDG_STATE_HOME': str(directories['state']),
        'NPM_CONFIG_USERCONFIG': str(user_config),
        'NPM_CONFIG_GLOBALCONFIG': str(global_config),
        'npm_config_userconfig': str(user_config),
        'npm_config_globalconfig': str(global_config),
        'COREPACK_ENABLE_DOWNLOAD_PROMPT': '0',
        'COREPACK_ENABLE_NETWORK': '0',
        'NODE_OPTIONS': '--no-global-search-paths',
        'VITE_SUPABASE_URL': local.ORIGIN,
        'VITE_SUPABASE_PUBLISHABLE_KEY': local.token('anon'),
        'VITE_MAPBOX_ACCESS_TOKEN': 'spec14-synthetic',
        'VITE_STRIPE_PUBLISHABLE_KEY': 'pk_test_spec14synthetic',
        'WHERETOO_ENABLE_PREVIEW': '0',
        'VERCEL_ENV': 'preview',
    })
    local.require(not {'HOME', 'CODEX_HOME', 'PNPM_HOME', 'COREPACK_HOME', 'NODE_PATH'} & environment.keys(), 'Developer home or Node search path leaked into clean build')
    return environment


def bind_export_workspace(export, manifest, environment):
    """Restore only the inherited build approvals, without ancestor/caller workspace discovery."""
    policy = export / 'pnpm-workspace.yaml'
    expected = manifest.get('files', {}).get('pnpm-workspace.yaml')
    local.require(export.is_dir() and not export.is_symlink(), 'Export workspace directory is unsafe')
    local.require(isinstance(expected, dict) and expected.get('kind') == 'file'
                  and expected.get('sha256') == PNPM_WORKSPACE_POLICY_SHA256,
                  'Export workspace policy is unlisted or unsupported')
    local.require(policy.is_file() and not policy.is_symlink()
                  and policy.resolve().parent == export.resolve(), 'Export workspace policy is missing or indirect')
    local.require(describe(policy) == expected, 'Export workspace policy differs from reviewed source')
    # The pinned pnpm resolver consumes this explicit directory instead of walking ancestors.
    return {**environment, 'NPM_CONFIG_WORKSPACE_DIR': str(export.resolve()),
            'npm_config_workspace_dir': str(export.resolve())}


def external_export_base():
    identity = digest(str(ROOT.resolve()).encode())[:16]
    return Path(tempfile.gettempdir()).resolve() / ('wheretoo-spec14-exports-' + identity)


def require_isolated_export_path(export):
    resolved = export.resolve()
    local.require(not resolved.is_relative_to(ROOT.resolve()), 'Clean export must be outside source ancestry')
    for ancestor in [resolved.parent, *resolved.parent.parents]:
        modules = ancestor / 'node_modules'
        local.require(not modules.exists() and not modules.is_symlink(), 'Clean export ancestor node_modules would permit dependency fallback')


def new_export_directory():
    base = external_export_base()
    export = base / ('export-' + str(time.time_ns()))
    require_isolated_export_path(export)
    local.require(not base.is_symlink(), 'Clean export base must not be a symlink')
    base.mkdir(mode=0o700, exist_ok=True)
    metadata = base.stat()
    local.require(metadata.st_uid == os.getuid(), 'Clean export base belongs to another user')
    base.chmod(0o700)
    export.mkdir(mode=0o700)
    return export


def build_capture(expected_source=None):
    _, source_sha = source_capture()
    if expected_source is not None:
        local.require(source_sha == expected_source, 'Source changed while building')
    files = build_tree_records(ROOT / 'dist')
    local.require(files.get('index.html', {}).get('kind') == 'file', 'Build first')
    record = {'format': 2, 'sourceSha256': source_sha, 'assetsSha256': digest(canonical(files)), 'files': files, 'gallery': False, 'providers': 'local simulation only'}
    local.save(STATE / 'build-identity.json', record)
    print(json.dumps({'assetsSha256': record['assetsSha256'], 'assets': len(files)}))
    return record


def logged_json(output, stage):
    lines = [line for line in output.splitlines() if line.strip()]
    local.require(lines, 'Clean export child stage returned no result: ' + stage)
    try:
        value = json.loads(lines[-1])
    except (TypeError, ValueError):
        local.require(False, 'Clean export child stage returned invalid JSON: ' + stage)
    local.require(isinstance(value, dict), 'Clean export child stage returned invalid result: ' + stage)
    return value


def begin_clean_export_attempt(stamp):
    latest = {'format': 1, 'attemptId': stamp, 'status': 'running'}
    local.save(STATE / 'clean-export-latest.json', latest)
    fixed = STATE / 'clean-export-result.json'
    if fixed.exists():
        local.require(fixed.is_file() and not fixed.is_symlink(), 'Prior clean export result is unsafe')
        local.save(STATE / ('clean-export-result-preserved-' + stamp + '.json'), json.loads(fixed.read_text()))
        fixed.unlink()


def verified_clean_export_result():
    latest = json.loads((STATE / 'clean-export-latest.json').read_text())
    local.require(latest.get('format') == 1 and latest.get('status') == 'passed', 'Latest clean export attempt has not passed')
    attempt = latest.get('attemptId')
    local.require(isinstance(attempt, str) and attempt.isdigit(), 'Latest clean export attempt identity is invalid')
    result_name = 'clean-export-result-' + attempt + '.json'
    local.require(latest.get('resultFile') == result_name, 'Latest clean export result reference is invalid')
    result = json.loads((STATE / result_name).read_text())
    fixed = json.loads((STATE / 'clean-export-result.json').read_text())
    local.require(result.get('status') == 'passed' and result.get('attemptId') == attempt, 'Latest clean export result identity is invalid')
    local.require(fixed == result, 'Fixed clean export result does not match the latest passed attempt')
    return result


def clean_export():
    stamp = str(time.time_ns())
    stage = 'catalog'
    export = None
    source_sha = None
    logs = []

    def stage_log(name):
        path = STATE / ('clean-export-' + stamp + '-' + name + '.log')
        logs.append(path.name)
        return path

    try:
        begin_clean_export_attempt(stamp)
        local.require(CATALOG.is_file(), 'Final reviewed source catalog is required before clean export')
        stage = 'source'
        manifest, source_sha = source_capture()
        stage = 'task-build'
        recorded_build = json.loads((STATE / 'build-identity.json').read_text())
        expected = build_tree_records(ROOT / 'dist')
        local.require(recorded_build.get('sourceSha256') == source_sha, 'Task build was captured from different source; rebuild before export')
        local.require(recorded_build.get('files') == expected and recorded_build.get('assetsSha256') == digest(canonical(expected)), 'Task dist differs from captured build identity')
        stage = 'copy'
        export = new_export_directory()
        for name, record in manifest['files'].items():
            source = ROOT / name
            target = export / name
            target.parent.mkdir(parents=True, exist_ok=True)
            local.require(describe(source) == record, 'Source changed during export: ' + name)
            if record['kind'] == 'symlink':
                target.symlink_to(record['target'])
            else:
                shutil.copyfile(source, target)
                target.chmod(int(record['mode'], 8))
            local.require(describe(target) == record, 'Export bytes/mode mismatch: ' + name)
        for name in manifest['deletions']:
            target = export / name
            local.require(not target.exists() and not target.is_symlink(), 'Deleted source appeared in export: ' + name)
        stage = 'source-recheck'
        local.require(selected_source() == manifest, 'Source inventory changed during export')
        require_isolated_export_path(export)
        stage = 'runtime'
        runtime = trusted_runtime()
        environment = bind_export_workspace(export, manifest, isolated_environment(export, runtime))
        stage = 'standalone-source'
        standalone = logged_json(run_logged(stage, [sys.executable, '-I', '-B', 'tests/integration/spec14-artifacts.py', 'source'], export, environment, stage_log(stage)), stage)
        standalone_source = standalone.get('sourceSha256')
        local.require(standalone_source == source_sha, 'Standalone export resolved a different source identity')
        stage = 'store'
        store = offline_store()
        stage = 'install'
        # In the pinned pnpm 11.19.0 source, frozenStore bypasses project
        # registration and opens the store index read-only. Disabling the
        # global virtual store also excludes its link registry from installs. This
        # setting uses pnpm 11's explicit config prefix, not an install CLI flag.
        environment = bind_export_workspace(export, manifest, environment)
        run_logged(stage, [*runtime['pnpmCommand'], 'install', '--offline', '--frozen-lockfile', '--frozen-store', '--config.enable-global-virtual-store=false', '--store-dir', str(store)], export, environment, stage_log(stage))
        stage = 'build'
        environment = bind_export_workspace(export, manifest, environment)
        run_logged(stage, [*runtime['pnpmCommand'], '--config.enable-global-virtual-store=false', '--config.verify-deps-before-run=error', 'run', 'build'], export, environment, stage_log(stage))
        files = build_tree_records(export / 'dist')
        stage = 'standalone-build'
        standalone_build = logged_json(run_logged(stage, [sys.executable, '-I', '-B', 'tests/integration/spec14-artifacts.py', 'build', '--expected-source', source_sha], export, environment, stage_log(stage)), stage)
        standalone_assets = standalone_build.get('assetsSha256')
        assets = digest(canonical(files))
        local.require(standalone_assets == assets, 'Standalone export captured different build bytes or modes')
        stage = 'final-task-recheck'
        final_manifest = selected_source()
        final_expected = build_tree_records(ROOT / 'dist')
        final_recorded_build = json.loads((STATE / 'build-identity.json').read_text())
        local.require(final_manifest == manifest, 'Original source changed during clean export')
        local.require(final_expected == expected, 'Original task dist changed during clean export')
        local.require(final_recorded_build == recorded_build, 'Original task build identity changed during clean export')
        # Repeat the boundary reads so a change during the first final pass is
        # also rejected before any passed result is published.
        local.require(selected_source() == manifest, 'Original source changed during final clean export verification')
        local.require(build_tree_records(ROOT / 'dist') == expected, 'Original task dist changed during final clean export verification')
        local.require(json.loads((STATE / 'build-identity.json').read_text()) == recorded_build, 'Original task build identity changed during final clean export verification')
        stage = 'compare'
        local.require(files == expected, 'Clean export build differs from task build; compare before handoff')
        result = {
            'status': 'passed',
            'attemptId': stamp,
            'sourceSha256': source_sha,
            'standaloneSourceSha256': standalone_source,
            'exportDirectory': str(export),
            'assetsSha256': assets,
            'identicalToTaskBuild': files == expected,
            'copiedFiles': len(manifest['files']),
            'dependencies': 'fresh offline frozen-lockfile install from an explicit store using pinned runtime paths; no caller/source/sibling PATH or Node module fallback',
            'configuration': 'external isolated package-manager config and explicit synthetic public values; no env files or developer home',
            'runtime': {key: runtime[key] for key in ['nodeSha256', 'nodeVersion', 'pnpmEntrySha256', 'pnpmPackageSha256', 'pnpmCorepackIntegrity', 'pnpmVersion']},
            'logs': logs,
        }
        result_name = 'clean-export-result-' + stamp + '.json'
        local.save(STATE / result_name, result)
        local.save(STATE / 'clean-export-result.json', result)
        local.save(STATE / 'clean-export-latest.json', {'format': 1, 'attemptId': stamp, 'status': 'passed', 'resultFile': result_name})
        verified = verified_clean_export_result()
        print(json.dumps({**verified, 'exportDirectory': 'recorded privately in clean-export-result.json'}))
    except Exception as error:
        failure_name = 'clean-export-failure-' + stamp + '.json'
        failure = {
            'status': 'failed',
            'attemptId': stamp,
            'stage': stage,
            'sourceSha256': source_sha,
            'exportDirectory': str(export) if export else None,
            'errorType': type(error).__name__,
            'logs': logs,
        }
        local.save(STATE / failure_name, failure)
        (STATE / 'clean-export-result.json').unlink(missing_ok=True)
        local.save(STATE / 'clean-export-latest.json', {'format': 1, 'attemptId': stamp, 'status': 'failed', 'failureFile': failure_name})
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['catalog', 'source', 'build', 'export'])
    parser.add_argument('--expected-source')
    args = parser.parse_args()
    action = args.action
    if action == 'catalog': catalog_capture()
    if action == 'source': source_capture()
    elif action == 'build': build_capture(args.expected_source)
    elif action == 'export': clean_export()


def cli():
    try:
        main()
    except Exception:
        print('Spec14 artifact operation stopped; inspect private task evidence for the recorded stage.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(cli())
