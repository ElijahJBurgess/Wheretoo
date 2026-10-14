import { defineConfig } from '@playwright/test'

// Isolated browser fixtures exercise the production routes without contacting Stripe.
export default defineConfig({
  testDir: '.',
  testMatch: 'organizer-onboarding.spec.ts',
  outputDir: '../../test-results/organizer-onboarding',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['line']],
  use: { baseURL: 'http://127.0.0.1:3000', contextOptions: { reducedMotion: 'reduce' }, launchOptions: { args: ['--no-proxy-server'] } },
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 3000 --strictPort',
    url: 'http://127.0.0.1:3000/auth/sign-up',
    reuseExistingServer: !process.env.CI,
    env: { VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_onboarding_fixture', VITE_MAPBOX_ACCESS_TOKEN: 'onboarding-disabled', VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_onboarding_fixture' },
  },
})
