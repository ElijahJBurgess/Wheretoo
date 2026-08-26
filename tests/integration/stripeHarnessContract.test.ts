import { describe, expect, it } from 'vitest'
import { loadStripeIntegrationTestEnv } from './testEnv'
import { createManagedStripeProofClient } from './stripeWebhookHarness'

const base = {
  TEST_SUPABASE_URL: 'https://project.supabase.co',
  TEST_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
  VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_example',
  TEST_FUNCTION_URL: 'https://project.supabase.co/functions/v1/task17-transaction-driver',
  TEST_STRIPE_DRIVER_TOKEN: 'a'.repeat(48),
  TEST_STRIPE_FIXTURE_PREFIX: 'task17_a1b2c3d4e5f6',
  TEST_CONNECTED_ACCOUNT_ID: 'acct_Task17Fixture',
  TEST_CONNECTED_ACCOUNT_DISPOSABLE: '1',
} as const

describe('Stripe transaction proof configuration', () => {
  it('accepts managed server proof markers without reading managed credentials', () => {
    expect(loadStripeIntegrationTestEnv({
      ...base,
      TEST_STRIPE_CREDENTIAL_MODE: 'managed_edge',
      STRIPE_RESTRICTED_KEY: 'managed:test-mode-authenticated',
      STRIPE_WEBHOOK_SECRET: 'managed:signature-verified',
    })).toMatchObject({
      credentialMode: 'managed_edge',
      restrictedKeyProof: 'managed:test-mode-authenticated',
      webhookSecretProof: 'managed:signature-verified',
      connectedAccountId: 'acct_Task17Fixture',
      connectedAccountDisposable: true,
      fixturePrefix: 'task17_a1b2c3d4e5f6',
    })
  })

  it('rejects live direct credentials before any test object can be used', () => {
    expect(() => loadStripeIntegrationTestEnv({
      ...base,
      TEST_STRIPE_CREDENTIAL_MODE: 'direct',
      STRIPE_RESTRICTED_KEY: 'rk_live_forbidden',
      STRIPE_WEBHOOK_SECRET: 'whsec_testfixture',
    })).toThrow(/STRIPE_RESTRICTED_KEY/)
  })

  it('names both managed credential contracts when configuration is absent', () => {
    expect(() => loadStripeIntegrationTestEnv({
      ...base,
      TEST_STRIPE_CREDENTIAL_MODE: 'managed_edge',
    })).toThrow(/STRIPE_RESTRICTED_KEY, STRIPE_WEBHOOK_SECRET/)
  })
})

describe('managed proof client boundary', () => {
  it('rejects an unenumerated driver action before making a request', async () => {
    let requests = 0
    const client = createManagedStripeProofClient(
      {
        credentialMode: 'managed_edge',
        supabaseUrl: base.TEST_SUPABASE_URL,
        supabasePublishableKey: base.TEST_SUPABASE_PUBLISHABLE_KEY,
        stripePublishableKey: base.VITE_STRIPE_PUBLISHABLE_KEY,
        functionUrl: base.TEST_FUNCTION_URL,
        driverToken: base.TEST_STRIPE_DRIVER_TOKEN,
        fixturePrefix: base.TEST_STRIPE_FIXTURE_PREFIX,
        connectedAccountId: base.TEST_CONNECTED_ACCOUNT_ID,
        connectedAccountDisposable: true,
        restrictedKeyProof: 'managed:test-mode-authenticated',
        webhookSecretProof: 'managed:signature-verified',
      },
      async () => {
        requests += 1
        return new Response('{}')
      },
    )

    await expect(client.invoke('read_secret' as never)).rejects.toThrow(/Unsupported managed proof action/)
    expect(requests).toBe(0)
  })

  it('sends the one-time token only in the exact proof header', async () => {
    let headers: Headers | undefined
    const client = createManagedStripeProofClient(
      {
        credentialMode: 'managed_edge',
        supabaseUrl: base.TEST_SUPABASE_URL,
        supabasePublishableKey: base.TEST_SUPABASE_PUBLISHABLE_KEY,
        stripePublishableKey: base.VITE_STRIPE_PUBLISHABLE_KEY,
        functionUrl: base.TEST_FUNCTION_URL,
        driverToken: base.TEST_STRIPE_DRIVER_TOKEN,
        fixturePrefix: base.TEST_STRIPE_FIXTURE_PREFIX,
        connectedAccountId: base.TEST_CONNECTED_ACCOUNT_ID,
        connectedAccountDisposable: true,
        restrictedKeyProof: 'managed:test-mode-authenticated',
        webhookSecretProof: 'managed:signature-verified',
      },
      async (_url, init) => {
        headers = new Headers(init?.headers)
        return Response.json({ ok: true })
      },
    )

    await client.invoke('server_proof')
    expect(headers?.get('x-task17-proof-token')).toBe(base.TEST_STRIPE_DRIVER_TOKEN)
    expect(headers?.has('x-task17-onboarding-token')).toBe(false)
  })
})
