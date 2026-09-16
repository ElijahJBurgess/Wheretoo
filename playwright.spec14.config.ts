import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'spec14.spec.ts',
  outputDir: '.superpowers/spec14/playwright',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600_000,
  expect: { timeout: 40_000 },
  reporter: [['./tests/e2e/spec14-reporter.ts']],
  use: {
    baseURL: 'http://127.0.0.1:3040',
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
    screenshot: 'off', trace: 'off', video: 'off',
  },
  // Start is explicit; tests never reset or silently replace a running environment.
})
