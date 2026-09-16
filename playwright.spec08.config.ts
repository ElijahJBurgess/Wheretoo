import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'spec08.spec.ts', workers: 1, fullyParallel: false, timeout: 30000,
  outputDir: 'test-results/spec08', reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:3028', viewport: { width: 390, height: 844 }, trace: 'off', video: 'off', screenshot: 'off' },
  webServer: { command: 'pnpm exec vite preview --host 127.0.0.1 --port 3028 --strictPort', url: 'http://127.0.0.1:3028', reuseExistingServer: false, timeout: 30000 },
})
