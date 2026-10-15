import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  testDir: '.', testMatch: 'map-integration.spec.ts',
  outputDir: '../../test-results/map-main-integration',
  workers: 1, retries: 0, timeout: 420000, reporter: [['line']],
  use: { baseURL: 'http://127.0.0.1:3017', viewport: { width: 1440, height: 900 }, actionTimeout: 30000, navigationTimeout: 30000, contextOptions: { reducedMotion: 'reduce' }, trace: 'off', screenshot: 'only-on-failure' },
  webServer: process.env.COMBINED_PREVIEW_ALREADY_RUNNING === '1' ? undefined : { cwd: fileURLToPath(new URL('../..', import.meta.url)), command: 'node tests/e2e/support/startCombinedMapProof.mjs',
    url: 'http://127.0.0.1:3017', reuseExistingServer: false, timeout: 200000 },
})
