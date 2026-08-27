import process from 'node:process'

const requiredE2EVariables = [
  'TEST_SUPABASE_URL',
  'TEST_SUPABASE_PUBLISHABLE_KEY',
  'TEST_ORGANIZER_A_EMAIL',
  'TEST_ORGANIZER_A_PASSWORD',
  'TEST_ORGANIZER_B_EMAIL',
  'TEST_ORGANIZER_B_PASSWORD',
  'VITE_MAPBOX_ACCESS_TOKEN',
  'VITE_STRIPE_PUBLISHABLE_KEY',
] as const

const requiredTask18Variables = [
  'TEST_TASK18_FUNCTION_URL',
  'TEST_TASK18_DRIVER_TOKEN',
  'TEST_TASK18_FIXTURE_PREFIX',
] as const

type E2EVariable =
  | (typeof requiredE2EVariables)[number]
  | (typeof requiredTask18Variables)[number]

export type E2EEnv = {
  supabaseUrl: string
  supabasePublishableKey: string
  organizerAEmail: string
  organizerAPassword: string
  organizerBEmail: string
  organizerBPassword: string
  mapboxAccessToken: string
  stripePublishableKey: string
}

export type Task18E2EEnv = E2EEnv & {
  task18FunctionUrl: string
  task18DriverToken: string
  task18FixturePrefix: string
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

  if (!source.VITE_STRIPE_PUBLISHABLE_KEY!.startsWith('pk_test_')) {
    throw new Error('VITE_STRIPE_PUBLISHABLE_KEY must be a Stripe test-mode publishable key.')
  }

  return {
    supabaseUrl: source.TEST_SUPABASE_URL!,
    supabasePublishableKey: source.TEST_SUPABASE_PUBLISHABLE_KEY!,
    organizerAEmail: source.TEST_ORGANIZER_A_EMAIL!,
    organizerAPassword: source.TEST_ORGANIZER_A_PASSWORD!,
    organizerBEmail: source.TEST_ORGANIZER_B_EMAIL!,
    organizerBPassword: source.TEST_ORGANIZER_B_PASSWORD!,
    mapboxAccessToken: source.VITE_MAPBOX_ACCESS_TOKEN!,
    stripePublishableKey: source.VITE_STRIPE_PUBLISHABLE_KEY!,
  }
}

export function loadTask18E2EEnv(
  source: Partial<Record<E2EVariable, string | undefined>> = process.env,
): Task18E2EEnv {
  const base = loadE2EEnv(source)
  const missing = requiredTask18Variables.filter((name) => !source[name]?.trim())
  if (missing.length > 0) {
    throw new Error(`Missing required Task 18 E2E environment variables: ${missing.join(', ')}`)
  }

  let functionUrl: URL
  try {
    functionUrl = new URL(source.TEST_TASK18_FUNCTION_URL!)
    const supabaseUrl = new URL(source.TEST_SUPABASE_URL!)
    if (
      functionUrl.protocol !== 'https:' ||
      functionUrl.origin !== supabaseUrl.origin ||
      functionUrl.pathname !== '/functions/v1/task17-transaction-driver' ||
      functionUrl.search !== '' ||
      functionUrl.hash !== ''
    ) throw new Error('invalid function URL')
  } catch {
    throw new Error('TEST_TASK18_FUNCTION_URL must be the linked audited transaction-driver URL.')
  }

  if (source.TEST_TASK18_DRIVER_TOKEN!.length < 32) {
    throw new Error('TEST_TASK18_DRIVER_TOKEN must be a one-time test-driver credential.')
  }
  if (!/^task18_[a-z0-9]{12}$/.test(source.TEST_TASK18_FIXTURE_PREFIX!)) {
    throw new Error('TEST_TASK18_FIXTURE_PREFIX must identify one exact disposable fixture.')
  }

  return {
    ...base,
    task18FunctionUrl: functionUrl.toString(),
    task18DriverToken: source.TEST_TASK18_DRIVER_TOKEN!,
    task18FixturePrefix: source.TEST_TASK18_FIXTURE_PREFIX!,
  }
}
