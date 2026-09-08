/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SCREEN_PREVIEW_ENABLED: boolean
  readonly VITE_MAPBOX_ACCESS_TOKEN: string
  readonly VITE_STRIPE_PUBLISHABLE_KEY: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  readonly VITE_SUPABASE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
