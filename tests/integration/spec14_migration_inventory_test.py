"""An approved forward migration must not admit altered or unlisted SQL."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('migration_runner', Path(__file__).with_name('spec14-local.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class MigrationInventoryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / 'supabase/migrations').mkdir(parents=True)
        (self.root / 'Docs/testing').mkdir(parents=True)
        self.baseline = 'supabase/migrations/20260917010100_existing.sql'
        self.forward = 'supabase/migrations/20260918010100_guard_incomplete_moderation_jobs.sql'
        self.write_sql(self.baseline, 'select 1;\n')
        self.baseline_manifest = self.root / 'Docs/testing/spec14-inherited-migrations.json'
        self.baseline_manifest.write_text(json.dumps({self.baseline: self.digest(self.baseline)}))
        self.approved_manifest = self.root / 'Docs/testing/spec14-approved-forward-migrations.json'
        self.root_patch = patch.object(runner, 'ROOT', self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)

    def write_sql(self, name, content='select 2;\n'):
        (self.root / name).write_text(content)

    def digest(self, name):
        return hashlib.sha256((self.root / name).read_bytes()).hexdigest()

    def approval(self, entries=None):
        entry = {'path': self.forward, 'sha256': self.digest(self.forward), 'approvalId': 'spec14-moderation-input-2026-09-15'}
        value = {
            'format': 1,
            'baselineManifestSha256': hashlib.sha256(self.baseline_manifest.read_bytes()).hexdigest(),
            'migrations': entries if entries is not None else [entry],
        }
        self.approved_manifest.write_text(json.dumps(value))
        return value

    def selected(self):
        return [str(path.relative_to(self.root)) for path in runner.migration_files()]

    def test_baseline_without_forward_approval_still_works(self):
        self.assertEqual(self.selected(), [self.baseline])

    def test_extra_sql_without_approval_is_rejected(self):
        self.write_sql(self.forward)
        with self.assertRaises(RuntimeError):
            self.selected()

    def test_approved_exact_forward_appends_after_unchanged_baseline(self):
        self.write_sql(self.forward)
        self.approval()
        self.assertEqual(self.selected(), [self.baseline, self.forward])

    def test_changed_historical_or_forward_bytes_are_rejected(self):
        self.write_sql(self.forward)
        self.approval()
        for name in [self.baseline, self.forward]:
            original = (self.root / name).read_bytes()
            with self.subTest(name=name):
                self.write_sql(name, 'select 99;\n')
                with self.assertRaises(RuntimeError):
                    self.selected()
            (self.root / name).write_bytes(original)

    def test_changed_baseline_manifest_is_rejected_even_if_sql_matches_it(self):
        self.write_sql(self.forward)
        self.approval()
        self.write_sql(self.baseline, 'select 99;\n')
        self.baseline_manifest.write_text(json.dumps({self.baseline: self.digest(self.baseline)}))
        with self.assertRaises(RuntimeError):
            self.selected()

    def test_approval_cannot_replace_or_repeat_a_historical_path(self):
        self.write_sql(self.forward)
        self.approval([{'path': self.baseline, 'sha256': self.digest(self.baseline), 'approvalId': 'duplicate-base'}])
        with self.assertRaises(RuntimeError):
            self.selected()

    def test_duplicate_or_non_appended_forward_order_is_rejected(self):
        self.write_sql(self.forward)
        entry = self.approval()['migrations'][0]
        self.approval([entry, entry])
        with self.assertRaises(RuntimeError):
            self.selected()
        earlier = 'supabase/migrations/20260916010000_earlier.sql'
        self.write_sql(earlier)
        self.approval([{'path': earlier, 'sha256': self.digest(earlier), 'approvalId': 'not-a-forward'}, entry])
        with self.assertRaises(RuntimeError):
            self.selected()

    def test_same_timestamp_as_historical_migration_is_not_an_append(self):
        self.write_sql(self.forward)
        same_time = 'supabase/migrations/20260917010100_z_later_name.sql'
        self.write_sql(same_time)
        self.approval([{'path': same_time, 'sha256': self.digest(same_time), 'approvalId': 'same-timestamp'}])
        with self.assertRaises(RuntimeError):
            self.selected()

    def test_malformed_or_unlisted_approval_cannot_admit_sql(self):
        self.write_sql(self.forward)
        valid = self.approval()
        variants = [
            {**valid, 'format': 2},
            {**valid, 'format': True},
            {**valid, 'extra': True},
            {**valid, 'migrations': [{**valid['migrations'][0], 'path': '../outside.sql'}]},
            {**valid, 'migrations': [{**valid['migrations'][0], 'sha256': 'invalid'}]},
            {**valid, 'migrations': [{**valid['migrations'][0], 'approvalId': ''}]},
            {**valid, 'migrations': []},
        ]
        for value in variants:
            with self.subTest(value=value):
                self.approved_manifest.write_text(json.dumps(value))
                with self.assertRaises(RuntimeError):
                    self.selected()

    def test_forward_entries_must_be_in_ascending_order(self):
        self.write_sql(self.forward)
        later = 'supabase/migrations/20260919010000_later.sql'
        self.write_sql(later)
        first = {'path': self.forward, 'sha256': self.digest(self.forward), 'approvalId': 'first'}
        second = {'path': later, 'sha256': self.digest(later), 'approvalId': 'second'}
        self.approval([first, second])
        self.assertEqual(self.selected(), [self.baseline, self.forward, later])
        self.approval([second, first])
        with self.assertRaises(RuntimeError):
            self.selected()

    def test_migration_symlinks_are_rejected_even_for_matching_bytes(self):
        source = self.root / self.baseline
        target = self.root / 'outside.sql'
        target.write_bytes(source.read_bytes())
        source.unlink()
        source.symlink_to(target)
        with self.assertRaises(RuntimeError):
            self.selected()


if __name__ == '__main__':
    unittest.main()
