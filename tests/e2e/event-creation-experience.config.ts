import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'
const fixture = JSON.parse(readFileSync(new URL('../../.superpowers/public-availability/browser-fixtures.json', import.meta.url), 'utf8')) as { api: string; anon: string }
if (fixture.api !== 'http://127.0.0.1:59521') throw new Error('Dedicated local fixture required')
export default defineConfig({
 testDir: '.', testMatch: 'event-creation-experience.spec.ts', outputDir: '../../test-results/event-creation-experience', workers: 1, retries: 0,
 reporter: [['line']], timeout: 60000,
 use: { baseURL: 'http://127.0.0.1:3094', contextOptions: { reducedMotion: 'reduce' }, launchOptions: { args: ['--no-proxy-server'] } },
 webServer: { cwd: fileURLToPath(new URL('../..', import.meta.url)), command: 'pnpm exec vite --host 127.0.0.1 --port 3094 --strictPort', url: 'http://127.0.0.1:3094/auth/sign-in', reuseExistingServer: false,
 env: { VITE_SUPABASE_URL: fixture.api, VITE_SUPABASE_PUBLISHABLE_KEY: fixture.anon, VITE_MAPBOX_ACCESS_TOKEN: 'local-disabled', VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_local_disabled' } },
})
