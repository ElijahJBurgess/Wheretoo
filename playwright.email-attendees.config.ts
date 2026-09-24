import { defineConfig } from '@playwright/test'
import { readFileSync } from 'node:fs'
const fixture = JSON.parse(readFileSync('.superpowers/email-proof/browser.json', 'utf8')) as { anon: string }
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'email-attendees.spec.ts', workers: 1, timeout: 60_000,
  outputDir: 'test-results/email-attendees', reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:3077', viewport: { width: 390, height: 844 }, trace: 'off', screenshot: 'off', contextOptions: { reducedMotion: 'reduce' } },
  webServer: [{
    command: 'pnpm dlx deno run --allow-env --allow-read=.superpowers/email-proof/browser.json --allow-net=127.0.0.1:61321,127.0.0.1:61330 tests/integration/edge/email-attendees/local.ts --serve',
    url: 'http://127.0.0.1:61330/health', reuseExistingServer: false, timeout: 60_000,
  }, {
    command: 'pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 3077 --strictPort',
    url: 'http://127.0.0.1:3077', reuseExistingServer: false, timeout: 120_000,
    env: { VITE_SUPABASE_URL: 'https://email-proof-local.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: fixture.anon, VITE_MAPBOX_ACCESS_TOKEN: 'email-proof-disabled', VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_email_proof_disabled' },
  }],
})
