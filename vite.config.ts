import react from '@vitejs/plugin-react'
import { loadEnv, type Plugin } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'
import { browserEnvKeys, selectBrowserEnv } from './src/config/browserEnv.js'

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

export function selectTicketExperienceEntry(html: string, command: 'serve' | 'build') {
  return command === 'serve'
    ? html.replace('/src/main.tsx', '/src/main.development.tsx')
    : html
}

function ticketExperienceEntry(command: 'serve' | 'build'): Plugin {
  return {
    name: 'ticket-experience-entry',
    transformIndexHtml: (html) => selectTicketExperienceEntry(html, command),
  }
}

export default defineConfig(({ command, mode }) => {
  const browserEnv = selectBrowserEnv(loadEnv(mode, '.', ''))

  return {
    envPrefix: [],
    define: {
      ...Object.fromEntries(
        browserEnvKeys.map((key) => [`import.meta.env.${key}`, JSON.stringify(browserEnv[key] ?? '')]),
      ),
      'import.meta.env.VITE_SCREEN_PREVIEW_ENABLED': JSON.stringify(
        mode === 'development' || process.env.VERCEL_ENV === 'preview' || process.env.WHERETOO_ENABLE_PREVIEW === '1',
      ),
    },
    plugins: [developmentCspBypass(), ticketExperienceEntry(command), react()],
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
