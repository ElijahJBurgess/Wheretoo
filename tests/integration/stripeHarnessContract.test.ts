import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { loadStripeIntegrationTestEnv } from './testEnv'
import { createManagedStripeProofClient } from './stripeWebhookHarness'
import * as stripeTestObjects from './stripeTestObjects'

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

  it('rejects a live publishable key before any test object can be used', () => {
    expect(() => loadStripeIntegrationTestEnv({
      ...base,
      VITE_STRIPE_PUBLISHABLE_KEY: 'pk_live_forbidden',
      TEST_STRIPE_CREDENTIAL_MODE: 'managed_edge',
      STRIPE_RESTRICTED_KEY: 'managed:test-mode-authenticated',
      STRIPE_WEBHOOK_SECRET: 'managed:signature-verified',
    })).toThrow(/VITE_STRIPE_PUBLISHABLE_KEY/)
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

  it('rejects a hosted Checkout URL, credential-shaped value, or PII returned by the driver', async () => {
    const responses = [
      { ok: true, checkout_url: 'https://checkout.stripe.com/c/pay/redacted' },
      { ok: true, nested: { value: 'rk_live_forbidden' } },
      { ok: true, nested: { value: 'pk_live_forbidden' } },
      { ok: true, buyer_email: 'buyer@example.invalid' },
    ]
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
      async () => Response.json(responses.shift()),
    )

    await expect(client.invoke('setup')).rejects.toThrow('Managed Stripe proof returned unsafe data')
    await expect(client.invoke('server_proof')).rejects.toThrow('Managed Stripe proof returned unsafe data')
    await expect(client.invoke('checkout_status')).rejects.toThrow('Managed Stripe proof returned unsafe data')
    await expect(client.invoke('inspect')).rejects.toThrow('Managed Stripe proof returned unsafe data')
  })

  it('defines the exact two-line three-admission cart and per-admission fee', () => {
    expect(stripeTestObjects.applicationFeeMinor(5_500, 3)).toBe(425)
    expect(Reflect.get(stripeTestObjects, 'TASK17_CART')).toEqual([
      { label: 'ga', name: 'Task 17 General Admission', unitAmountMinor: 1_500, quantity: 2, subtotalMinor: 3_000 },
      { label: 'vip', name: 'Task 17 VIP', unitAmountMinor: 2_500, quantity: 1, subtotalMinor: 2_500 },
    ])
    expect(Reflect.get(stripeTestObjects, 'TASK17_ADMISSION_QUANTITY')).toBe(3)
    expect(Reflect.get(stripeTestObjects, 'TASK17_APPLICATION_FEE_MINOR')).toBe(425)
  })

  it('creates an independent canonical request ID and confirmation bearer for every checkout', () => {
    const createAttempt = Reflect.get(stripeTestObjects, 'createStripeProofCheckoutAttempt')
    expect(typeof createAttempt).toBe('function')
    if (typeof createAttempt !== 'function') return

    const first = createAttempt() as { clientRequestId: string; confirmationBearer: string }
    const second = createAttempt() as { clientRequestId: string; confirmationBearer: string }
    expect(first.clientRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(first.confirmationBearer).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.confirmationBearer).not.toContain(first.clientRequestId.replaceAll('-', ''))
    expect(second).not.toEqual(first)
  })

  it('uses the shared whole-order refund helper and closes only the disposable Accounts v2 fixture', async () => {
    const driver = await readFile(
      new URL('./edge/task17-transaction-driver/index.ts', import.meta.url),
      'utf8',
    )
    expect(driver).toContain('createWholeOrderRefund(')
    expect(driver).not.toContain('stripe.refunds.create(')
    expect(driver).toContain('{ applied_configurations: connectedAccount.applied_configurations }')
    expect(driver).not.toContain('from("disputes").delete()')
  })

  it('drives two bound lines, three tickets, safe confirmation, and exact cleanup accounting', async () => {
    const [proofTest, driver] = await Promise.all([
      readFile(new URL('./stripe-ticketing.test.ts', import.meta.url), 'utf8'),
      readFile(new URL('./edge/task17-transaction-driver/index.ts', import.meta.url), 'utf8'),
    ])
    expect(proofTest).toContain("{ tierId: fixture.ga_tier_id, quantity: 2 }")
    expect(proofTest).toContain("{ tierId: fixture.vip_tier_id, quantity: 1 }")
    expect(proofTest).toContain("'X-Whereto-Confirmation-Bearer': attempt.confirmationBearer")
    expect(proofTest).toContain('line_count: 2')
    expect(proofTest).toContain('admission_count: 3')
    expect(proofTest).toContain("tickets.filter((ticket) => ticket.order_id === paidOrder.id)).toHaveLength(3)")
    expect(proofTest).toContain('expect(safeConfirmation).not.toHaveProperty(\'ticket_id\')')
    expect(proofTest).toContain('deleted_item_count: 4')
    expect(proofTest).toContain('deleted_ticket_count: 3')
    expect(driver).toContain('line_bindings_valid: true')
  })
})
