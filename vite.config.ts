import react from '@vitejs/plugin-react'
import { loadEnv, type Plugin } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'
import { browserEnvKeys, selectBrowserEnv } from './src/config/browserEnv.ts'

function developmentCspBypass(): Plugin {
  return {
    name: 'development-csp-bypass',
    apply: 'serve',
    transformIndexHtml: (html) => html.replace(
      /\s*<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]+"\s*\/>/i,
      '',
    ),
  }
}

export default defineConfig(({ mode }) => {
  const browserEnv = selectBrowserEnv(loadEnv(mode, '.', ''))

  return {
    envPrefix: [],
    define: Object.fromEntries(
      browserEnvKeys.map((key) => [`import.meta.env.${key}`, JSON.stringify(browserEnv[key] ?? '')]),
    ),
    plugins: [developmentCspBypass(), react()],
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      exclude: [
        ...configDefaults.exclude,
        'supabase/functions/**',
        'tests/integration/**',
        'tests/e2e/**',
      ],
      globals: false,
    },
  }
})
