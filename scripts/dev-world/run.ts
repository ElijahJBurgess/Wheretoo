import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { loadEnv } from 'vite'
import { assertDevelopmentTarget, renderSeedSql } from './world'
import { demoEvents } from '../../src/preview/devWorldCatalog'

// Capture output rather than forwarding provider errors, keys, or account payloads.
function cli(args: string[]) {
  try { return execFileSync('pnpm', ['exec', 'supabase', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 }) }
  catch (error) {
    const output = (error as { stdout?: string }).stdout ?? ''
    const code = output.match(/"code":\s*"([A-Za-z0-9_]+)"/)?.[1] ?? 'unknown'
    throw new Error(`WORLD_CLI_FAILED:${args.slice(0, 2).join(':')}:${code}`, { cause: error })
  }
}
function query(sql: string): Record<string, unknown>[] {
  const data = JSON.parse(cli(['db', 'query', '--linked', '--output-format', 'json', sql]))
  if (!Array.isArray(data.rows)) throw new Error('WORLD_DATABASE_RESPONSE_INVALID')
  return data.rows
}
async function run() {
  const mode = process.argv[2]
  if (mode !== 'seed' && mode !== 'reset') throw new Error('Use dev:seed or dev:reset')
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') throw new Error('WORLD_PRODUCTION_FORBIDDEN')
  const env = loadEnv('development', process.cwd(), '')
  for (const [key, value] of Object.entries({ ...env, ...process.env })) {
    if (/STRIPE/.test(key) && typeof value === 'string' && /^(sk|rk|pk)_live_/.test(value)) throw new Error('WORLD_LIVE_KEY_FORBIDDEN')
  }
  const projectRef = readFileSync('supabase/.temp/project-ref', 'utf8').trim()
  assertDevelopmentTarget({ projectRef, url: env.VITE_SUPABASE_URL, key: env.VITE_STRIPE_PUBLISHABLE_KEY, environment: 'development', connectedAccount: env.TEST_CONNECTED_ACCOUNT_ID })
  const [state] = query("select (select environment from private.organizer_policy_release_settings where singleton_id) as environment, (select max(version) from supabase_migrations.schema_migrations) as migration_head")
  assertDevelopmentTarget({ projectRef, url: env.VITE_SUPABASE_URL, key: env.VITE_STRIPE_PUBLISHABLE_KEY, environment: String(state.environment), connectedAccount: env.TEST_CONNECTED_ACCOUNT_ID })
  const migrations = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).map(f => f.split('_')[0]).sort()
  const remoteMigrations = query('select version from supabase_migrations.schema_migrations order by version').map(r => r.version)
  if (JSON.stringify(migrations) !== JSON.stringify(remoteMigrations)) throw new Error('WORLD_MIGRATIONS_NOT_ALIGNED')
  const functions = JSON.parse(cli(['functions', 'list', '--project-ref', projectRef, '--output', 'json']))
  const list: { slug: string; status: string }[] = functions.functions ?? functions
  for (const slug of ['stripe-create-checkout', 'stripe-webhook', 'order-confirmation', 'ticket-collection', 'ticket-admission']) {
    if (!list.some(f => f.slug === slug && f.status === 'ACTIVE')) throw new Error('WORLD_RUNTIME_FUNCTION_MISSING')
  }
  const name = 'dev-world-probe'
  const materialized = `supabase/functions/${name}`
  if (existsSync(materialized) || list.some(f => f.slug === name)) throw new Error('WORLD_PROBE_ALREADY_EXISTS')
  const secretList: { name: string }[] = JSON.parse(cli(['secrets', 'list', '--project-ref', projectRef, '--output', 'json']))
  if (secretList.some(s => s.name === 'DEV_WORLD_PROBE_TOKEN')) throw new Error('WORLD_PROBE_SECRET_ALREADY_EXISTS')
  const temp = mkdtempSync(join(tmpdir(), 'wheretoo-dev-world-'))
  let materializedCreated = false
  let secretAttempted = false
  let deployAttempted = false
  let priorOrigin: string | undefined
  let originChanged = false
  let seeded = false
  try {
    const token = randomBytes(32).toString('base64url')
    writeFileSync(join(temp, 'probe.env'), `DEV_WORLD_PROBE_TOKEN=${token}\n`, { mode: 0o600 })
    mkdirSync(materialized)
    materializedCreated = true
    writeFileSync(`${materialized}/index.ts`, readFileSync('tests/integration/edge/dev-world-probe/index.ts', 'utf8').replaceAll('../../../../supabase/functions/', '../'))
    secretAttempted = true
    cli(['secrets', 'set', '--env-file', join(temp, 'probe.env'), '--project-ref', projectRef])
    deployAttempted = true
    cli(['functions', 'deploy', name, '--project-ref', projectRef, '--no-verify-jwt', '--use-api', '--import-map', 'deno.json'])
    const response = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-dev-world-token': token, apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify({ account: env.TEST_CONNECTED_ACCOUNT_ID }), signal: AbortSignal.timeout(60_000),
    })
    const proof = await response.json()
    if (!response.ok || proof.ready !== true || proof.test !== true) throw new Error('WORLD_EXISTING_TEST_ACCOUNT_NOT_READY')
    console.log('Existing Stripe TEST account verified; no account created or retired.')
    // This changes only the already-verified development project's redirect origin.
    if (typeof proof.appBaseUrl !== 'string' || !/^https?:\/\/[^\s\r\n=]+$/.test(proof.appBaseUrl)) throw new Error('WORLD_PRIOR_ORIGIN_INVALID')
    priorOrigin = proof.appBaseUrl
    if (mode === 'seed' && proof.appBaseUrl !== 'http://127.0.0.1:3000') {
      const [other] = query("select count(*) as count from public.events where organizer_id <> '8ad057c1-f7b1-4aec-90cb-260908000001' and admission_type = 'paid' and status = 'published' and publicly_authorized_action_id is not null")
      if (Number(other.count) !== 0) throw new Error('WORLD_OTHER_PUBLISHED_PAID_EVENT')
      originChanged = true
      writeFileSync(join(temp, 'origin.env'), 'APP_BASE_URL=http://127.0.0.1:3000\n', { mode: 0o600 })
      cli(['secrets', 'set', '--env-file', join(temp, 'origin.env'), '--project-ref', projectRef])
    }
    const rows = query(renderSeedSql(env.TEST_CONNECTED_ACCOUNT_ID, mode))
    if (rows.length !== demoEvents.length) throw new Error('WORLD_EVENT_COUNT_MISMATCH')
    seeded = true
    console.log(`${mode}: ${rows.length} stable events ready. Existing records reused; orders, tickets and audit history retained.`)
    console.log('Preview: http://127.0.0.1:3000/preview')
    console.log(`Buyer: http://127.0.0.1:3000/events/${demoEvents[0].id}`)
  } finally {
    const cleanupErrors: string[] = []
    if (originChanged && !seeded && priorOrigin) {
      try {
        writeFileSync(join(temp, 'restore.env'), `APP_BASE_URL=${priorOrigin}\n`, { mode: 0o600 })
        cli(['secrets', 'set', '--env-file', join(temp, 'restore.env'), '--project-ref', projectRef])
      } catch { cleanupErrors.push('prior application origin') }
    }
    if (deployAttempted) { try {
      const remaining = JSON.parse(cli(['functions', 'list', '--project-ref', projectRef, '--output', 'json']))
      if ((remaining.functions ?? remaining).some((f: { slug: string }) => f.slug === name)) cli(['functions', 'delete', name, '--project-ref', projectRef, '--yes'])
    } catch { cleanupErrors.push('temporary function') } }
    if (secretAttempted) { try { cli(['secrets', 'unset', 'DEV_WORLD_PROBE_TOKEN', '--project-ref', projectRef, '--yes']) } catch { cleanupErrors.push('temporary secret') } }
    if (materializedCreated) rmSync(materialized, { recursive: true, force: true })
    rmSync(temp, { recursive: true, force: true })
    // Cleanup failure must override success: leaving a privileged helper is not a successful seed.
    // eslint-disable-next-line no-unsafe-finally
    if (cleanupErrors.length) throw new Error(`WORLD_CLEANUP_REQUIRED: ${cleanupErrors.join(', ')}`)
  }
}
run().catch(error => { console.error(error instanceof Error ? error.message : 'WORLD_SETUP_FAILED'); process.exitCode = 1 })
