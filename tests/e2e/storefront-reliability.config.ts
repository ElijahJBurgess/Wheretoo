import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: '.', testMatch: 'storefront-reliability.spec.ts',
  outputDir: '../../test-results/storefront-reliability', workers: 1, retries: 0,
  reporter: [['line']],
  use: { baseURL: 'http://127.0.0.1:3091', contextOptions: { reducedMotion: 'reduce' }, launchOptions: { args: ['--no-proxy-server'] } },
  webServer: {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    command: 'pnpm exec vite --host 127.0.0.1 --port 3091 --strictPort',
    url: 'http://127.0.0.1:3091/auth/sign-in', reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: 'http://127.0.0.1:57321', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_storefront_local_fixture', VITE_MAPBOX_ACCESS_TOKEN: 'storefront-local-fixture', VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_storefront_local_fixture' },
  },
})
