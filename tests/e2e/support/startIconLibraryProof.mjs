import { execFileSync, spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { loadEnv } from 'vite'
import { iconLibraryEnvironment } from './iconLibraryEnvironment.mjs'

if (!realpathSync('.').endsWith('/.worktrees/wheretoo-v1-map')) throw new Error('Wrong proof worktree')
if (execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim() !== 'codex/wheretoo-v1-map') throw new Error('Wrong proof branch')
const status = await iconLibraryEnvironment()
const local = loadEnv('development', '.', '')
const env = { ...process.env, VITE_SUPABASE_URL: status.API_URL, VITE_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY, VITE_MAPBOX_ACCESS_TOKEN: local.VITE_MAPBOX_ACCESS_TOKEN, VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_icon_library_unused' }
execFileSync('pnpm', ['build'], { env, stdio: 'inherit', timeout: 150000 })
const child = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '3014', '--strictPort'], { env, stdio: 'inherit' })
child.on('exit', code => process.exit(code ?? 1))
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal))
