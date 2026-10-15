import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
export const project = 'wheretoo-map-integration-20261007'
export const API_URL = 'http://127.0.0.1:64321'
export const APP_URL = 'http://127.0.0.1:3017'
export const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] })
export async function combinedMapEnvironment() {
  assert.equal(execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(), 'codex/wheretoo-map-integration')
  const names = docker(['ps', '--format', '{{.Names}}']).trim().split('\n')
  for (const service of ['db', 'kong', 'rest', 'auth', 'storage']) assert(names.includes(`supabase_${service}_${project}`), `Missing combined ${service}`)
  for (const [service, inner, outer] of [['db', '5432/tcp', '64322'], ['kong', '8000/tcp', '64321']]) {
    const container = JSON.parse(docker(['inspect', `supabase_${service}_${project}`]))[0]
    assert(container.NetworkSettings.Ports[inner]?.some(port => port.HostPort === outer), 'Wrong combined port binding')
  }
  docker(['exec', `supabase_db_${project}`, 'pg_isready', '-U', 'postgres'])
  const config = docker(['exec', `supabase_kong_${project}`, 'cat', '/home/kong/kong.yml'])
  const key = role => config.match(/eyJ[A-Za-z0-9_.-]+/g)?.find(token => {
    try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).role === role } catch { return false }
  })
  const ANON_KEY = key('anon'), SERVICE_KEY = key('service_role')
  assert(ANON_KEY && SERVICE_KEY, 'Combined local credentials unavailable')
  const response = await fetch(`${API_URL}/rest/v1/`, { headers: { apikey: ANON_KEY }, signal: AbortSignal.timeout(10000) })
  assert(response.ok, `Combined API health ${response.status}`)
  const migrations = docker(['exec', `supabase_db_${project}`, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAtc', "select count(*) from supabase_migrations.schema_migrations where version like '20261007010%'"])
  assert.equal(migrations.trim(), '5', 'Combined schema is incomplete')
  return { API_URL, ANON_KEY, SERVICE_KEY }
}
