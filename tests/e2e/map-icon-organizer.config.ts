import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

// This opt-in proof never uses the shared E2E runner or a hosted database.
export default defineConfig({
  testDir: '.', testMatch: 'map-icon-organizer.spec.ts',
  outputDir: `../../test-results/icon-library-phase4/${Date.now()}`,
  workers: 1, fullyParallel: false, retries: 0, timeout: 360000,
  reporter: [['line']],
  use: { baseURL: 'http://127.0.0.1:3014', viewport: { width: 1440, height: 900 }, contextOptions: { reducedMotion: 'reduce' }, trace: 'off', screenshot: 'off' },
  webServer: {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    command: 'node tests/e2e/support/startIconLibraryProof.mjs',
    url: 'http://127.0.0.1:3014', reuseExistingServer: false, timeout: 180000,
  },
})
