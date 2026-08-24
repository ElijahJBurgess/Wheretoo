import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let readPublicEnv: typeof import('./env').readPublicEnv

beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://runtime.example.supabase.co')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'runtime-publishable')
  vi.stubEnv('VITE_MAPBOX_ACCESS_TOKEN', 'pk.runtime-mapbox')

  const envModule = await import('./env')
  readPublicEnv = envModule.readPublicEnv
})

afterAll(() => {
  vi.unstubAllEnvs()
})

describe('readPublicEnv', () => {
  it('returns the three public values', () => {
    expect(
      readPublicEnv({
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'publishable',
        VITE_MAPBOX_ACCESS_TOKEN: 'pk.mapbox',
      }),
    ).toEqual({
      supabaseUrl: 'https://example.supabase.co',
      supabasePublishableKey: 'publishable',
      mapboxAccessToken: 'pk.mapbox',
    })
  })

  it.each([
    ['VITE_SUPABASE_URL', {}],
    [
      'VITE_SUPABASE_PUBLISHABLE_KEY',
      { VITE_SUPABASE_URL: 'https://example.supabase.co' },
    ],
    [
      'VITE_MAPBOX_ACCESS_TOKEN',
      {
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'publishable',
      },
    ],
  ])('fails with the missing variable name %s', (name, source) => {
    expect(() => readPublicEnv(source)).toThrow(`Missing ${name}`)
  })

  it('treats whitespace-only public values as missing', () => {
    expect(() =>
      readPublicEnv({
        VITE_SUPABASE_URL: '   ',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'publishable',
        VITE_MAPBOX_ACCESS_TOKEN: 'pk.mapbox',
      }),
    ).toThrow('Missing VITE_SUPABASE_URL')
  })
})
