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
  'TEST_SUPABASE_URL',
  'TEST_SUPABASE_PUBLISHABLE_KEY',
  'VITE_STRIPE_PUBLISHABLE_KEY',
  'TEST_FUNCTION_URL',
  'TEST_STRIPE_DRIVER_TOKEN',
  'TEST_STRIPE_EVENT_ID',
] as const

type StripeIntegrationVariable = (typeof requiredStripeIntegrationVariables)[number]

export type StripeIntegrationTestEnv = {
  supabaseUrl: string
  supabasePublishableKey: string
  stripePublishableKey: string
  functionUrl: string
  driverToken: string
  eventId: string
}

export function loadStripeIntegrationTestEnv(
  source: Partial<Record<StripeIntegrationVariable, string | undefined>> = process.env,
): StripeIntegrationTestEnv {
  const missing = requiredStripeIntegrationVariables.filter((name) => !source[name]?.trim())
  if (missing.length > 0) {
    throw new Error(`Missing required Stripe integration environment variables: ${missing.join(', ')}`)
  }

  const invalid: string[] = []
  if (!source.TEST_SUPABASE_URL!.startsWith('https://')) invalid.push('TEST_SUPABASE_URL')
  if (!source.TEST_SUPABASE_PUBLISHABLE_KEY!.startsWith('sb_publishable_')) {
    invalid.push('TEST_SUPABASE_PUBLISHABLE_KEY')
  }
  if (!source.VITE_STRIPE_PUBLISHABLE_KEY!.startsWith('pk_test_')) {
    invalid.push('VITE_STRIPE_PUBLISHABLE_KEY')
  }
  if (!source.TEST_FUNCTION_URL!.startsWith('https://')) invalid.push('TEST_FUNCTION_URL')
  if (source.TEST_STRIPE_DRIVER_TOKEN!.length < 32) invalid.push('TEST_STRIPE_DRIVER_TOKEN')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(source.TEST_STRIPE_EVENT_ID!)) {
    invalid.push('TEST_STRIPE_EVENT_ID')
  }
  if (invalid.length > 0) {
    throw new Error(`Invalid test-only Stripe integration environment variables: ${invalid.join(', ')}`)
  }

  const forbidden = ['TEST_SUPABASE_SECRET_KEY', 'STRIPE_RESTRICTED_KEY', 'STRIPE_WEBHOOK_SECRET']
    .filter((name) => process.env[name]?.trim())
  if (forbidden.length > 0) {
    throw new Error(
      `Stripe transaction proof must use the managed server boundary; remove raw values: ${forbidden.join(', ')}`,
    )
  }

  return {
    supabaseUrl: source.TEST_SUPABASE_URL!,
    supabasePublishableKey: source.TEST_SUPABASE_PUBLISHABLE_KEY!,
    stripePublishableKey: source.VITE_STRIPE_PUBLISHABLE_KEY!,
    functionUrl: source.TEST_FUNCTION_URL!,
    driverToken: source.TEST_STRIPE_DRIVER_TOKEN!,
    eventId: source.TEST_STRIPE_EVENT_ID!,
  }
}
