import process from 'node:process'

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
