"""Replay impacted SQL suites on the dedicated local duplicate stack (or baseline).
No URLs/linked projects accepted. A failure exit is intentional while old suites
still assume service-role table grants or superseded schema contracts.
"""
from pathlib import Path
import argparse
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--baseline', action='store_true', help='Use separately provisioned local baseline stack, without duplicate migration')
args = parser.parse_args()
project = 'wheretoo-duplicate-baseline' if args.baseline else 'wheretoo-duplicate-event'
database = 'supabase_db_' + project
label = 'baseline-sql' if args.baseline else 'sql'
output = ROOT / '.duplicate-proof'
output.mkdir(exist_ok=True)
migrations = ROOT / ('.supabase/duplicate-baseline/supabase/migrations' if args.baseline else 'supabase/migrations')
if not migrations.is_dir():
    raise SystemExit('Dedicated baseline migration directory is missing')
remote = '/tmp/duplicate-event-regression'
subprocess.run(['docker', 'exec', database, 'mkdir', '-p', remote + '/tests', remote + '/migrations'], check=True)
for local, destination in [(ROOT / 'supabase/tests', '/tests'), (migrations, '/migrations')]:
    subprocess.run(['docker', 'cp', str(local) + '/.', database + ':' + remote + destination], check=True)
patterns = ['organizers_events*sql', 'publish_event*sql', 'ticketing*sql', 'checkout_boundaries*sql', 'checkout_integrity*sql',
            'inventory_reservations*sql', 'payment_fulfillment*sql', 'refunds_disputes*sql', 'core_ticket_truth_lite*sql',
            'free_registration*sql', 'moderation*sql', 'draft_without_publication_policy*sql', 'spec05*sql', 'spec09*sql',
            'spec10*sql', 'spec15*sql', 'ai_*sql', 'storefront*sql', 'organizer_csv_export*sql']
if not args.baseline:
    patterns.append('duplicate_event*sql')
files = sorted({p for pattern in patterns for p in (ROOT / 'supabase/tests/database').glob(pattern)})
results = []
for file in files:
    # Test BEGIN is nested harmlessly; its ROLLBACK restores the scheduler/policy fixture too.
    setup = "begin; select private.configure_policy_environment('development'); select cron.alter_job(jobid,active:=true) from cron.job;\n"
    result = subprocess.run(['docker', 'exec', '-i', database, 'psql', '-X', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
                            input=setup + '\\i ' + remote + '/tests/database/' + file.name + '\n', text=True, capture_output=True)
    (output / (label + '-' + file.name + '.log')).write_text(result.stdout + result.stderr)
    results.append({'file': file.name, 'pass': result.returncode == 0 and 'not ok ' not in result.stdout,
                    'assertions': sum(line.startswith('ok ') for line in result.stdout.splitlines())})
(output / (label + '-regression-results.json')).write_text(json.dumps(results, indent=2) + '\n')
summary = {'suites': len(results), 'passed': sum(item['pass'] for item in results),
           'assertions': sum(item['assertions'] for item in results), 'failed': [item['file'] for item in results if not item['pass']]}
print(json.dumps(summary, indent=2))
raise SystemExit(1 if summary['failed'] else 0)
