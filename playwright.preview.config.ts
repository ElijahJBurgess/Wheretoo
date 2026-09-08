import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'preview-integration.spec.ts',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3012', trace: 'off', video: 'off', screenshot: 'off' },
  webServer: {
    command: 'WHERETOO_ENABLE_PREVIEW=1 pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 3012 --strictPort',
    url: 'http://127.0.0.1:3012/preview',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
