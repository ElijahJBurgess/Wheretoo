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
      stripePublishableKey: 'pk_test_runtime',
    },
  }
})

vi.mock('@supabase/supabase-js', async importOriginal => ({ ...await importOriginal<typeof import('@supabase/supabase-js')>(), createClient }))
vi.mock('../env', () => ({ publicEnv: runtimeEnv }))

import { authTransitionLock } from '../../features/auth/authTransitions'
import { createWheretoClient, supabase } from './client'

const expectedAuthOptions = {
  lock: authTransitionLock,
  lockAcquireTimeout: 15_000,
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
      stripePublishableKey: 'pk_test_factory',
    })

    expect(client).toBe(configuredClient)
    expect(createClient).toHaveBeenCalledWith(
      'https://factory.example.supabase.co',
      'factory-publishable',
      { global: { fetch: expect.any(Function) }, auth: { ...expectedAuthOptions, storageKey: 'sb-factory-auth-token' } },
    )
  })

  it('exports the singleton configured from the runtime public environment', () => {
    expect(supabase).toBe(configuredClient)
    expect(createClient).toHaveBeenCalledWith(
      'https://runtime.example.supabase.co',
      'runtime-publishable',
      { global: { fetch: expect.any(Function) }, auth: { ...expectedAuthOptions, storageKey: 'sb-runtime-auth-token' } },
    )
  })
})
