import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'organizer-profile-live.spec.ts',
  outputDir: '../../test-results/organizer-profile-live',
  workers: 1,
  retries: 0,
  reporter: [['line']],
  use: { baseURL: 'http://127.0.0.1:3085', launchOptions: { args: ['--no-proxy-server'] } },
})
