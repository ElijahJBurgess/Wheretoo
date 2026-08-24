import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { browserEnvKeys, selectBrowserEnv } from './src/config/browserEnv.ts'

export default defineConfig(({ mode }) => {
  const browserEnv = selectBrowserEnv(loadEnv(mode, '.', ''))

  return {
    envPrefix: [],
    define: Object.fromEntries(
      browserEnvKeys.map((key) => [`import.meta.env.${key}`, JSON.stringify(browserEnv[key] ?? '')]),
    ),
    plugins: [react()],
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      globals: false,
    },
  }
})
