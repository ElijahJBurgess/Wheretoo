import { defineConfig } from '@playwright/test'
export default defineConfig({
  globalTeardown: './tests/e2e/support/spec07Teardown.ts',
  globalSetup: './tests/e2e/support/spec07Setup.ts',
  testDir: './tests/e2e', testMatch: 'spec07.spec.ts', workers: 1, fullyParallel: false, timeout: 60000,
  outputDir: 'test-results/spec07', reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:3027', viewport: { width: 390, height: 844 }, trace: 'off', video: 'off', screenshot: 'off' },
  webServer: [
    { command: 'python3 tests/integration/spec09-services.py && pnpm exec deno run --allow-env --allow-read=.superpowers/spec08-spec09 --allow-run=docker --allow-net=127.0.0.1:55506,127.0.0.1:55517 tests/integration/edge/spec07-local/index.ts', url: 'http://127.0.0.1:55517/health', reuseExistingServer: false, timeout: 60000 },
    { command: 'pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 3027', url: 'http://127.0.0.1:3027', reuseExistingServer: false, timeout: 120000,
      env: { VITE_SUPABASE_URL: 'https://spec09-local.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_spec09_local', VITE_MAPBOX_ACCESS_TOKEN: 'spec07-disabled', VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_spec07_disabled' } },
  ],
})
