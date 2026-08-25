import { describe, expect, it } from 'vitest'
import { selectBrowserEnv } from './browserEnv'

describe('selectBrowserEnv', () => {
  it('selects only the exact browser environment allowlist', () => {
    const selected = selectBrowserEnv({
      VITE_SUPABASE_URL: 'https://project.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      VITE_MAPBOX_ACCESS_TOKEN: 'mapbox-token',
      VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_browser',
      VITE_SUPABASE_URL_SUFFIX: 'must-not-be-exposed',
      VITE_UNAPPROVED_VALUE: 'must-not-be-exposed',
      SERVER_ONLY_SECRET: 'must-not-be-exposed',
    })

    expect(selected).toEqual({
      VITE_SUPABASE_URL: 'https://project.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      VITE_MAPBOX_ACCESS_TOKEN: 'mapbox-token',
      VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_browser',
    })
  })
})
