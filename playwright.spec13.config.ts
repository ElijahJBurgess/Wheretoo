import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e', testMatch: 'spec13.spec.ts', workers: 1, fullyParallel: false, timeout: 45_000,
  outputDir: 'test-results/spec13', reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:3034', viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Tokyo', trace: 'off', video: 'off', screenshot: 'off' },
  webServer: {
    command: 'pnpm exec vite build --outDir .superpowers/spec13/browser-dist --manifest && pnpm exec vite preview --outDir .superpowers/spec13/browser-dist --host 127.0.0.1 --port 3034 --strictPort',
    url: 'http://127.0.0.1:3034', reuseExistingServer: false, timeout: 60_000,
    env: { WHERETOO_ENABLE_PREVIEW: '1', VITE_SUPABASE_URL: 'https://spec13-local.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_spec13_local', VITE_MAPBOX_ACCESS_TOKEN: 'spec13-disabled', VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_spec13_disabled' },
  },
})
