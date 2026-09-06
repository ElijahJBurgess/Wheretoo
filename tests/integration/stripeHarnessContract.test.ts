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
  it('accepts only fixed-shape account diagnostics at the managed response boundary', async () => {
    const contractMismatch = {
      ok: false,
      kind: 'ACCOUNT_CONTRACT_MISMATCH',
      account_contract: {
        dashboard_is_express: false,
        recipient_configuration_only: false,
        default_currency_is_usd: true,
        fees_collector_is_application: true,
        losses_collector_is_application: true,
        requirements_collector_is_stripe: true,
      },
    }
    const retrievalFailure = { ok: false, kind: 'ACCOUNT_RETRIEVE_FAILED' }
    const readyDiagnostic = {
      ok: true,
      restricted_key_authenticated: true,
      webhook_signature_verified: true,
      livemode: false,
      connected_account_matches: true,
      transfers_status: 'active',
      payouts_status: 'active',
      requirements_status: 'clear',
    }
    const responses = [
      contractMismatch,
      retrievalFailure,
      readyDiagnostic,
      {
        ok: false,
        kind: 'ACCOUNT_CONTRACT_MISMATCH',
        account_contract: {
          dashboard_is_express: false,
          recipient_configuration_only: false,
          default_currency_is_usd: true,
          fees_collector_is_application: true,
          losses_collector_is_application: true,
          requirements_collector_is_stripe: true,
          arbitrary_provider_field: false,
        },
      },
      { ok: false, kind: 'ACCOUNT_RETRIEVE_FAILED', account_id: 'acct_forbidden' },
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

    await expect(client.invoke('account_diagnostic')).resolves.toEqual(contractMismatch)
    await expect(client.invoke('account_diagnostic')).resolves.toEqual(retrievalFailure)
    await expect(client.invoke('account_diagnostic')).resolves.toEqual(readyDiagnostic)
    await expect(client.invoke('account_diagnostic')).rejects.toThrow(
      'Managed Stripe diagnostic returned invalid shape',
    )
    await expect(client.invoke('account_diagnostic')).rejects.toThrow(
      'Managed Stripe proof returned unsafe data',
    )
  })

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

  it('rejects provider, ticket, receipt, refund, and order-item identifiers at the managed boundary', async () => {
    const responses = [
      { ok: true, provider: 'cs_test_forbidden' },
      { ok: true, ticket_id: '11111111-1111-4111-8111-111111111111' },
      { ok: true, order_item_id: '22222222-2222-4222-8222-222222222222' },
      { ok: true, stripe_event_id: 'evt_forbidden' },
      { ok: true, refund_id: 're_forbidden' },
      { ok: true, order_id: '33333333-3333-4333-8333-333333333333' },
      { ok: true, id: '44444444-4444-4444-8444-444444444444' },
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

    for (
      const action of [
        'checkout_status',
        'inspect',
        'deliver',
        'create_refund',
        'server_proof',
        'reconcile_payment',
        'reconcile_events',
      ] as const
    ) {
      let rejected = false
      try {
        await client.invoke(action)
      } catch (error) {
        rejected = error instanceof Error && error.message === 'Managed Stripe proof returned unsafe data'
      }
      expect(rejected).toBe(true)
    }
  })

  it('sanitizes URL-bearing hosted Checkout browser errors', () => {
    const sanitize = Reflect.get(stripeTestObjects, 'toSafeHostedCheckoutBrowserError')
    expect(typeof sanitize).toBe('function')
    if (typeof sanitize !== 'function') return

    const sensitiveUrl = ['https://checkout.stripe.com', '/c/pay/', 'cs_test_forbidden'].join('')
    const safe = sanitize(new Error(`page navigation timed out at ${sensitiveUrl}`)) as Error
    expect(safe.message).toBe('Hosted Checkout browser failure: TIMEOUT')
    expect(safe.message).not.toContain(sensitiveUrl)
    expect(safe).not.toHaveProperty('cause')
  })

  it('reports only the allowlisted checkout error code and status', async () => {
    const toSafeError = Reflect.get(
      stripeTestObjects,
      'toSafeCheckoutCreationError',
    )
    expect(typeof toSafeError).toBe('function')
    if (typeof toSafeError !== 'function') return

    const response = Response.json({
      error: {
        code: 'INVALID_STRIPE_SESSION',
        raw: 'customer@example.invalid sk_test_must_not_escape',
      },
    }, { status: 502 })
    const safe = await toSafeError(response) as Error

    expect(safe.message).toBe(
      'Checkout creation failed: HTTP 502 INVALID_STRIPE_SESSION',
    )
    expect(safe.message).not.toContain('customer@example.invalid')
    expect(safe.message).not.toContain('sk_test_')
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
    expect(driver).toContain('applied_configurations: connectedAccount.applied_configurations,')
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
    expect(proofTest).toContain('ticket_count: 3')
    expect(proofTest).toContain('unique_ticket_count: 3')
    expect(proofTest).toContain('bindings_valid: true')
    expect(proofTest).toContain("order_handle: 'paid'")
    expect(proofTest).not.toContain('ticket.order_id')
    expect(proofTest).not.toContain('ticket.id')
    expect(proofTest).toContain('expect(safeConfirmation).not.toHaveProperty(\'ticket_id\')')
    expect(proofTest).toContain('deleted_item_count: 4')
    expect(proofTest).toContain('deleted_ticket_count: 3')
    expect(proofTest).toContain('stable_fixture: true')
    expect(proofTest).toContain('fixture_reusable: true')
    expect(proofTest).toContain('auth_user_inert: true')
    expect(proofTest).toContain('active_tier_count: 0')
    expect(proofTest).toContain('close_connected_account: false')
    expect(proofTest).toContain('connected_account_closed: false')
    expect(proofTest).toContain('connected_account_preserved: true')
    expect(proofTest).not.toContain('close_connected_account: true')
    expect(driver).toContain('save_owned_event_requirements')
    expect(driver).toContain('accept_current_event_policies')
    expect(driver).toContain('publish_event')
    expect(driver).toContain('server_get_checkout_preflight')
    expect(driver).not.toContain('from("events").delete()')
    expect(driver).not.toContain('from("organizers").delete()')
    expect(driver).not.toContain('open_eligible_interval_count: 0')
    expect(driver).toContain('line_bindings_valid: true')
  })
})
