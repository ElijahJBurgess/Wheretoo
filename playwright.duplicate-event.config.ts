import { defineConfig } from '@playwright/test'
import { readFileSync } from 'node:fs'
const fixture = JSON.parse(readFileSync('.duplicate-proof/browser-fixture.json', 'utf8')) as { anon: string }
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'duplicate-event.spec.ts', workers: 1, timeout: 45_000,
  outputDir: 'test-results/duplicate-event', reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:3067', viewport: { width: 390, height: 844 }, trace: 'off', screenshot: 'off' },
  webServer: {
    command: 'node_modules/.bin/vite --host 127.0.0.1 --port 3067 --strictPort',
    url: 'http://127.0.0.1:3067', reuseExistingServer: false, timeout: 60_000,
    env: { VITE_SUPABASE_URL: 'https://duplicate-local.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: fixture.anon, VITE_MAPBOX_ACCESS_TOKEN: 'duplicate-disabled', VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_duplicate_disabled' },
  },
})
