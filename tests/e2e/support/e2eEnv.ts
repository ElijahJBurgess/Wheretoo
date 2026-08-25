import process from 'node:process'

const requiredE2EVariables = [
  'TEST_SUPABASE_URL',
  'TEST_SUPABASE_PUBLISHABLE_KEY',
  'TEST_ORGANIZER_A_EMAIL',
  'TEST_ORGANIZER_A_PASSWORD',
  'TEST_ORGANIZER_B_EMAIL',
  'TEST_ORGANIZER_B_PASSWORD',
  'VITE_MAPBOX_ACCESS_TOKEN',
] as const

type E2EVariable = (typeof requiredE2EVariables)[number]

export type E2EEnv = {
  supabaseUrl: string
  supabasePublishableKey: string
  organizerAEmail: string
  organizerAPassword: string
  organizerBEmail: string
  organizerBPassword: string
  mapboxAccessToken: string
}

export function loadE2EEnv(
  source: Partial<Record<E2EVariable, string | undefined>> = process.env,
): E2EEnv {
  const missing = requiredE2EVariables.filter((name) => !source[name]?.trim())

  if (missing.length > 0) {
    throw new Error(
      `Missing required E2E environment variables: ${missing.join(', ')}. ` +
        'Provide them only to the Playwright process; see Docs/testing/day1-organizer-event-verification.md.',
    )
  }

  if (!source.TEST_SUPABASE_PUBLISHABLE_KEY!.startsWith('sb_publishable_')) {
    throw new Error(
      'TEST_SUPABASE_PUBLISHABLE_KEY must be an sb_publishable_ key. ' +
        'Never use an admin, secret, or service-role key in Playwright or Vite.',
    )
  }

  return {
    supabaseUrl: source.TEST_SUPABASE_URL!,
    supabasePublishableKey: source.TEST_SUPABASE_PUBLISHABLE_KEY!,
    organizerAEmail: source.TEST_ORGANIZER_A_EMAIL!,
    organizerAPassword: source.TEST_ORGANIZER_A_PASSWORD!,
    organizerBEmail: source.TEST_ORGANIZER_B_EMAIL!,
    organizerBPassword: source.TEST_ORGANIZER_B_PASSWORD!,
    mapboxAccessToken: source.VITE_MAPBOX_ACCESS_TOKEN!,
  }
}
