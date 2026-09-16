import { execFileSync } from 'node:child_process'
export default function teardown() {
  execFileSync('python3', ['tests/integration/spec08-spec09-database.py', 'sql'], {
    input: 'update private.ticket_email_settings set enabled_at=null,worker_enabled=false,limits=null;',
    stdio: ['pipe', 'inherit', 'inherit'],
  })
}
