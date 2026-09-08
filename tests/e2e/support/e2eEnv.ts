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

const requiredModerationVariables = [
  'TEST_SUPABASE_URL',
  'TEST_SUPABASE_PUBLISHABLE_KEY',
  'TEST_ORGANIZER_A_EMAIL',
  'TEST_ORGANIZER_A_PASSWORD',
  'TEST_ORGANIZER_B_EMAIL',
  'TEST_ORGANIZER_B_PASSWORD',
  'TEST_STAFF_EMAIL',
  'TEST_STAFF_PASSWORD',
  'TEST_MODERATION_FIXTURE_PREFIX',
  'TEST_MODERATION_REPORT_FUNCTION_URL',
  'TEST_MODERATION_REPORT_CLIENT_MOBILE',
  'TEST_MODERATION_REPORT_CLIENT_DESKTOP',
  'TEST_MODERATION_REPORT_EVENT_MOBILE_ID',
  'TEST_MODERATION_REPORT_EVENT_DESKTOP_ID',
  'TEST_MODERATION_STAFF_EVENT_MOBILE_ID',
  'TEST_MODERATION_STAFF_EVENT_DESKTOP_ID',
  'TEST_MODERATION_VISUAL_EVENT_MOBILE_ID',
  'TEST_MODERATION_VISUAL_EVENT_DESKTOP_ID',
  'TEST_MODERATION_MAP_ELIGIBLE_MOBILE_ID',
  'TEST_MODERATION_MAP_ELIGIBLE_DESKTOP_ID',
  'TEST_MODERATION_MAP_EXCLUDED_MOBILE_IDS',
  'TEST_MODERATION_MAP_EXCLUDED_DESKTOP_IDS',
] as const

type E2EVariable =
  | (typeof requiredE2EVariables)[number]
  | (typeof requiredTask18Variables)[number]
  | (typeof requiredModerationVariables)[number]

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

export type Task18E2EEnv = Pick<E2EEnv, 'supabaseUrl' | 'supabasePublishableKey' | 'mapboxAccessToken' | 'stripePublishableKey'> & {
  task18FunctionUrl: string
  task18DriverToken: string
  task18FixturePrefix: string
}

export type ModerationProjectFixture = {
  organizer: { email: string; password: string; displayName: string }
  reportEventId: string
  staffEventId: string
  visualEventId: string
  mapEligibleEventId: string
  mapExcludedEventIds: readonly string[]
  reportClientAddress: string
}

export type ModerationE2EEnv = {
  supabaseUrl: string
  supabasePublishableKey: string
  staffEmail: string
  staffPassword: string
  fixturePrefix: string
  reportFunctionUrl: string
  fixtureForProject(projectName: string): ModerationProjectFixture
}

const lowercaseUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function parseUuid(name: (typeof requiredModerationVariables)[number], value: string): string {
  if (!lowercaseUuidPattern.test(value)) {
    throw new Error(`${name} must be one lowercase RFC UUID.`)
  }
  return value
}

function parseExcludedIds(name: (typeof requiredModerationVariables)[number], value: string): readonly string[] {
  const ids = value.split(',')
  if (ids.length !== 8 || new Set(ids).size !== ids.length || ids.some((id) => !lowercaseUuidPattern.test(id))) {
    throw new Error(`${name} must contain eight unique lowercase RFC UUIDs separated by commas.`)
  }
  return ids
}

function validateSupabaseBrowserBoundary(urlValue: string, publishableKey: string) {
  let url: URL
  try {
    url = new URL(urlValue)
  } catch {
    throw new Error('TEST_SUPABASE_URL must be one canonical HTTPS Supabase project URL.')
  }
  if (
    url.protocol !== 'https:' ||
    !/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('TEST_SUPABASE_URL must be one canonical HTTPS Supabase project URL.')
  }
  if (!publishableKey.startsWith('sb_publishable_')) {
    throw new Error(
      'TEST_SUPABASE_PUBLISHABLE_KEY must be an sb_publishable_ key. ' +
        'Never use an admin, secret, or service-role key in Playwright or Vite.',
    )
  }
}

export function loadModerationE2EEnv(
  source: Partial<Record<E2EVariable, string | undefined>> = process.env,
): ModerationE2EEnv {
  const missing = requiredModerationVariables.filter((name) => !source[name]?.trim())
  if (missing.length > 0) {
    throw new Error(`Missing required Task 16 E2E environment variables: ${missing.join(', ')}`)
  }

  validateSupabaseBrowserBoundary(source.TEST_SUPABASE_URL!, source.TEST_SUPABASE_PUBLISHABLE_KEY!)
  if (!/^task16_[a-z0-9]{12}$/.test(source.TEST_MODERATION_FIXTURE_PREFIX!)) {
    throw new Error('TEST_MODERATION_FIXTURE_PREFIX must identify one exact disposable fixture.')
  }
  let reportFunctionUrl: URL
  try {
    reportFunctionUrl = new URL(source.TEST_MODERATION_REPORT_FUNCTION_URL!)
  } catch {
    throw new Error('TEST_MODERATION_REPORT_FUNCTION_URL must be the local Task 16 report harness URL.')
  }
  if (
    reportFunctionUrl.protocol !== 'http:' || reportFunctionUrl.hostname !== '127.0.0.1' ||
    reportFunctionUrl.port !== '8000' || reportFunctionUrl.pathname !== '/' ||
    reportFunctionUrl.search !== '' || reportFunctionUrl.hash !== ''
  ) {
    throw new Error('TEST_MODERATION_REPORT_FUNCTION_URL must be the local Task 16 report harness URL.')
  }
  for (const name of ['TEST_MODERATION_REPORT_CLIENT_MOBILE', 'TEST_MODERATION_REPORT_CLIENT_DESKTOP'] as const) {
    if (!/^198\.51\.100\.(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-4])$/.test(source[name]!)) {
      throw new Error(`${name} must use one non-identifying TEST-NET-2 IPv4 address.`)
    }
  }

  const projectFixtures = {
    'mobile-chromium': {
      organizer: {
        email: source.TEST_ORGANIZER_A_EMAIL!,
        password: source.TEST_ORGANIZER_A_PASSWORD!,
        displayName: 'Whereto Task 16 Mobile Organizer',
      },
      reportEventId: parseUuid('TEST_MODERATION_REPORT_EVENT_MOBILE_ID', source.TEST_MODERATION_REPORT_EVENT_MOBILE_ID!),
      staffEventId: parseUuid('TEST_MODERATION_STAFF_EVENT_MOBILE_ID', source.TEST_MODERATION_STAFF_EVENT_MOBILE_ID!),
      visualEventId: parseUuid('TEST_MODERATION_VISUAL_EVENT_MOBILE_ID', source.TEST_MODERATION_VISUAL_EVENT_MOBILE_ID!),
      mapEligibleEventId: parseUuid('TEST_MODERATION_MAP_ELIGIBLE_MOBILE_ID', source.TEST_MODERATION_MAP_ELIGIBLE_MOBILE_ID!),
      mapExcludedEventIds: parseExcludedIds('TEST_MODERATION_MAP_EXCLUDED_MOBILE_IDS', source.TEST_MODERATION_MAP_EXCLUDED_MOBILE_IDS!),
      reportClientAddress: source.TEST_MODERATION_REPORT_CLIENT_MOBILE!,
    },
    'desktop-chromium': {
      organizer: {
        email: source.TEST_ORGANIZER_B_EMAIL!,
        password: source.TEST_ORGANIZER_B_PASSWORD!,
        displayName: 'Whereto Task 16 Desktop Organizer',
      },
      reportEventId: parseUuid('TEST_MODERATION_REPORT_EVENT_DESKTOP_ID', source.TEST_MODERATION_REPORT_EVENT_DESKTOP_ID!),
      staffEventId: parseUuid('TEST_MODERATION_STAFF_EVENT_DESKTOP_ID', source.TEST_MODERATION_STAFF_EVENT_DESKTOP_ID!),
      visualEventId: parseUuid('TEST_MODERATION_VISUAL_EVENT_DESKTOP_ID', source.TEST_MODERATION_VISUAL_EVENT_DESKTOP_ID!),
      mapEligibleEventId: parseUuid('TEST_MODERATION_MAP_ELIGIBLE_DESKTOP_ID', source.TEST_MODERATION_MAP_ELIGIBLE_DESKTOP_ID!),
      mapExcludedEventIds: parseExcludedIds('TEST_MODERATION_MAP_EXCLUDED_DESKTOP_IDS', source.TEST_MODERATION_MAP_EXCLUDED_DESKTOP_IDS!),
      reportClientAddress: source.TEST_MODERATION_REPORT_CLIENT_DESKTOP!,
    },
  } satisfies Record<string, ModerationProjectFixture>

  return {
    supabaseUrl: source.TEST_SUPABASE_URL!,
    supabasePublishableKey: source.TEST_SUPABASE_PUBLISHABLE_KEY!,
    staffEmail: source.TEST_STAFF_EMAIL!,
    staffPassword: source.TEST_STAFF_PASSWORD!,
    fixturePrefix: source.TEST_MODERATION_FIXTURE_PREFIX!,
    reportFunctionUrl: reportFunctionUrl.toString(),
    fixtureForProject(projectName) {
      const fixture = projectFixtures[projectName as keyof typeof projectFixtures]
      if (!fixture) throw new Error(`No disposable moderation fixture exists for Playwright project: ${projectName}`)
      return fixture
    },
  }
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
  const buyerVariables = ['TEST_SUPABASE_URL', 'TEST_SUPABASE_PUBLISHABLE_KEY',
    'VITE_MAPBOX_ACCESS_TOKEN', 'VITE_STRIPE_PUBLISHABLE_KEY', ...requiredTask18Variables] as const
  const missing = buyerVariables.filter((name) => !source[name]?.trim())
  if (missing.length > 0) {
    throw new Error(`Missing required Task 18 E2E environment variables: ${missing.join(', ')}`)
  }
  if (!source.TEST_SUPABASE_PUBLISHABLE_KEY!.startsWith('sb_publishable_') ||
    !source.VITE_STRIPE_PUBLISHABLE_KEY!.startsWith('pk_test_') ||
    !source.VITE_MAPBOX_ACCESS_TOKEN!.startsWith('pk.')) {
    throw new Error('Task 18 requires public browser keys and Stripe TEST mode.')
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
  if (!/^task17_[a-z0-9]{12}$/.test(source.TEST_TASK18_FIXTURE_PREFIX!)) {
    throw new Error('TEST_TASK18_FIXTURE_PREFIX must identify one exact disposable fixture.')
  }

  return {
    supabaseUrl: source.TEST_SUPABASE_URL!,
    supabasePublishableKey: source.TEST_SUPABASE_PUBLISHABLE_KEY!,
    mapboxAccessToken: source.VITE_MAPBOX_ACCESS_TOKEN!,
    stripePublishableKey: source.VITE_STRIPE_PUBLISHABLE_KEY!,
    task18FunctionUrl: functionUrl.toString(),
    task18DriverToken: source.TEST_TASK18_DRIVER_TOKEN!,
    task18FixturePrefix: source.TEST_TASK18_FIXTURE_PREFIX!,
  }
}
