import { defineConfig } from '@playwright/test'
const target = process.env.WHERETOO_MAP_PERFORMANCE_BASE_URL ?? 'http://127.0.0.1:3114'
if (!['http://127.0.0.1:3114', 'https://wheretoo-staging.vercel.app'].includes(target)) throw new Error('Unexpected map verification target')
export default defineConfig({
  testDir: '.', testMatch: 'map-performance.spec.ts', workers: 1, retries: 0, timeout: 90000,
  outputDir: '../../test-results/map-performance', reporter: [['line']],
  use: { baseURL: target, trace: 'off', video: 'off', screenshot: 'off', deviceScaleFactor: 1 },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 720 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
})
