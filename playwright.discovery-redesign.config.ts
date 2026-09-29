import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e', testMatch: 'discovery-redesign.spec.ts', workers: 1,
  timeout: 30_000, outputDir: 'test-results/discovery-redesign', reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:3042', viewport: { width: 1440, height: 1080 }, timezoneId: 'America/Los_Angeles', trace: 'off' },
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 3042 --strictPort',
    url: 'http://127.0.0.1:3042', reuseExistingServer: false,
    env: { WHERETOO_ENABLE_PREVIEW: '1', VITE_SUPABASE_URL: 'https://discovery-local.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_discovery_local', VITE_MAPBOX_ACCESS_TOKEN: 'disabled-local', VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_disabled_local' },
  },
})
