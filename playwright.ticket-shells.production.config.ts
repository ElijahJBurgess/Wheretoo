import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['ticket-shell-production.spec.ts'],
  fullyParallel: false,
  workers: 1,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:3001',
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
  webServer: {
    command: 'pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 3001',
    url: 'http://127.0.0.1:3001/tickets/sentinel-collection-bearer',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: 'https://ticket-shells-disabled.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_ticket_shells_disabled',
      VITE_MAPBOX_ACCESS_TOKEN: 'ticket-shells-disabled',
      VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_ticket_shells_disabled',
    },
  },
})
