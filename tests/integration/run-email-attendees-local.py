#!/usr/bin/env python3
"""Manage only disposable Email Attendees proof stacks. Never reads a linked project."""
from pathlib import Path
import argparse
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
BASELINE = '8138cdf2d6f84ff98d7ca42b595a9f87f9f7b66a'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('command', choices=['prepare', 'start', 'reset', 'stop'])
parser.add_argument('--baseline', action='store_true')
args = parser.parse_args()
name = 'email-attendees-baseline' if args.baseline else 'email-attendees'
project = 'wheretoo-' + name
local = ROOT / '.supabase' / name
config_dir = local / 'supabase'
config_dir.mkdir(parents=True, exist_ok=True)
port_prefix = '623' if args.baseline else '613'
config = (ROOT / 'supabase/config.toml').read_text().replace('543', port_prefix)
config = re.sub(r'project_id = "[^"]+"', f'project_id = "{project}"', config)
config = re.sub(r'(\[db.seed\][^[]*?)enabled = true', r'\1enabled = false', config)
config = re.sub(r'(\[analytics\]\s*\n)enabled = true', r'\1enabled = false', config)
# Serve injected functions separately: CLI startup scans extensionless renderer mappings.
config = config.split('[functions.', 1)[0]
(config_dir / 'config.toml').write_text(config)
map_file = local / 'deno.json'
if map_file.is_symlink():
    map_file.unlink()
map_file.write_text(json.dumps({'imports': {'@supabase/supabase-js': 'npm:@supabase/supabase-js@2.112.3'}}))
migrations = config_dir / 'migrations'
if args.baseline:
    migrations.mkdir(exist_ok=True)
    paths = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', BASELINE, 'supabase/migrations'], cwd=ROOT, text=True).splitlines()
    expected = {Path(path).name for path in paths}
    actual = {path.name for path in migrations.iterdir()}
    if actual - expected:
        raise SystemExit('Baseline directory contains unexpected migrations; preserve it and inspect manually.')
    for path in paths:
        (migrations / Path(path).name).write_bytes(subprocess.check_output(['git', 'show', BASELINE + ':' + path], cwd=ROOT))
elif not migrations.exists():
    migrations.symlink_to(ROOT / 'supabase/migrations', target_is_directory=True)
assert f'project_id = "{project}"' in (config_dir / 'config.toml').read_text()
cli = ['pnpm', 'exec', 'supabase']
if args.command == 'start':
    subprocess.run(cli + ['start', '--workdir', str(local), '--exclude', 'studio,imgproxy,logflare,vector,supavisor,inbucket,realtime,edge-runtime'], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
elif args.command == 'reset':
    subprocess.run(cli + ['db', 'reset', '--local', '--workdir', str(local), '--yes'], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
elif args.command == 'stop':
    subprocess.run(cli + ['stop', '--workdir', str(local)], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
if args.command in ('start', 'reset'):
    subprocess.run(['docker', 'exec', 'supabase_db_' + project, 'psql', '-X', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', "select cron.alter_job(jobid,active:=false) from cron.job;"], check=True, stdout=subprocess.DEVNULL)
if args.command == 'reset':
    (local / '.proof-fixtures-present').unlink(missing_ok=True)
print(f'{args.command}: {project}; local API {port_prefix}21 / DB {port_prefix}22. No provider activation.')
