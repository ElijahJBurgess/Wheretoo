import { defineConfig } from '@playwright/test'
const configured = process.env.SPEC11_CONFIGURED_FIXTURE === '1'
export default defineConfig({
  testDir: './tests/e2e', testMatch: configured ? 'spec11-configured.spec.ts' : 'spec11.spec.ts', workers: 1, fullyParallel: false, timeout: 90000,
  outputDir: 'test-results/spec11', reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:3031', viewport: { width: 390, height: 844 }, trace: 'off', video: 'off', screenshot: 'off' },
  webServer: { command: 'pnpm exec vite preview --host 127.0.0.1 --port 3031 --strictPort' + (configured ? ' --outDir /tmp/wheretoo-spec10-spec11-configured' : ''), url: 'http://127.0.0.1:3031', reuseExistingServer: false, timeout: 30000 },
})
