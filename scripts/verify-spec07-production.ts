import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(join(directory, entry.name)) : [join(directory, entry.name)])
}
const forbidden = [
  'RESEND_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'TICKET_CREDENTIAL_SECRET',
  'TICKET_EMAIL_WORKER_SECRET', 'TICKET_EMAIL_PAYLOAD_KEYS_JSON', 'TICKET_EMAIL_RATE_SECRET',
  'wheretoo:email-payload:v1', 'api.resend.com/emails', 'spec07-disposable-only',
  'spec07-local-only-jwt', 'ticket_email_outbox', 'server_begin_ticket_email_dispatch',
]
const artifacts = files('dist').filter(file => /\.(?:js|html|json|css)$/.test(file))
if (artifacts.length === 0) throw new Error('No production artifacts found')
for (const file of artifacts) {
  const content = readFileSync(file, 'utf8')
  for (const value of forbidden) {
    if (content.includes(value)) throw new Error(`Server-only marker in ${file}: ${value}`)
  }
}
console.log(`Spec 07 production boundary passed: ${artifacts.length} artifacts; no server secrets, sender, worker, or fixture markers.`)
