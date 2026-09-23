"""Manage only the dedicated local AI-cover proof stack; never reads a linked project."""
import base64
import struct
import zlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
LOCAL = ROOT / '.supabase/ai-cover'
PROJECT = 'wheretoo-ai-cover-phase1'
CLI = ['corepack', 'pnpm@11.19.0', 'exec', 'supabase']

def prepare():
    target = LOCAL / 'supabase'
    target.mkdir(parents=True, exist_ok=True)
    config = (ROOT / 'supabase/config.toml').read_text().replace('543', '563')
    config = re.sub(r'project_id = "[^"]+"', f'project_id = "{PROJECT}"', config)
    config = re.sub(r'(\[db.seed\][^[]*?)enabled = true', r'\1enabled = false', config)
    config = re.sub(r'(\[analytics\]\s*\n)enabled = true', r'\1enabled = false', config)
    config = config[:config.index('[functions.')] + ''.join(f'\n[functions.{name}]\nverify_jwt = false\nimport_map = "../deno.json"\n' for name in ['event-images','event-cover-generation'])
    (target / 'config.toml').write_text(config)
    migrations = target / 'migrations'
    if not migrations.exists():
        migrations.symlink_to(ROOT / 'supabase/migrations', target_is_directory=True)
    files = {'event-images': ['index.ts', 'imageBytes.ts', 'coverMutation.ts'], '_shared': ['database.ts', 'env.ts'], 'event-cover-generation':['index.ts','provider.ts','candidateStorage.ts']}
    for folder, names in files.items():
        dest = target / 'functions' / folder
        dest.mkdir(parents=True, exist_ok=True)
        for name in names:
            shutil.copy2(ROOT / 'supabase/functions' / folder / name, dest / name)
    generation = target / 'functions/event-cover-generation'
    (generation / 'index.ts').rename(generation / 'handler.ts')
    shutil.copy2(ROOT / 'tests/integration/ai-cover-provider-mock.ts.template', generation / 'index.ts')
    def fixture(color):
        def chunk(kind, data):
            return struct.pack('!I',len(data))+kind+data+struct.pack('!I',zlib.crc32(kind+data))
        image = b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!IIBBBBB',1024,1280,8,2,0,0,0))+chunk(b'IDAT',zlib.compress((b'\x00'+bytes(color)*1024)*1280))+chunk(b'IEND',b'')
        return base64.b64encode(image).decode()
    (generation / 'fixtures.json').write_text(json.dumps([fixture(c) for c in [(30,80,180),(160,60,120),(20,130,100)]]))
    (LOCAL / 'deno.json').write_text(json.dumps({'imports': {'@supabase/supabase-js': 'npm:@supabase/supabase-js@2.112.3'}}))
    (LOCAL / 'functions.env').write_text('APP_BASE_URL=http://127.0.0.1:3050\n')

command = sys.argv[1] if len(sys.argv) == 2 else ''
if command not in ('start', 'reset', 'serve', 'test', 'stop'):
    raise SystemExit('Usage: python3 tests/integration/run-ai-cover-local.py start|reset|serve|test|stop')
prepare()
assert f'project_id = "{PROJECT}"' in (LOCAL / 'supabase/config.toml').read_text()
if command == 'start':
    subprocess.run(CLI + ['start', '--workdir', str(LOCAL), '--exclude', 'studio,imgproxy,logflare,vector,supavisor,inbucket'], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    print('Local AI-cover stack ready on 127.0.0.1:56321. No keys printed.')
elif command == 'reset':
    subprocess.run(CLI + ['db', 'reset', '--local', '--workdir', str(LOCAL), '--yes'], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
elif command == 'serve':
    subprocess.run(CLI + ['functions', 'serve', '--workdir', str(LOCAL), '--env-file', str(LOCAL / 'functions.env'), '--no-verify-jwt'], cwd=ROOT, check=True)
elif command == 'stop':
    subprocess.run(CLI + ['stop', '--workdir', str(LOCAL)], cwd=ROOT, check=True)
else:
    for name in ['ai_event_cover.test.sql', 'spec15_event_images.test.sql','ai_cover_generation.test.sql']:
        result = subprocess.run(['docker', 'exec', '-i', 'supabase_db_' + PROJECT, 'psql', '-X', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], input=(ROOT / 'supabase/tests/database' / name).read_text(), text=True, capture_output=True, check=True)
        if 'not ok ' in result.stdout:
            raise SystemExit(result.stdout)
        print(name + ': ' + next(line for line in result.stdout.splitlines() if line.startswith('1..')))
    subprocess.run([sys.executable, str(ROOT / 'tests/integration/ai-cover-storage.py')], cwd=ROOT, check=True)

    subprocess.run([sys.executable, str(ROOT / 'tests/integration/ai-cover-generation.py')], cwd=ROOT, check=True)
