import { defineConfig, devices } from '@playwright/test'
import { loadE2EEnv } from './tests/e2e/support/e2eEnv'

const env = loadE2EEnv()

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [['line']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    contextOptions: { reducedMotion: 'reduce' },
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://127.0.0.1:3000/auth/sign-in',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: env.supabaseUrl,
      VITE_SUPABASE_PUBLISHABLE_KEY: env.supabasePublishableKey,
      VITE_MAPBOX_ACCESS_TOKEN: env.mapboxAccessToken,
      VITE_STRIPE_PUBLISHABLE_KEY: env.stripePublishableKey,
    },
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
})
