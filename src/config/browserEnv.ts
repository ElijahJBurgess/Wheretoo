export const browserEnvKeys = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_MAPBOX_ACCESS_TOKEN',
  'VITE_STRIPE_PUBLISHABLE_KEY',
] as const

type BrowserEnvKey = (typeof browserEnvKeys)[number]
type EnvironmentSource = Readonly<Record<string, string | undefined>>

export function requireTestStripePublishableKey(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Missing VITE_STRIPE_PUBLISHABLE_KEY')
  }

  if (!value.startsWith('pk_test_')) {
    throw new Error('Invalid VITE_STRIPE_PUBLISHABLE_KEY')
  }

  return value
}

export function selectBrowserEnv(source: EnvironmentSource): Partial<Record<BrowserEnvKey, string>> {
  return Object.fromEntries(
    browserEnvKeys.flatMap((key) => {
      const value = source[key]

      if (value === undefined) {
        return []
      }

      return [[key, key === 'VITE_STRIPE_PUBLISHABLE_KEY' ? requireTestStripePublishableKey(value) : value]]
    }),
  ) as Partial<Record<BrowserEnvKey, string>>
}
