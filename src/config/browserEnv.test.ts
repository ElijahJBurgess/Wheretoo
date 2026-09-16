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

  it.each([
    ['a live key', 'pk_live_example'],
    ['a malformed value', 'not-a-stripe-publishable-key'],
    ['a whitespace-prefixed test key', ' pk_test_example'],
  ])('does not select %s for the browser bundle', (_description, stripePublishableKey) => {
    expect(() =>
      selectBrowserEnv({
        VITE_SUPABASE_URL: 'https://project.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
        VITE_MAPBOX_ACCESS_TOKEN: 'mapbox-token',
        VITE_STRIPE_PUBLISHABLE_KEY: stripePublishableKey,
      }),
    ).toThrow('Invalid VITE_STRIPE_PUBLISHABLE_KEY')
  })
})

it('selects only a syntactically valid optional public support address', () => {
  expect(selectBrowserEnv({ VITE_TICKET_SUPPORT_EMAIL: ' Tickets@Example.com ' })).toEqual({ VITE_TICKET_SUPPORT_EMAIL: 'tickets@example.com' })
  expect(selectBrowserEnv({ VITE_TICKET_SUPPORT_EMAIL: 'javascript:alert(1)' })).toEqual({})
  expect(selectBrowserEnv({ VITE_TICKET_SUPPORT_EMAIL: '' })).toEqual({})
  expect(selectBrowserEnv({ VITE_TICKET_SUPPORT_EMAIL: 'a@example.com\nBcc: attacker@example.com' })).toEqual({})
})
