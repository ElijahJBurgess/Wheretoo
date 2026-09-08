import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /ticket-(?:experience-shells|shell-privacy).*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://127.0.0.1:3000/tickets/wh_test_collection_paid',
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_ticket_shells_disabled',
      VITE_MAPBOX_ACCESS_TOKEN: 'ticket-shells-disabled',
      VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_ticket_shells_disabled',
    },
  },
  projects: [
    {
      name: 'shell-mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'shell-tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 768, height: 1024 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'shell-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
  ],
})
