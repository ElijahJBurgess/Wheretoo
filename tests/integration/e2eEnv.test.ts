import { describe, expect, it } from 'vitest'
import { loadE2EEnv, loadTask18E2EEnv } from '../e2e/support/e2eEnv'

const base = {
  TEST_SUPABASE_URL: 'https://fixture.supabase.co',
  TEST_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
  TEST_ORGANIZER_A_EMAIL: 'organizer-a@example.invalid',
  TEST_ORGANIZER_A_PASSWORD: 'organizer-a-password',
  TEST_ORGANIZER_B_EMAIL: 'organizer-b@example.invalid',
  TEST_ORGANIZER_B_PASSWORD: 'organizer-b-password',
  VITE_MAPBOX_ACCESS_TOKEN: 'pk.mapbox-fixture',
  VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_fixture',
}

describe('Playwright environment boundaries', () => {
  it('loads Day 1 browser configuration without temporary Task 18 driver credentials', () => {
    expect(loadE2EEnv(base)).toMatchObject({
      supabaseUrl: base.TEST_SUPABASE_URL,
      stripePublishableKey: base.VITE_STRIPE_PUBLISHABLE_KEY,
    })
  })

  it('requires and validates temporary driver credentials only for the Task 18 journey', () => {
    expect(() => loadTask18E2EEnv(base)).toThrow(/TEST_TASK18_FUNCTION_URL/)
    expect(loadTask18E2EEnv({
      ...base,
      TEST_TASK18_FUNCTION_URL: `${base.TEST_SUPABASE_URL}/functions/v1/task17-transaction-driver`,
      TEST_TASK18_DRIVER_TOKEN: 'x'.repeat(32),
      TEST_TASK18_FIXTURE_PREFIX: 'task17_123456789abc',
    })).toMatchObject({
      task18FixturePrefix: 'task17_123456789abc',
    })
  })

  it('loads public buyer proof without creating or requiring organizer credentials', () => {
    const buyer = Object.fromEntries(Object.entries(base).filter(([name]) => !name.startsWith('TEST_ORGANIZER_')))
    expect(loadTask18E2EEnv({
      ...buyer,
      TEST_TASK18_FUNCTION_URL: `${base.TEST_SUPABASE_URL}/functions/v1/task17-transaction-driver`,
      TEST_TASK18_DRIVER_TOKEN: 'x'.repeat(32),
      TEST_TASK18_FIXTURE_PREFIX: 'task17_checkout0001',
    })).toMatchObject({ task18FixturePrefix: 'task17_checkout0001' })
  })
})
