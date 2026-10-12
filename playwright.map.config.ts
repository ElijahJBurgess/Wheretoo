import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'living-map-context.spec.ts',
  outputDir: 'test-results/e2e-map',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [['line']],
  use: { baseURL: 'http://127.0.0.1:3010', screenshot: 'off', trace: 'off', video: 'off' },
  webServer: {
    command: 'pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 3010',
    url: 'http://127.0.0.1:3010/map',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: 'https://map-disabled.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'map-disabled',
      VITE_MAPBOX_ACCESS_TOKEN: process.env.VITE_MAPBOX_ACCESS_TOKEN ?? '',
      VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_map_disabled',
    },
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 } },
  ],
})
