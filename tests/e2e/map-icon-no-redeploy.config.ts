import { defineConfig } from '@playwright/test'

// Start the guarded baseline launcher exactly once BEFORE publication. This
// proof has no webServer hook and can never trigger a build on test retry.
export default defineConfig({
  testDir: '.', testMatch: 'map-icon-no-redeploy.spec.mjs',
  outputDir: `../../test-results/icon-library-phase5b/browser-${Date.now()}`,
  workers: 1, retries: 0, timeout: 360000, reporter: [['line']],
  use: { baseURL: 'http://127.0.0.1:3015', viewport: { width: 1440, height: 900 },
    contextOptions: { reducedMotion: 'reduce' }, trace: 'off', screenshot: 'off' },
})
