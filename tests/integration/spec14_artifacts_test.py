"""Pure filesystem checks for Spec14 source and build identity handling."""
import ast
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('artifacts', Path(__file__).with_name('spec14-artifacts.py'))
artifacts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifacts)


class ArtifactIdentityTests(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('SPEC14_RUN_PINNED_PNPM_CLI_TEST') == '1',
                         'Explicit pinned local CLI proof; dependency-free temporary package and store only')
    def test_export_build_checks_matching_state_and_refuses_stale_state_without_child_install(self):
        runtime = artifacts.trusted_runtime()
        tree = ast.parse(Path(artifacts.__file__).read_text())
        build_calls = [node for node in ast.walk(tree)
                       if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                       and node.func.id == 'run_logged' and len(node.args) > 1
                       and isinstance(node.args[1], ast.List)
                       and isinstance(node.args[1].elts[0], ast.Starred)
                       and ast.unparse(node.args[1].elts[0].value) == "runtime['pnpmCommand']"
                       and isinstance(node.args[1].elts[-1], ast.Constant)
                       and node.args[1].elts[-1].value == 'build']
        self.assertEqual(len(build_calls), 1)
        self.assertTrue(all(isinstance(part, ast.Constant) for part in build_calls[0].args[1].elts[1:]))
        options = [part.value for part in build_calls[0].args[1].elts[1:]]
        with tempfile.TemporaryDirectory() as directory:
            outer = Path(directory)
            fixture = outer / 'fixture'
            fixture.mkdir()
            (fixture / 'package.json').write_text(json.dumps({
                'name': 'spec14-build-policy-proof', 'private': True,
                'packageManager': 'pnpm@11.19.0',
                'scripts': {'build': 'node build.cjs'},
            }))
            (fixture / 'build.cjs').write_text("require('node:fs').writeFileSync('build-reached', 'declared-script-only')")
            policy = fixture / 'pnpm-workspace.yaml'
            policy.write_bytes(b'allowBuilds:\n  deno: true\n  esbuild: true\n')
            with patch.object(artifacts.local, 'token', return_value='synthetic-public'):
                environment = artifacts.isolated_environment(fixture, runtime)
            environment = artifacts.bind_export_workspace(fixture, {'files': {'pnpm-workspace.yaml': artifacts.describe(policy)}}, environment)
            # Trap the installed CJS shim's ambient child path before any fixture invocation.
            # Even the old production command can only write this local marker, never install.
            trap = outer / 'trap'
            trap.mkdir()
            child_marker = outer / 'child-installer-called'
            for name in ['pnpm', 'corepack', 'npm']:
                executable = trap / name
                executable.write_text('#!/bin/sh\nprintf child > "$SPEC14_CHILD_MARKER"\nexit 86\n')
                executable.chmod(0o700)
            environment['PATH'] = str(trap) + os.pathsep + environment['PATH']
            environment['SPEC14_CHILD_MARKER'] = str(child_marker)
            store = outer / 'fixture-store'
            install = subprocess.run([
                *runtime['pnpmCommand'], 'install', '--offline', '--ignore-scripts',
                '--config.enable-global-virtual-store=false', '--store-dir', str(store),
            ], cwd=fixture, env=environment, capture_output=True, text=True, timeout=30)
            self.assertEqual(install.returncode, 0, install.stdout + install.stderr)
            # Bootstrap writes only the temporary store; verification uses the exact frozen flags.
            frozen = subprocess.run([
                *runtime['pnpmCommand'], 'install', '--offline', '--frozen-lockfile', '--frozen-store',
                '--config.enable-global-virtual-store=false', '--store-dir', str(store),
            ], cwd=fixture, env=environment, capture_output=True, text=True, timeout=30)
            self.assertEqual(frozen.returncode, 0, frozen.stdout + frozen.stderr)
            self.assertFalse(child_marker.exists())
            store_before = artifacts.tree_records(store)
            state = fixture / 'node_modules/.pnpm-workspace-state-v1.json'
            self.assertIs(json.loads(state.read_text())['settings']['enableGlobalVirtualStore'], False)
            before = artifacts.tree_records(fixture)
            matching = subprocess.run([*runtime['pnpmCommand'], *options], cwd=fixture, env=environment,
                                      capture_output=True, text=True, timeout=20)
            self.assertEqual(matching.returncode, 0, matching.stdout + matching.stderr)
            self.assertEqual((fixture / 'build-reached').read_text(), 'declared-script-only')
            self.assertFalse(child_marker.exists(), 'Build verification must not invoke an installer')
            (fixture / 'build-reached').unlink()
            self.assertEqual(artifacts.tree_records(fixture), before)
            for key, expected in [('enable-global-virtual-store', 'false'), ('verify-deps-before-run', 'error')]:
                option = next(part for part in options if part.startswith('--config.' + key + '='))
                config = subprocess.run([*runtime['pnpmCommand'], 'config', 'get', key, option],
                                        cwd=fixture, env=environment, capture_output=True, text=True, timeout=20)
                self.assertEqual(config.returncode, 0, config.stderr)
                self.assertEqual(config.stdout.strip(), expected)
            # Change a recorded setting, retaining a real CLI-generated state and lockfile.
            recorded = json.loads(state.read_text())
            recorded['settings']['enableGlobalVirtualStore'] = True
            state.write_text(json.dumps(recorded))
            stale_before = artifacts.tree_records(fixture)
            stale = subprocess.run([*runtime['pnpmCommand'], *options], cwd=fixture, env=environment,
                                   capture_output=True, text=True, timeout=20)
            self.assertNotEqual(stale.returncode, 0)
            self.assertIn('VERIFY_DEPS_BEFORE_RUN', stale.stdout + stale.stderr)
            self.assertIn('enableGlobalVirtualStore setting has changed', stale.stdout + stale.stderr)
            self.assertFalse(child_marker.exists())
            self.assertFalse((fixture / 'build-reached').exists())
            self.assertEqual(artifacts.tree_records(fixture), stale_before)
            self.assertEqual(artifacts.tree_records(store), store_before)
            for key in ['NPM_CONFIG_USERCONFIG', 'NPM_CONFIG_GLOBALCONFIG']:
                self.assertEqual(Path(environment[key]).read_text(), '')

    def test_known_task_evidence_files_are_not_source_inventory(self):
        self.assertTrue(artifacts.excluded_name('.superpowers/spec14/private.json'))
        self.assertTrue(artifacts.excluded_name('.superpowers/sdd/Spec14-Gate-A-Plan/review.md'))
        self.assertTrue(artifacts.excluded_name('.superpowers/sdd/.gitignore'))

    def test_tree_records_preserve_kind_mode_bytes_and_symlink_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = root / 'original'
            original.write_bytes(b'same bytes')
            original.chmod(0o600)
            link = root / 'link'
            link.symlink_to('original')

            records = artifacts.tree_records(root)
            self.assertEqual(records['original']['mode'], '0o600')
            self.assertEqual(records['link']['kind'], 'symlink')
            self.assertEqual(records['link']['target'], 'original')
            link.unlink()
            link.write_bytes(b'same bytes')
            self.assertNotEqual(artifacts.tree_records(root), records)

    def test_isolated_environment_omits_developer_homes_caller_path_and_source_state(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source'
            source.mkdir()
            export = Path(directory) / 'exports/export-1'
            export.mkdir(parents=True)
            runtime = {'path': '/trusted/runtime:/usr/bin:/bin'}
            with patch.object(artifacts, 'ROOT', source), \
                    patch.object(artifacts.local, 'token', return_value='synthetic-public'), \
                    patch.dict(os.environ, {
                        'PATH': str(source / 'node_modules/.bin') + ':/private/sibling/bin', 'LANG': 'C', 'HOME': '/private/home',
                        'CODEX_HOME': '/private/codex', 'PNPM_HOME': '/private/pnpm',
                        'COREPACK_HOME': '/private/corepack', 'NODE_PATH': '/private/modules',
                        'NPM_TOKEN': 'private',
                    }, clear=True):
                environment = artifacts.isolated_environment(export, runtime)

            for name in ['HOME', 'CODEX_HOME', 'PNPM_HOME', 'COREPACK_HOME', 'NODE_PATH', 'NPM_TOKEN']:
                self.assertNotIn(name, environment)
            self.assertEqual(environment['PATH'], runtime['path'])
            self.assertEqual(environment['NODE_OPTIONS'], '--no-global-search-paths')
            self.assertFalse(Path(environment['TMPDIR']).is_relative_to(source))
            self.assertTrue(Path(environment['TMPDIR']).is_relative_to(export.parent))
            for name in ['NPM_CONFIG_USERCONFIG', 'NPM_CONFIG_GLOBALCONFIG']:
                path = Path(environment[name])
                self.assertEqual(path.read_text(), '')
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_runtime_path_rejects_source_sibling_and_unpinned_pnpm(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory) / 'repository'
            root = repository / '.worktrees/task'
            source_bin = root / 'node_modules/.bin/pnpm'
            sibling_bin = repository / '.worktrees/other/node_modules/.bin/node'
            for path in [source_bin, sibling_bin]:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('runtime')
            with patch.object(artifacts, 'ROOT', root):
                for path in [source_bin, sibling_bin]:
                    with self.subTest(path=path), self.assertRaisesRegex(RuntimeError, 'runtime'):
                        artifacts.validate_runtime_path(path, path.name)

    def test_trusted_runtime_pins_owned_cached_pnpm_package_and_full_tree_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            outer = Path(directory)
            root = outer / 'repository'
            root.mkdir()
            (root / 'package.json').write_text('{"packageManager":"pnpm@11.19.0"}')
            node = outer / 'runtime/node'
            node.parent.mkdir()
            node.write_text('node')
            node.chmod(0o755)
            package = outer / 'home/.cache/node/corepack/v1/pnpm/11.19.0'
            entry = package / 'bin/pnpm.cjs'
            entry.parent.mkdir(parents=True)
            entry.write_text('pnpm')
            (package / 'package.json').write_text(json.dumps({'name': 'pnpm', 'version': '11.19.0'}))
            (package / '.corepack').write_text(json.dumps({
                'locator': {'name': 'pnpm', 'reference': '11.19.0'},
                'bin': {'pnpm': './bin/pnpm.cjs'},
                'hash': 'sha512.reviewed',
            }))
            records = artifacts.regular_tree_records(package)
            package_hash = artifacts.digest(artifacts.canonical(records))

            def command(args, **_):
                self.assertNotEqual(Path(args[0]).name, 'pnpm')
                value = 'v22.15.0\n' if args == [str(node.resolve()), '--version'] else '11.19.0\n'
                return type('Result', (), {'stdout': value})()

            with patch.object(artifacts, 'ROOT', root), \
                    patch.object(artifacts, 'user_home', return_value=outer / 'home'), \
                    patch.object(artifacts, 'PNPM_COREPACK_INTEGRITY', 'sha512.reviewed'), \
                    patch.object(artifacts, 'PNPM_PACKAGE_TREE_SHA256', package_hash), \
                    patch.object(artifacts.shutil, 'which', return_value=str(node)), \
                    patch.object(artifacts.subprocess, 'run', side_effect=command) as run:
                runtime = artifacts.trusted_runtime()

            self.assertEqual(runtime['pnpmCommand'], [str(node.resolve()), str(entry.resolve())])
            self.assertEqual(runtime['pnpmPackageSha256'], package_hash)
            self.assertEqual(run.call_count, 2)

    def test_cached_pnpm_package_rejects_symlinks_before_invocation(self):
        with tempfile.TemporaryDirectory() as directory:
            package = Path(directory) / 'pnpm'
            package.mkdir()
            (package / 'outside').write_text('payload')
            (package / 'linked').symlink_to('outside')
            with self.assertRaisesRegex(RuntimeError, 'symlink'):
                artifacts.regular_tree_records(package)

    def test_reviewed_offline_store_uses_only_fixed_owned_external_structure(self):
        with tempfile.TemporaryDirectory() as directory:
            outer = Path(directory)
            root = outer / 'source'
            root.mkdir()
            valid = outer / 'cache/store/v11'
            (valid / 'files').mkdir(parents=True)
            (valid / 'links').mkdir()
            (valid / 'index.db').write_text('index')
            projects = valid / 'projects'
            projects.mkdir()
            (projects / 'external-project').symlink_to('/private/unavailable-project')
            valid = valid.resolve()
            with patch.object(artifacts, 'ROOT', root), \
                    patch.object(artifacts, 'reviewed_store_candidates', return_value=[valid]), \
                    patch.object(artifacts.subprocess, 'run') as run:
                selected = artifacts.offline_store()
            self.assertEqual(selected, valid.resolve())
            run.assert_not_called()

            (valid / 'files').rename(valid / 'missing-files')
            with patch.object(artifacts, 'ROOT', root), \
                    patch.object(artifacts, 'reviewed_store_candidates', return_value=[valid]):
                with self.assertRaisesRegex(RuntimeError, 'offline store'):
                    artifacts.offline_store()

    def test_reviewed_store_rejects_links_outside_store_except_unread_project_registry(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Path(directory).resolve() / 'store/v11'
            files = store / 'files'
            links = store / 'links'
            projects = store / 'projects'
            files.mkdir(parents=True)
            links.mkdir()
            projects.mkdir()
            (store / 'index.db').write_text('index')
            (files / 'content').write_text('package')
            (links / 'inside').symlink_to('../files')
            (projects / 'outside').symlink_to('/private/must-not-be-traversed')
            structure = artifacts.reviewed_store_structure(store)
            self.assertEqual(structure['projectRegistryLinks'], 1)
            self.assertEqual(structure['containedLinks'], 1)

            (links / 'escaping').symlink_to('/private/escape')
            with self.assertRaisesRegex(RuntimeError, 'link leaves'):
                artifacts.reviewed_store_structure(store)

    def test_catalog_rejects_git_ignored_hidden_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inherited = root / 'inherited.json'
            inherited.write_text('{"files":{}}')
            catalog = root / 'catalog.json'
            with patch.object(artifacts, 'ROOT', root), patch.object(artifacts, 'INHERITED', inherited), \
                    patch.object(artifacts, 'CATALOG', catalog), \
                    patch.object(artifacts, 'git_inventory', return_value=['source.txt']), \
                    patch.object(artifacts, 'filesystem_inventory', return_value=['source.txt', '.hidden-runtime']), \
                    patch.object(artifacts, 'git_ignored_paths', return_value=['.hidden-runtime']):
                with self.assertRaisesRegex(RuntimeError, 'ignored hidden'):
                    artifacts.catalog_capture()
            self.assertFalse(catalog.exists())

    def test_export_path_is_outside_source_and_rejects_ancestor_modules(self):
        with tempfile.TemporaryDirectory() as directory:
            outer = Path(directory)
            root = outer / 'source/root'
            root.mkdir(parents=True)
            export = outer / 'exports/task/export-1'
            export.parent.mkdir(parents=True)

            with patch.object(artifacts, 'ROOT', root):
                artifacts.require_isolated_export_path(export)
                self.assertFalse(export.is_relative_to(root))
                (outer / 'exports/node_modules').mkdir()
                with self.assertRaisesRegex(RuntimeError, 'ancestor node_modules'):
                    artifacts.require_isolated_export_path(export)

    def test_export_directory_rejects_source_tree_before_creating_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'source'
            root.mkdir()
            unsafe = root / 'exports'
            with patch.object(artifacts, 'ROOT', root), \
                    patch.object(artifacts, 'external_export_base', return_value=unsafe):
                with self.assertRaisesRegex(RuntimeError, 'outside source ancestry'):
                    artifacts.new_export_directory()
            self.assertFalse(unsafe.exists())

    def test_clean_export_rejects_stale_task_build_before_copy_or_commands(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            catalog = state / 'catalog.json'
            catalog.write_text('{}')
            (state / 'build-identity.json').write_text(json.dumps({
                'sourceSha256': 'old', 'files': {}, 'assetsSha256': artifacts.digest(artifacts.canonical({})),
            }))
            with patch.object(artifacts, 'STATE', state), patch.object(artifacts, 'CATALOG', catalog), \
                    patch.object(artifacts, 'source_capture', return_value=({'format': 1, 'files': {}, 'deletions': []}, 'new')), \
                    patch.object(artifacts, 'tree_records', return_value={}), \
                    patch.object(artifacts.subprocess, 'run') as run:
                with self.assertRaisesRegex(RuntimeError, 'different source'):
                    artifacts.clean_export()
                run.assert_not_called()

    def test_clean_export_requires_reviewed_catalog_before_source_or_commands(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'state'
            state.mkdir()
            catalog = Path(directory) / 'missing-catalog.json'
            with patch.object(artifacts, 'STATE', state), patch.object(artifacts, 'CATALOG', catalog), \
                    patch.object(artifacts, 'source_capture') as source, patch.object(artifacts.subprocess, 'run') as run:
                with self.assertRaisesRegex(RuntimeError, 'reviewed.*catalog'):
                    artifacts.clean_export()
            source.assert_not_called()
            run.assert_not_called()
            failures = list(state.glob('clean-export-failure-*.json'))
            self.assertEqual(len(failures), 1)
            self.assertEqual(json.loads(failures[0].read_text())['stage'], 'catalog')
            self.assertEqual(stat.S_IMODE(failures[0].stat().st_mode), 0o600)

    def test_failed_attempt_invalidates_fixed_success_and_records_latest_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'state'
            state.mkdir()
            prior = {'status': 'passed', 'sourceSha256': 'prior'}
            (state / 'clean-export-result.json').write_text(json.dumps(prior))
            catalog = Path(directory) / 'missing-catalog.json'
            with patch.object(artifacts, 'STATE', state), patch.object(artifacts, 'CATALOG', catalog):
                with self.assertRaisesRegex(RuntimeError, 'reviewed.*catalog'):
                    artifacts.clean_export()

            self.assertFalse((state / 'clean-export-result.json').exists())
            preserved = list(state.glob('clean-export-result-preserved-*.json'))
            self.assertEqual(len(preserved), 1)
            self.assertEqual(json.loads(preserved[0].read_text()), prior)
            latest = json.loads((state / 'clean-export-latest.json').read_text())
            self.assertEqual(latest['status'], 'failed')
            failure = state / latest['failureFile']
            self.assertTrue(failure.is_file())
            self.assertEqual(json.loads(failure.read_text())['attemptId'], latest['attemptId'])
            with patch.object(artifacts, 'STATE', state):
                with self.assertRaisesRegex(RuntimeError, 'Latest.*passed'):
                    artifacts.verified_clean_export_result()

    def _export_fixture(self, directory):
        root = Path(directory) / 'root'
        state = root / '.superpowers/spec14'
        state.mkdir(parents=True)
        (root / 'dist').mkdir()
        (root / 'dist/index.html').write_text('built')
        source = root / 'source.txt'
        source.write_text('reviewed')
        source.chmod(0o640)
        link = root / 'source-link'
        link.symlink_to('source.txt')
        policy = root / 'pnpm-workspace.yaml'
        policy.write_bytes(b'allowBuilds:\n  deno: true\n  esbuild: true\n')
        manifest = {
            'format': 1,
            'files': {'source.txt': artifacts.describe(source), 'source-link': artifacts.describe(link),
                      'pnpm-workspace.yaml': artifacts.describe(policy)},
            'deletions': ['removed.txt'],
        }
        built = artifacts.tree_records(root / 'dist')
        (state / 'build-identity.json').write_text(json.dumps({
            'sourceSha256': 'source-sha', 'files': built,
            'assetsSha256': artifacts.digest(artifacts.canonical(built)),
        }))
        store = Path(directory) / 'store'
        store.mkdir()
        catalog = root / 'Docs/testing/spec14-source-paths.json'
        catalog.parent.mkdir(parents=True)
        catalog.write_text('{}')
        return root, state, manifest, store, catalog

    def test_clean_export_copies_only_manifest_and_preserves_deletions(self):
        with tempfile.TemporaryDirectory() as directory:
            root, state, manifest, store, catalog = self._export_fixture(directory)
            exports = Path(directory) / 'external-exports'
            runtime = {
                'nodeSha256': 'a' * 64, 'nodeVersion': 'v22.15.0',
                'path': '/trusted/runtime:/usr/bin:/bin',
                'pnpmCommand': ['/trusted/runtime/node', '/trusted/cache/pnpm.cjs'],
                'pnpmEntrySha256': 'b' * 64, 'pnpmPackageSha256': 'c' * 64,
                'pnpmCorepackIntegrity': 'sha512.reviewed', 'pnpmVersion': '11.19.0',
            }
            def command(command, cwd, stdout, **_):
                if command[-1] == 'source':
                    stdout.write('{"sourceSha256":"source-sha"}\n')
                if '--expected-source' in command:
                    files = artifacts.tree_records(Path(cwd) / 'dist')
                    assets = artifacts.digest(artifacts.canonical(files))
                    stdout.write(json.dumps({'assetsSha256': assets}) + '\n')
                if command[-1] == 'build':
                    (Path(cwd) / 'dist').mkdir()
                    (Path(cwd) / 'dist/index.html').write_text('built')
                return type('Result', (), {'returncode': 0})()
            with patch.object(artifacts, 'ROOT', root), patch.object(artifacts, 'STATE', state), patch.object(artifacts, 'CATALOG', catalog), \
                    patch.object(artifacts, 'source_capture', return_value=(manifest, 'source-sha')), \
                    patch.object(artifacts, 'selected_source', return_value=manifest), \
                    patch.object(artifacts, 'offline_store', return_value=store), \
                    patch.object(artifacts, 'trusted_runtime', return_value=runtime), \
                    patch.object(artifacts, 'external_export_base', return_value=exports), \
                    patch.object(artifacts, 'isolated_environment', return_value={'PATH': '/synthetic'}), \
                    patch.object(artifacts.subprocess, 'run', side_effect=command) as run:
                artifacts.clean_export()

            export = next(exports.glob('export-*'))
            self.assertEqual((export / 'source.txt').read_text(), 'reviewed')
            self.assertEqual(stat.S_IMODE((export / 'source.txt').stat().st_mode), 0o640)
            self.assertTrue((export / 'source-link').is_symlink())
            self.assertFalse((export / 'removed.txt').exists())
            self.assertFalse((export / 'spec14-source-manifest.json').exists())
            result = json.loads((state / 'clean-export-result.json').read_text())
            self.assertTrue(Path(result['exportDirectory']).is_relative_to(exports))
            self.assertEqual(result['status'], 'passed')
            latest = json.loads((state / 'clean-export-latest.json').read_text())
            self.assertEqual(latest['status'], 'passed')
            timestamped = json.loads((state / latest['resultFile']).read_text())
            self.assertEqual(timestamped, result)
            with patch.object(artifacts, 'STATE', state):
                self.assertEqual(artifacts.verified_clean_export_result(), result)
            self.assertEqual(run.call_count, 4)
            commands = [call.args[0] for call in run.call_args_list]
            python_commands = [command for command in commands if command[0] == artifacts.sys.executable]
            self.assertEqual(len(python_commands), 2)
            self.assertTrue(all(command[1:3] == ['-I', '-B'] for command in python_commands))
            install = next(command for command in commands if 'install' in command)
            self.assertIn('--frozen-store', install)
            self.assertTrue(all('--ignore-workspace' not in command for command in commands))
            for call in run.call_args_list:
                self.assertEqual(call.kwargs['env']['NPM_CONFIG_WORKSPACE_DIR'], str(export.resolve()))
                self.assertEqual(call.kwargs['env']['npm_config_workspace_dir'], str(export.resolve()))
            self.assertIn('--config.enable-global-virtual-store=false', install)

    @unittest.skipUnless(os.environ.get('SPEC14_RUN_PINNED_PNPM_CLI_TEST') == '1',
                         'Explicit pinned local CLI proof; empty fixture has no dependencies or lockfile')
    def test_export_install_options_pass_pinned_cli_parser_and_disable_global_virtual_store(self):
        runtime = artifacts.trusted_runtime()
        tree = ast.parse(Path(artifacts.__file__).read_text())
        install_calls = [node for node in ast.walk(tree)
                         if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                         and node.func.id == 'run_logged' and len(node.args) > 1
                         and isinstance(node.args[1], ast.List)
                         and any(isinstance(part, ast.Constant) and part.value == 'install'
                                 for part in node.args[1].elts)]
        self.assertEqual(len(install_calls), 1)
        # Read the exact production command's literal options; do not test a separately invented list.
        parts = install_calls[0].args[1].elts
        self.assertIsInstance(parts[0], ast.Starred)
        self.assertEqual(ast.unparse(parts[0].value), "runtime['pnpmCommand']")
        self.assertEqual(ast.unparse(parts[-1]), 'str(store)')
        self.assertTrue(all(isinstance(part, ast.Constant) for part in parts[1:-1]))
        options = [part.value for part in parts[1:-1]]
        self.assertNotIn('--ignore-workspace', options)
        for required in ['--offline', '--frozen-lockfile', '--frozen-store']:
            self.assertIn(required, options)
        with tempfile.TemporaryDirectory() as directory:
            outer = Path(directory)
            fixture = outer / 'fixture'
            fixture.mkdir()
            (fixture / 'package.json').write_text('{"name":"spec14-parser-proof","private":true}')
            policy = fixture / 'pnpm-workspace.yaml'
            policy.write_bytes(b'allowBuilds:\n  deno: true\n  esbuild: true\n')
            store = outer / 'unused-store/v11'
            store.mkdir(parents=True)
            (store / 'index.db').write_bytes(b'')
            store_before = artifacts.tree_records(store)
            with patch.object(artifacts.local, 'token', return_value='synthetic-public'):
                environment = artifacts.isolated_environment(fixture, runtime)
            environment = artifacts.bind_export_workspace(fixture, {'files': {'pnpm-workspace.yaml': artifacts.describe(policy)}}, environment)
            before = artifacts.tree_records(fixture)
            # A deliberately empty SQLite index must fail its read-only schema check after option parsing.
            # Writable mode would create that schema; neither index nor dependency content may change.
            parsed = subprocess.run([*runtime['pnpmCommand'], *options, str(store)],
                                    cwd=fixture, env=environment, capture_output=True, text=True, timeout=20)
            self.assertNotEqual(parsed.returncode, 0)
            self.assertIn('ERR_SQLITE_ERROR', parsed.stdout + parsed.stderr)
            self.assertIn('ReadOnlyStoreIndex.prepareStatements', parsed.stdout + parsed.stderr)
            self.assertIn('no such table: package_index', parsed.stdout + parsed.stderr)
            self.assertNotIn('Unknown option', parsed.stdout + parsed.stderr)
            config_option = next(option for option in options if 'enable-global-virtual-store' in option)
            effective = subprocess.run([*runtime['pnpmCommand'], 'config', 'get',
                                        'enable-global-virtual-store', config_option],
                                       cwd=fixture, env=environment, capture_output=True, text=True, timeout=20)
            self.assertEqual(effective.returncode, 0, effective.stderr)
            self.assertEqual(effective.stdout.strip(), 'false')
            self.assertEqual(artifacts.tree_records(fixture), before)
            self.assertEqual(artifacts.tree_records(store), store_before)
            self.assertEqual(Path(environment['NPM_CONFIG_USERCONFIG']).read_text(), '')
            self.assertEqual(Path(environment['NPM_CONFIG_GLOBALCONFIG']).read_text(), '')
            self.assertNotIn('HOME', environment)
            self.assertNotIn('PNPM_HOME', environment)

    def test_export_workspace_policy_is_exact_local_and_rejects_indirection_or_changes(self):
        policy_bytes = b'allowBuilds:\n  deno: true\n  esbuild: true\n'
        for change in ['valid', 'missing', 'unlisted', 'unsupported', 'symlink', 'stale', 'directory-symlink']:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                parent = Path(directory)
                export = parent / 'export'
                export.mkdir()
                policy = export / 'pnpm-workspace.yaml'
                policy.write_bytes(policy_bytes)
                manifest = {'files': {'pnpm-workspace.yaml': artifacts.describe(policy)}}
                if change == 'missing': policy.unlink()
                elif change == 'unlisted': manifest['files'].clear()
                elif change == 'unsupported':
                    policy.write_bytes(policy_bytes + b'  unexpected: true\n')
                    manifest['files']['pnpm-workspace.yaml'] = artifacts.describe(policy)
                elif change == 'symlink':
                    outside = parent / 'outside.yaml'
                    outside.write_bytes(policy_bytes)
                    policy.unlink(); policy.symlink_to(outside)
                elif change == 'stale': policy.write_bytes(policy_bytes.replace(b'true', b'false'))
                elif change == 'directory-symlink':
                    alias = parent / 'alias'; alias.symlink_to(export, target_is_directory=True); export = alias
                environment = {'PATH': '/trusted', 'NPM_CONFIG_WORKSPACE_DIR': '/hostile',
                               'npm_config_workspace_dir': '/other-hostile'}
                if change != 'valid':
                    with self.assertRaisesRegex(RuntimeError, 'workspace'):
                        artifacts.bind_export_workspace(export, manifest, environment)
                else:
                    bound = artifacts.bind_export_workspace(export, manifest, environment)
                    self.assertEqual(bound['NPM_CONFIG_WORKSPACE_DIR'], str(export.resolve()))
                    self.assertEqual(bound['npm_config_workspace_dir'], str(export.resolve()))
                    self.assertEqual(environment['NPM_CONFIG_WORKSPACE_DIR'], '/hostile')

    @unittest.skipUnless(os.environ.get('SPEC14_RUN_PINNED_PNPM_CLI_TEST') == '1',
                         'Explicit pinned local CLI configuration read; no install')
    def test_pinned_cli_reads_only_export_workspace_policy_despite_hostile_parent_and_caller(self):
        runtime = artifacts.trusted_runtime()
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            (parent / 'pnpm-workspace.yaml').write_text('allowBuilds:\n  hostile: true\n')
            export = parent / 'export'; export.mkdir()
            (export / 'package.json').write_text('{"name":"spec14-workspace-proof","private":true}')
            policy = export / 'pnpm-workspace.yaml'
            policy.write_bytes(b'allowBuilds:\n  deno: true\n  esbuild: true\n')
            manifest = {'files': {'pnpm-workspace.yaml': artifacts.describe(policy)}}
            with patch.object(artifacts.local, 'token', return_value='synthetic-public'), \
                    patch.dict(os.environ, {'NPM_CONFIG_WORKSPACE_DIR': str(parent),
                                            'npm_config_workspace_dir': str(parent)}):
                environment = artifacts.isolated_environment(export, runtime)
            self.assertNotIn('NPM_CONFIG_WORKSPACE_DIR', environment)
            self.assertNotIn('npm_config_workspace_dir', environment)
            environment = artifacts.bind_export_workspace(export, manifest, environment)
            before = artifacts.tree_records(export)
            result = subprocess.run([*runtime['pnpmCommand'], 'config', 'get', 'allowBuilds', '--json'],
                                    cwd=export, env=environment, capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), {'deno': True, 'esbuild': True})
            # Pinned explicit location remains local even from a nested working directory.
            nested = export / 'nested'; nested.mkdir()
            result = subprocess.run([*runtime['pnpmCommand'], 'config', 'get', 'allowBuilds', '--json'],
                                    cwd=nested, env=environment, capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), {'deno': True, 'esbuild': True})
            nested.rmdir()
            self.assertEqual(artifacts.tree_records(export), before)
            self.assertEqual(Path(environment['NPM_CONFIG_USERCONFIG']).read_text(), '')
            self.assertEqual(Path(environment['NPM_CONFIG_GLOBALCONFIG']).read_text(), '')

    def test_clean_export_rechecks_original_source_dist_and_build_identity_before_pass(self):
        for drift in ['source', 'dist', 'build-identity']:
            with self.subTest(drift=drift), tempfile.TemporaryDirectory() as directory:
                root, state, manifest, store, catalog = self._export_fixture(directory)
                exports = Path(directory) / 'external-exports'
                runtime = {
                    'nodeSha256': 'a' * 64, 'nodeVersion': 'v22.15.0',
                    'path': '/trusted/runtime:/usr/bin:/bin',
                    'pnpmCommand': ['/trusted/runtime/node', '/trusted/cache/pnpm.cjs'],
                    'pnpmEntrySha256': 'b' * 64, 'pnpmPackageSha256': 'c' * 64,
                    'pnpmCorepackIntegrity': 'sha512.reviewed', 'pnpmVersion': '11.19.0',
                }
                changed = {**manifest, 'deletions': manifest['deletions'] + ['late.txt']}

                def command(command, cwd, stdout, **_):
                    if command[-1] == 'source':
                        stdout.write('{"sourceSha256":"source-sha"}\n')
                    if command[-1] == 'build':
                        (Path(cwd) / 'dist').mkdir()
                        (Path(cwd) / 'dist/index.html').write_text('built')
                    if '--expected-source' in command:
                        files = artifacts.tree_records(Path(cwd) / 'dist')
                        stdout.write(json.dumps({'assetsSha256': artifacts.digest(artifacts.canonical(files))}) + '\n')
                        if drift == 'dist':
                            (root / 'dist/index.html').write_text('drifted')
                        if drift == 'build-identity':
                            (state / 'build-identity.json').write_text(json.dumps({'sourceSha256': 'other', 'files': {}}))
                    return type('Result', (), {'returncode': 0})()

                source_checks = [manifest, changed] if drift == 'source' else [manifest, manifest]
                with patch.object(artifacts, 'ROOT', root), patch.object(artifacts, 'STATE', state), patch.object(artifacts, 'CATALOG', catalog), \
                        patch.object(artifacts, 'source_capture', return_value=(manifest, 'source-sha')), \
                        patch.object(artifacts, 'selected_source', side_effect=source_checks), \
                        patch.object(artifacts, 'offline_store', return_value=store), \
                        patch.object(artifacts, 'trusted_runtime', return_value=runtime), \
                        patch.object(artifacts, 'external_export_base', return_value=exports), \
                        patch.object(artifacts, 'isolated_environment', return_value={'PATH': '/synthetic'}), \
                        patch.object(artifacts.subprocess, 'run', side_effect=command):
                    with self.assertRaisesRegex(RuntimeError, 'changed|differs'):
                        artifacts.clean_export()

                self.assertFalse((state / 'clean-export-result.json').exists())
                latest = json.loads((state / 'clean-export-latest.json').read_text())
                self.assertEqual(latest['status'], 'failed')
                failure = json.loads((state / latest['failureFile']).read_text())
                self.assertEqual(failure['stage'], 'final-task-recheck')

    def test_clean_export_rejects_source_inventory_change_before_install(self):
        with tempfile.TemporaryDirectory() as directory:
            root, state, manifest, store, catalog = self._export_fixture(directory)
            exports = Path(directory) / 'external-exports'
            changed = {**manifest, 'deletions': manifest['deletions'] + ['late.txt']}
            with patch.object(artifacts, 'ROOT', root), patch.object(artifacts, 'STATE', state), patch.object(artifacts, 'CATALOG', catalog), \
                    patch.object(artifacts, 'source_capture', return_value=(manifest, 'source-sha')), \
                    patch.object(artifacts, 'selected_source', return_value=changed), \
                    patch.object(artifacts, 'offline_store', return_value=store), \
                    patch.object(artifacts, 'external_export_base', return_value=exports), \
                    patch.object(artifacts.subprocess, 'run') as run:
                with self.assertRaisesRegex(RuntimeError, 'inventory changed'):
                    artifacts.clean_export()
                run.assert_not_called()

    def test_clean_export_rechecks_ancestor_modules_before_install(self):
        with tempfile.TemporaryDirectory() as directory:
            root, state, manifest, store, catalog = self._export_fixture(directory)
            exports = Path(directory) / 'external-exports'

            def source_recheck():
                (exports / 'node_modules').mkdir()
                return manifest

            with patch.object(artifacts, 'ROOT', root), patch.object(artifacts, 'STATE', state), patch.object(artifacts, 'CATALOG', catalog), \
                    patch.object(artifacts, 'source_capture', return_value=(manifest, 'source-sha')), \
                    patch.object(artifacts, 'selected_source', side_effect=source_recheck), \
                    patch.object(artifacts, 'offline_store', return_value=store), \
                    patch.object(artifacts, 'external_export_base', return_value=exports), \
                    patch.object(artifacts.subprocess, 'run') as run:
                with self.assertRaisesRegex(RuntimeError, 'ancestor node_modules'):
                    artifacts.clean_export()
                run.assert_not_called()

    def test_standalone_catalog_ignores_parent_git_and_rejects_extra_source(self):
        with tempfile.TemporaryDirectory() as directory:
            outer = Path(directory)
            root = outer / 'export'
            docs = root / 'Docs/testing'
            docs.mkdir(parents=True)
            inherited = docs / 'spec14-inherited-source.json'
            inherited.write_text(json.dumps({'files': {'removed.txt': {'kind': 'deleted'}}}))
            (root / 'source.txt').write_text('reviewed')
            catalog = docs / 'spec14-source-paths.json'
            paths = ['Docs/testing/spec14-inherited-source.json', 'Docs/testing/spec14-source-paths.json', 'source.txt']
            catalog.write_text(json.dumps({'format': 1, 'paths': paths, 'deletions': ['removed.txt']}))

            def git(command, **_):
                return type('Result', (), {'returncode': 0, 'stdout': str(outer) + '\n'})()

            with patch.object(artifacts, 'ROOT', root), patch.object(artifacts, 'INHERITED', inherited), \
                    patch.object(artifacts, 'CATALOG', catalog), patch.object(artifacts.subprocess, 'run', side_effect=git):
                self.assertIsNone(artifacts.git_inventory())
                self.assertEqual(sorted(artifacts.selected_source()['files']), paths)
                (root / 'unreviewed.txt').write_text('extra')
                with self.assertRaisesRegex(RuntimeError, 'differ from reviewed path catalog'):
                    artifacts.selected_source()

    def test_build_capture_rejects_source_changed_during_build(self):
        with patch.object(artifacts, 'source_capture', return_value=({}, 'after')), \
                patch.object(artifacts, 'tree_records') as records:
            with self.assertRaisesRegex(RuntimeError, 'Source changed while building'):
                artifacts.build_capture('before')
            records.assert_not_called()

    def test_build_records_reject_any_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'index.html').write_text('built')
            (root / 'linked.js').symlink_to('index.html')
            with self.assertRaisesRegex(RuntimeError, 'symlink'):
                artifacts.build_tree_records(root)

    def test_failed_child_stage_keeps_private_log(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / 'child.log'

            def failed(_command, stdout, **_):
                stdout.write('private child diagnostic\n')
                return type('Result', (), {'returncode': 7})()

            with patch.object(artifacts.subprocess, 'run', side_effect=failed):
                with self.assertRaisesRegex(RuntimeError, 'standalone-source'):
                    artifacts.run_logged('standalone-source', ['tool'], Path(directory), {}, log)
            self.assertEqual(log.read_text(), 'private child diagnostic\n')
            self.assertEqual(stat.S_IMODE(log.stat().st_mode), 0o600)

    def test_cli_sanitizes_unexpected_manifest_shape_errors(self):
        stderr = io.StringIO()
        with patch.object(artifacts, 'main', side_effect=KeyError('private manifest key')), redirect_stderr(stderr):
            self.assertEqual(artifacts.cli(), 1)
        self.assertEqual(stderr.getvalue(), 'Spec14 artifact operation stopped; inspect private task evidence for the recorded stage.\n')
        self.assertNotIn('private manifest key', stderr.getvalue())
        self.assertNotIn('Traceback', stderr.getvalue())


if __name__ == '__main__':
    unittest.main()
