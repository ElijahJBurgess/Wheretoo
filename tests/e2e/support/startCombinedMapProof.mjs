import { execFileSync, spawn } from 'node:child_process'
import { loadEnv } from 'vite'
import { combinedMapEnvironment } from './combinedMapEnvironment.mjs'
const local = await combinedMapEnvironment()
const token = loadEnv('development', '.', '').VITE_MAPBOX_ACCESS_TOKEN
if (!token?.startsWith('pk.')) throw new Error('A public Mapbox token is required')
const env = { ...process.env, VITE_SUPABASE_URL: local.API_URL, VITE_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY,
  VITE_MAPBOX_ACCESS_TOKEN: token, VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_combined_unused' }
execFileSync('pnpm', ['build'], { env, stdio: 'inherit', timeout: 180000 })
const child = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '3017', '--strictPort'], { env, stdio: 'inherit' })
child.on('exit', code => process.exit(code ?? 1))
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal))
