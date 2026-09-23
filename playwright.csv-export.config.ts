import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'csv-export.spec.ts', workers: 1, timeout: 45_000,
  outputDir: 'test-results/csv-export', reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:3036', viewport: { width: 390, height: 844 }, trace: 'off', video: 'off', screenshot: 'off' },
  webServer: {
    command: 'node_modules/.bin/vite build --outDir .superpowers/csv-export/browser-dist --manifest && node_modules/.bin/vite preview --outDir .superpowers/csv-export/browser-dist --host 127.0.0.1 --port 3036 --strictPort',
    url: 'http://127.0.0.1:3036', reuseExistingServer: false, timeout: 60_000,
    env: { VITE_SUPABASE_URL: 'https://csv-local.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_csv_local', VITE_MAPBOX_ACCESS_TOKEN: 'csv-disabled', VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_csv_disabled' },
  },
})
