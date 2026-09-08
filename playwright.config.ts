import { defineConfig, devices } from '@playwright/test'
import { loadE2EEnv, loadModerationE2EEnv, loadTask18E2EEnv } from './tests/e2e/support/e2eEnv'

const moderationProfile = process.env.WHERETO_E2E_PROFILE === 'moderation'
const browserEnv = moderationProfile
  ? (() => {
      const env = loadModerationE2EEnv()
      return {
        supabaseUrl: env.supabaseUrl,
        supabasePublishableKey: env.supabasePublishableKey,
        // The moderation inventory never visits or invokes either integration.
        mapboxAccessToken: 'task16-mapbox-disabled',
        stripePublishableKey: 'pk_test_task16_disabled',
      }
    })()
  : process.env.WHERETO_E2E_PROFILE === 'ticketing' ? loadTask18E2EEnv() : loadE2EEnv()

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
    command: 'pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 3000',
    url: 'http://127.0.0.1:3000/auth/sign-in',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: browserEnv.supabaseUrl,
      VITE_SUPABASE_PUBLISHABLE_KEY: browserEnv.supabasePublishableKey,
      VITE_MAPBOX_ACCESS_TOKEN: browserEnv.mapboxAccessToken,
      VITE_STRIPE_PUBLISHABLE_KEY: browserEnv.stripePublishableKey,
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
