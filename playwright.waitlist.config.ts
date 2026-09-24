import { defineConfig } from '@playwright/test'
import { readFileSync } from 'node:fs'
const fixture = JSON.parse(readFileSync('.superpowers/waitlist-proof/browser.json', 'utf8')) as { anon: string }
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'waitlist.spec.ts', workers: 1, timeout: 60_000,
  outputDir: 'test-results/waitlist', reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:3088', viewport: { width: 390, height: 844 }, trace: 'off', screenshot: 'off', contextOptions: { reducedMotion: 'reduce' } },
  webServer: [{
    command: 'pnpm exec deno run --allow-env --allow-read=.superpowers/waitlist-proof/browser.json --allow-net=127.0.0.1:63321,127.0.0.1:63330 tests/integration/edge/waitlist/local.ts --serve',
    url: 'http://127.0.0.1:63330/health', reuseExistingServer: false, timeout: 60_000,
  }, {
    command: 'pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 3088 --strictPort',
    url: 'http://127.0.0.1:3088', reuseExistingServer: false, timeout: 120_000,
    env: { VITE_SUPABASE_URL: 'https://waitlist-proof-local.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: fixture.anon, VITE_MAPBOX_ACCESS_TOKEN: 'waitlist-proof-disabled', VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_email_proof_disabled' },
  }],
})
