import { describe, expect, it, vi } from 'vitest'

const { createClient, configuredClient, runtimeEnv } = vi.hoisted(() => {
  const configuredClient = { kind: 'configured-whereto-client' }

  return {
    createClient: vi.fn(() => configuredClient),
    configuredClient,
    runtimeEnv: {
      supabaseUrl: 'https://runtime.example.supabase.co',
      supabasePublishableKey: 'runtime-publishable',
      mapboxAccessToken: 'pk.runtime-mapbox',
    },
  }
})

vi.mock('@supabase/supabase-js', () => ({ createClient }))
vi.mock('../env', () => ({ publicEnv: runtimeEnv }))

import { createWheretoClient, supabase } from './client'

const expectedAuthOptions = {
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: true,
}

describe('Supabase client boundary', () => {
  it('creates a client with the supplied public credentials and browser auth behavior', () => {
    const client = createWheretoClient({
      supabaseUrl: 'https://factory.example.supabase.co',
      supabasePublishableKey: 'factory-publishable',
      mapboxAccessToken: 'pk.factory-mapbox',
    })

    expect(client).toBe(configuredClient)
    expect(createClient).toHaveBeenCalledWith(
      'https://factory.example.supabase.co',
      'factory-publishable',
      { auth: expectedAuthOptions },
    )
  })

  it('exports the singleton configured from the runtime public environment', () => {
    expect(supabase).toBe(configuredClient)
    expect(createClient).toHaveBeenCalledWith(
      'https://runtime.example.supabase.co',
      'runtime-publishable',
      { auth: expectedAuthOptions },
    )
  })
})
