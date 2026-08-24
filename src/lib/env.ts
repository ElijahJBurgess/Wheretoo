export type PublicEnv = {
  supabaseUrl: string
  supabasePublishableKey: string
  mapboxAccessToken: string
}

export function readPublicEnv(source: Record<string, unknown>): PublicEnv {
  const requireString = (name: string) => {
    const value = source[name]

    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Missing ${name}`)
    }

    return value
  }

  return {
    supabaseUrl: requireString('VITE_SUPABASE_URL'),
    supabasePublishableKey: requireString('VITE_SUPABASE_PUBLISHABLE_KEY'),
    mapboxAccessToken: requireString('VITE_MAPBOX_ACCESS_TOKEN'),
  }
}

export const publicEnv = readPublicEnv(import.meta.env)
