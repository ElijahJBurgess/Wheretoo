import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'spec12-shared-states.spec.ts',
  outputDir: 'test-results/spec12-shared-states',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [['line']],
  use: {
    baseURL: 'http://127.0.0.1:31212',
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 31212 --strictPort',
    url: 'http://127.0.0.1:31212/preview/shared-states',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
