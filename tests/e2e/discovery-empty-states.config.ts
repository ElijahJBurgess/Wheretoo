import { defineConfig } from '@playwright/test'
const baseURL = process.env.WHERETOO_MAP_PERFORMANCE_BASE_URL ?? 'http://127.0.0.1:3114'
if (!['http://127.0.0.1:3114', 'https://wheretoo-staging.vercel.app'].includes(baseURL)) throw new Error('Unexpected empty-state verification target')
export default defineConfig({
  testDir: '.', testMatch: 'discovery-empty-states.spec.ts', workers: 1, retries: 0, timeout: 60000,
  outputDir: '../../test-results/discovery-empty-states', reporter: [['line']],
  use: { channel: 'chrome', headless: false, baseURL, screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
})
