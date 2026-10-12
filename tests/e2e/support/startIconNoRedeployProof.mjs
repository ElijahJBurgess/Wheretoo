import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { loadEnv } from 'vite'
import { iconLibraryEnvironment } from './iconLibraryEnvironment.mjs'
import { buildDirectory, buildIdentity, evidenceRoot, manifest, sourceIdentity } from './phase5bIdentity.mjs'

assert(realpathSync('.').endsWith('/.worktrees/wheretoo-v1-map'))
assert.equal(execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(), 'codex/wheretoo-v1-map')
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), '0122e6d9dbf0bf5a50c1d6c2d5da6d3808b88c94')
assert(!existsSync(buildDirectory), 'Baseline already exists: do not rebuild after publication')
const local = await iconLibraryEnvironment()
const beforeSource = sourceIdentity(), priorDist = manifest(['dist'])
mkdirSync(evidenceRoot, { recursive: true })
const localEnv = loadEnv('development', '.', '')
const env = { ...process.env, VITE_SUPABASE_URL: local.API_URL, VITE_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY,
  VITE_MAPBOX_ACCESS_TOKEN: localEnv.VITE_MAPBOX_ACCESS_TOKEN, VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_icon_library_unused' }
execFileSync('pnpm', ['build', '--outDir', buildDirectory], { env, stdio: 'inherit', timeout: 150000 })
assert.deepEqual(sourceIdentity(), beforeSource)
const baseline = { createdAt: new Date().toISOString(), head: '0122e6d9dbf0bf5a50c1d6c2d5da6d3808b88c94', source: beforeSource, priorDist, build: buildIdentity() }
writeFileSync(`${evidenceRoot}/baseline.json`, JSON.stringify(baseline, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ baselineBuildHash: baseline.build.hash, sourceHash: baseline.source.hash }))
const child = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '3015', '--strictPort', '--outDir', buildDirectory], { env, stdio: 'inherit' })
child.on('exit', code => process.exit(code ?? 1))
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal))
