import { defineConfig, devices } from '@playwright/test'

// Read-only smoke checks against an already running development or preview server.
// This file uses a separate match so the credentialed transaction suite is unchanged.
export default defineConfig({
  testDir: '.',
  testMatch: 'public-routes.smoke.ts',
  outputDir: '../../test-results/public-routes',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 15_000 },
  reporter: [['line']],
  use: {
    baseURL: process.env.WHERETO_SMOKE_BASE_URL ?? 'http://127.0.0.1:3000',
    contextOptions: { reducedMotion: 'reduce' },
    screenshot: 'off',
    trace: 'off',
    video: 'off',
    launchOptions: { args: ['--no-proxy-server'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
})
