import process from 'node:process'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/lib/supabase/database.types'

const requiredIntegrationVariables = [
  'TEST_SUPABASE_URL',
  'TEST_SUPABASE_PUBLISHABLE_KEY',
  'TEST_ORGANIZER_A_EMAIL',
  'TEST_ORGANIZER_A_PASSWORD',
  'TEST_ORGANIZER_B_EMAIL',
  'TEST_ORGANIZER_B_PASSWORD',
] as const

type IntegrationVariable = (typeof requiredIntegrationVariables)[number]

export type IntegrationTestEnv = {
  supabaseUrl: string
  supabasePublishableKey: string
  organizerAEmail: string
  organizerAPassword: string
  organizerBEmail: string
  organizerBPassword: string
}

export function loadIntegrationTestEnv(
  source: Partial<Record<IntegrationVariable, string | undefined>> = process.env,
): IntegrationTestEnv {
  const missing = requiredIntegrationVariables.filter((name) => !source[name]?.trim())

  if (missing.length > 0) {
    throw new Error(
      `Missing required integration test environment variables: ${missing.join(', ')}. ` +
        'Provide them only to the Node test process; see Docs/testing/day1-organizer-event-verification.md.',
    )
  }

  if (!source.TEST_SUPABASE_PUBLISHABLE_KEY!.startsWith('sb_publishable_')) {
    throw new Error(
      'TEST_SUPABASE_PUBLISHABLE_KEY must be the project publishable key (sb_publishable_...). ' +
        'Never use a secret or service-role key for this browser-API test.',
    )
  }

  return {
    supabaseUrl: source.TEST_SUPABASE_URL!,
    supabasePublishableKey: source.TEST_SUPABASE_PUBLISHABLE_KEY!,
    organizerAEmail: source.TEST_ORGANIZER_A_EMAIL!,
    organizerAPassword: source.TEST_ORGANIZER_A_PASSWORD!,
    organizerBEmail: source.TEST_ORGANIZER_B_EMAIL!,
    organizerBPassword: source.TEST_ORGANIZER_B_PASSWORD!,
  }
}

export function createIntegrationTestClient(env: IntegrationTestEnv) {
  return createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

const requiredStripeIntegrationVariables = [
  'TEST_STRIPE_CREDENTIAL_MODE',
  'TEST_SUPABASE_URL',
  'TEST_SUPABASE_PUBLISHABLE_KEY',
  'VITE_STRIPE_PUBLISHABLE_KEY',
  'TEST_FUNCTION_URL',
  'TEST_STRIPE_DRIVER_TOKEN',
  'TEST_STRIPE_FIXTURE_PREFIX',
  'TEST_CONNECTED_ACCOUNT_ID',
  'TEST_CONNECTED_ACCOUNT_DISPOSABLE',
  'STRIPE_RESTRICTED_KEY',
  'STRIPE_WEBHOOK_SECRET',
] as const

type StripeIntegrationVariable = (typeof requiredStripeIntegrationVariables)[number]

export type StripeIntegrationTestEnv = {
  credentialMode: 'direct' | 'managed_edge'
  supabaseUrl: string
  supabasePublishableKey: string
  stripePublishableKey: string
  functionUrl: string
  driverToken: string
  fixturePrefix: string
  connectedAccountId: string
  connectedAccountDisposable: true
  restrictedKeyProof: string
  webhookSecretProof: string
}

export function loadStripeIntegrationTestEnv(
  source: Partial<Record<StripeIntegrationVariable, string | undefined>> = process.env,
): StripeIntegrationTestEnv {
  const missing = requiredStripeIntegrationVariables.filter((name) => !source[name]?.trim())
  if (missing.length > 0) {
    throw new Error(`Missing required Stripe integration environment variables: ${missing.join(', ')}`)
  }

  const invalid: string[] = []
  const credentialMode = source.TEST_STRIPE_CREDENTIAL_MODE
  if (credentialMode !== 'direct' && credentialMode !== 'managed_edge') {
    invalid.push('TEST_STRIPE_CREDENTIAL_MODE')
  }
  if (!source.TEST_SUPABASE_URL!.startsWith('https://')) invalid.push('TEST_SUPABASE_URL')
  if (!source.TEST_SUPABASE_PUBLISHABLE_KEY!.startsWith('sb_publishable_')) {
    invalid.push('TEST_SUPABASE_PUBLISHABLE_KEY')
  }
  if (!source.VITE_STRIPE_PUBLISHABLE_KEY!.startsWith('pk_test_')) {
    invalid.push('VITE_STRIPE_PUBLISHABLE_KEY')
  }
  try {
    const supabase = new URL(source.TEST_SUPABASE_URL!)
    const functionUrl = new URL(source.TEST_FUNCTION_URL!)
    if (
      functionUrl.protocol !== 'https:' ||
      functionUrl.origin !== supabase.origin ||
      functionUrl.pathname !== '/functions/v1/task17-transaction-driver' ||
      functionUrl.search !== '' ||
      functionUrl.hash !== ''
    ) invalid.push('TEST_FUNCTION_URL')
  } catch {
    invalid.push('TEST_FUNCTION_URL')
  }
  if (source.TEST_STRIPE_DRIVER_TOKEN!.length < 32) invalid.push('TEST_STRIPE_DRIVER_TOKEN')
  if (!/^task17_[a-z0-9]{12}$/.test(source.TEST_STRIPE_FIXTURE_PREFIX!)) {
    invalid.push('TEST_STRIPE_FIXTURE_PREFIX')
  }
  if (!/^acct_[A-Za-z0-9]+$/.test(source.TEST_CONNECTED_ACCOUNT_ID!)) {
    invalid.push('TEST_CONNECTED_ACCOUNT_ID')
  }
  if (source.TEST_CONNECTED_ACCOUNT_DISPOSABLE !== '1') {
    invalid.push('TEST_CONNECTED_ACCOUNT_DISPOSABLE')
  }
  if (
    credentialMode === 'managed_edge' &&
    source.STRIPE_RESTRICTED_KEY !== 'managed:test-mode-authenticated'
  ) invalid.push('STRIPE_RESTRICTED_KEY')
  if (
    credentialMode === 'managed_edge' &&
    source.STRIPE_WEBHOOK_SECRET !== 'managed:signature-verified'
  ) invalid.push('STRIPE_WEBHOOK_SECRET')
  if (credentialMode === 'direct' && !/^rk_test_[A-Za-z0-9]+$/.test(source.STRIPE_RESTRICTED_KEY!)) {
    invalid.push('STRIPE_RESTRICTED_KEY')
  }
  if (credentialMode === 'direct' && !/^whsec_[A-Za-z0-9]+$/.test(source.STRIPE_WEBHOOK_SECRET!)) {
    invalid.push('STRIPE_WEBHOOK_SECRET')
  }
  if (invalid.length > 0) {
    throw new Error(`Invalid test-only Stripe integration environment variables: ${invalid.join(', ')}`)
  }

  return {
    credentialMode: credentialMode as 'direct' | 'managed_edge',
    supabaseUrl: source.TEST_SUPABASE_URL!,
    supabasePublishableKey: source.TEST_SUPABASE_PUBLISHABLE_KEY!,
    stripePublishableKey: source.VITE_STRIPE_PUBLISHABLE_KEY!,
    functionUrl: source.TEST_FUNCTION_URL!,
    driverToken: source.TEST_STRIPE_DRIVER_TOKEN!,
    fixturePrefix: source.TEST_STRIPE_FIXTURE_PREFIX!,
    connectedAccountId: source.TEST_CONNECTED_ACCOUNT_ID!,
    connectedAccountDisposable: true,
    restrictedKeyProof: source.STRIPE_RESTRICTED_KEY!,
    webhookSecretProof: source.STRIPE_WEBHOOK_SECRET!,
  }
}
