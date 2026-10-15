import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
const target = process.env.WHERETOO_MAP_STARTUP_BASE_URL ?? 'http://127.0.0.1:3112'
if (!['http://127.0.0.1:3112', 'https://wheretoo-staging.vercel.app'].includes(target)) throw new Error('Unexpected map startup proof target')
export default defineConfig({
  testDir: '.', testMatch: 'map-startup.spec.ts', workers: 1, retries: 0, timeout: 90000,
  outputDir: '../../test-results/map-startup', reporter: [['line']],
  use: { baseURL: target, trace: 'off', video: 'off', screenshot: 'off' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 720 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: target.startsWith('http://127.') ? {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    command: 'pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 3112 --strictPort',
    url: `${target}/map`, reuseExistingServer: false, timeout: 180000,
  } : undefined,
})
