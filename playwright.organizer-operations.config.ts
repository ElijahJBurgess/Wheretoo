import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['organizer-operations.spec.ts', 'organizer-qr.spec.ts'],
  workers: 1,
  fullyParallel: false,
  timeout: 90000,
  outputDir: 'test-results/organizer-operations',
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:3012',
    viewport: { width: 1440, height: 1000 },
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'off',
    video: 'off',
  },
  webServer: [{
    command: 'pnpm exec deno run --allow-env --allow-net=127.0.0.1:55436,127.0.0.1:55437 tests/integration/edge/organizer-local-admission/index.ts',
    url: 'http://127.0.0.1:55437/health',
    reuseExistingServer: false,
  }, {
    command: 'pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 3012',
    url: 'http://127.0.0.1:3012/auth/sign-in',
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      VITE_SUPABASE_URL: 'https://ops-local.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_ops_local',
      VITE_MAPBOX_ACCESS_TOKEN: 'ops-local-disabled',
      VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_ops_local_disabled',
    },
  }],
})
