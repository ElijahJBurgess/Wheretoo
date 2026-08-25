export const browserEnvKeys = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_MAPBOX_ACCESS_TOKEN',
  'VITE_STRIPE_PUBLISHABLE_KEY',
] as const

type BrowserEnvKey = (typeof browserEnvKeys)[number]
type EnvironmentSource = Readonly<Record<string, string | undefined>>

export function selectBrowserEnv(source: EnvironmentSource): Partial<Record<BrowserEnvKey, string>> {
  return Object.fromEntries(
    browserEnvKeys.flatMap((key) => {
      const value = source[key]

      return value === undefined ? [] : [[key, value]]
    }),
  ) as Partial<Record<BrowserEnvKey, string>>
}
