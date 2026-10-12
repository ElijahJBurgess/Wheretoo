import { execFileSync } from 'node:child_process'

// Read only this explicitly named local stack. Never ask the CLI to enumerate
// other projects, persist credentials, or fall back to a hosted environment.
export async function iconLibraryEnvironment() {
  const docker = (args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] })
  const names = docker(['ps', '--format', '{{.Names}}']).trim().split('\n')
  for (const service of ['db', 'kong', 'rest', 'auth', 'storage']) {
    if (!names.includes(`supabase_${service}_wheretoo-icon-library`)) throw new Error(`Missing isolated ${service} container`)
  }
  const db = JSON.parse(docker(['inspect', 'supabase_db_wheretoo-icon-library']))[0]
  const kong = JSON.parse(docker(['inspect', 'supabase_kong_wheretoo-icon-library']))[0]
  if (!db.NetworkSettings.Ports['5432/tcp']?.some(p => p.HostPort === '56322')
    || !kong.NetworkSettings.Ports['8000/tcp']?.some(p => p.HostPort === '56321')) throw new Error('Wrong isolated port bindings')
  docker(['exec', 'supabase_db_wheretoo-icon-library', 'pg_isready', '-U', 'postgres'])
  const config = docker(['exec', 'supabase_kong_wheretoo-icon-library', 'cat', '/home/kong/kong.yml'])
  const ANON_KEY = config.match(/eyJ[A-Za-z0-9_.-]+/g)?.find(token => {
    try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).role === 'anon' } catch { return false }
  })
  if (!ANON_KEY) throw new Error('Isolated anonymous API credential unavailable')
  const API_URL = 'http://127.0.0.1:56321'
  const response = await fetch(`${API_URL}/rest/v1/`, { headers: { apikey: ANON_KEY }, signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error(`Isolated PostgREST health failed: ${response.status}`)
  return { API_URL, ANON_KEY }
}
