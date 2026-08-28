import { spawn } from 'node:child_process'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repositoryRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const runnerPath = path.join(repositoryRoot, 'tests/integration/run-moderation-proof.sh')
const browserRunnerPath = path.join(repositoryRoot, 'tests/e2e/run-moderation-browser-proof.sh')
const journeyPath = path.join(repositoryRoot, 'tests/e2e/support/moderationJourney.ts')
const browserSpecPaths = [
  path.join(repositoryRoot, 'tests/e2e/moderation-public-eligibility.spec.ts'),
  path.join(repositoryRoot, 'tests/e2e/moderation-public-eligibility.visual.spec.ts'),
] as const
const packagePath = path.join(repositoryRoot, 'package.json')

const build25UnitPaths = [
  'src/features/auth/SessionProvider.test.tsx',
  'src/features/moderation/EventPolicyPage.test.tsx',
  'src/features/moderation/EventRequirementsStep.test.tsx',
  'src/features/moderation/ModerationCasePage.test.tsx',
  'src/features/moderation/ModerationQueuePage.test.tsx',
  'src/features/moderation/OrganizerAgreementStep.test.tsx',
  'src/features/moderation/OrganizerTermsPage.test.tsx',
  'src/features/moderation/ReportEventDialog.test.tsx',
  'src/features/moderation/RequireStaff.test.tsx',
  'src/features/moderation/moderation.api.test.ts',
  'src/features/moderation/moderation.queries.test.tsx',
  'src/features/moderation/moderation.schemas.test.ts',
  'src/features/events/EventEditorPage.test.tsx',
  'src/features/events/EventPreviewPage.test.tsx',
  'src/features/events/EventReviewStep.test.tsx',
  'src/features/events/LocationSearchField.test.tsx',
  'src/features/events/OrganizerEventsPage.test.tsx',
  'src/features/events/PublishedEventPage.test.tsx',
  'src/features/events/event.schemas.test.ts',
  'src/features/tickets/OrganizerTicketTiersPage.test.tsx',
  'src/features/tickets/PublicTicketEventPage.test.tsx',
  'src/features/tickets/publicTicketing.api.test.ts',
  'src/features/tickets/publicTicketing.queries.test.tsx',
  'src/features/tickets/ticket.queries.test.tsx',
  'src/features/tickets/ticket.schemas.test.ts',
  'src/app/router/router.test.tsx',
  'src/components/layout/OrganizerLayout.test.tsx',
] as const

const moderationSqlChildren = [
  'moderation_schema',
  'moderation_legacy_migration',
  'moderation_policy_acceptance',
  'moderation_publish_eligibility',
  'public_eligibility_projections',
  'moderation_published_edits',
  'moderation_evaluations',
  'moderation_staff_actions',
  'moderation_reviews_reports',
  'moderation_retention_schedule',
] as const

const compatibilitySqlChildren = [
  'organizers_events_schema',
  'organizers_events_rls',
  'organizer_onboarding_update',
  'publish_event',
  'ticketing_schema',
  'ticketing_rls',
  'paid_sales',
  'inventory_reservations',
  'payment_fulfillment',
  'order_confirmation',
] as const

const shellChildren = [
  'moderation_epoch_concurrency',
  'moderation_action_concurrency',
  'moderation_report_concurrency',
] as const

const expectedChildren = [
  ...moderationSqlChildren,
  ...compatibilitySqlChildren,
  ...shellChildren,
  'moderation_public_projection',
] as const

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

async function readRunnerSource() {
  try {
    return await readFile(runnerPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function executeRunner(source: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'moderation-runner-contract-'))
  temporaryDirectories.push(root)

  const commandLog = path.join(root, 'commands.log')
  const runner = path.join(root, 'tests/integration/run-moderation-proof.sh')
  const fakeBin = path.join(root, 'fake-bin')
  const supabaseBin = path.join(root, 'node_modules/.bin/supabase')

  await Promise.all([
    mkdir(path.dirname(runner), { recursive: true }),
    mkdir(path.dirname(supabaseBin), { recursive: true }),
    mkdir(path.join(root, 'supabase/.temp'), { recursive: true }),
    mkdir(path.join(root, 'supabase/tests/database'), { recursive: true }),
    mkdir(fakeBin, { recursive: true }),
  ])
  await writeFile(runner, source)
  await writeFile(path.join(root, 'supabase/.temp/project-ref'), 'abcdefghijklmnopqrst\n')

  for (const child of [...moderationSqlChildren, ...compatibilitySqlChildren]) {
    await writeFile(
      path.join(root, `supabase/tests/database/${child}.test.sql`),
      "begin; select no_plan(); select ok(true, 'contract'); select * from finish(); rollback;\n",
    )
  }

  for (const child of shellChildren) {
    const childPath = path.join(root, `supabase/tests/database/${child}.test.sh`)
    await writeFile(
      childPath,
      '#!/bin/sh\nprintf \'child:%s\\n\' "$(basename "$0" .test.sh)" >> "$MODERATION_PROOF_COMMAND_LOG"\n',
    )
    await chmod(childPath, 0o700)
  }

  await writeFile(
    path.join(root, 'tests/integration/moderation-public-projection.test.ts'),
    'export {}\n',
  )

  await writeFile(
    supabaseBin,
    `#!/bin/sh
printf 'supabase:%s\\n' "$*" >> "$MODERATION_PROOF_COMMAND_LOG"
case "$*" in
  "projects list --output json")
    printf '%s\\n' '[{"id":"abcdefghijklmnopqrst","linked":true,"status":"ACTIVE_HEALTHY"}]'
    ;;
  "migration list --linked")
    printf '%s\\n' '{"migrations":[{"local":"20260826011475","remote":"20260826011475"}]}'
    ;;
  *"test db --linked"*)
    printf '%s\\n' 'LegacyDockerRunError: Docker Desktop is a prerequisite for local development.' >&2
    exit 1
    ;;
  *"db query --linked --file"*)
    printf '%s\\n' '{"result":[{"finish":"1..1","assertion":"ok 1 - contract"}]}'
    ;;
  *"db query --linked --output-format json"*)
    printf '%s\\n' '{"result":[{"policy_environment":"development","pgtap_count":0,"fixture_count":0}]}'
    ;;
  *"db lint --linked --schema public,private"*)
    ;;
  *"db push --linked --dry-run --output json"*)
    printf '%s\\n' '{"upToDate":true,"migrations":[],"seeds":[],"roles":[]}'
    ;;
  *)
    printf '%s\\n' "unexpected fake Supabase command: $*" >&2
    exit 64
    ;;
esac
`,
  )
  await chmod(supabaseBin, 0o700)

  await writeFile(
    path.join(fakeBin, 'pnpm'),
    '#!/bin/sh\nprintf \'pnpm:%s\\n\' "$*" >> "$MODERATION_PROOF_COMMAND_LOG"\n',
  )
  await chmod(path.join(fakeBin, 'pnpm'), 0o700)
  await chmod(runner, 0o700)

  const child = spawn('bash', [runner], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      MODERATION_PROOF_COMMAND_LOG: commandLog,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  const exitCode = await new Promise<number | null>((resolve) => child.on('close', resolve))

  return {
    exitCode,
    stdout,
    stderr,
    log: await readFile(commandLog, 'utf8'),
  }
}

async function executePartialBrowserCleanup(
  source: string,
  identities: readonly [string, string, string],
) {
  const root = await mkdtemp(path.join(tmpdir(), 'moderation-browser-cleanup-contract-'))
  temporaryDirectories.push(root)
  const cleanupLog = path.join(root, 'cleanup.log')
  const scriptPath = path.join(root, 'cleanup-contract.sh')
  const cleanupMatch = source.match(/cleanup\(\) \{[\s\S]*?\n\}\n\ntrap cleanup/)
  if (!cleanupMatch) throw new Error('Browser runner cleanup function is missing.')
  const cleanupSource = cleanupMatch[0].replace(/\n\ntrap cleanup$/, '')

  await writeFile(
    scriptPath,
    `#!/usr/bin/env bash
set -u
${cleanupSource}
delete_auth_user() { printf 'delete:%s\\n' "$1" >> "$CLEANUP_LOG"; }
verify_auth_user_absent() { printf 'verify:%s\\n' "$1" >> "$CLEANUP_LOG"; }
temporary_directory="$(mktemp -d "${root}/artifacts.XXXXXX")"
organizer_a_id='${identities[0]}'
organizer_b_id='${identities[1]}'
staff_id='${identities[2]}'
report_server_pid=''
admin_key='contract-admin'
supabase_url='https://contract.invalid'
supabase_cli='false'
known_bucket_sql="'contract'"
cleanup_failed=0
cleanup
`,
  )
  await chmod(scriptPath, 0o700)

  const child = spawn('bash', [scriptPath], {
    cwd: root,
    env: { ...process.env, CLEANUP_LOG: cleanupLog },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  const exitCode = await new Promise<number | null>((resolve) => child.on('close', resolve))
  return {
    exitCode,
    stderr,
    log: await readFile(cleanupLog, 'utf8'),
  }
}

describe('Build 2.5 moderation proof runner', () => {
  it('exposes one canonical package command', async () => {
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
      scripts?: Record<string, string>
    }

    expect(packageJson.scripts?.['test:integration:moderation']).toBe(
      'tests/integration/run-moderation-proof.sh',
    )
  })

  it('exposes closed Build 2.5 unit and Edge Function allowlists', async () => {
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
      scripts?: Record<string, string>
    }
    const build25Command = [
      'VITE_SUPABASE_URL=https://task16-disabled.supabase.co',
      'VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_task16_disabled',
      'VITE_MAPBOX_ACCESS_TOKEN=task16-disabled',
      'VITE_STRIPE_PUBLISHABLE_KEY=pk_test_task16_disabled',
      'vitest run',
      ...build25UnitPaths,
    ].join(' ')
    const moderationFunctionCommand = [
      'deno test --allow-env',
      'supabase/functions/report-event/index.test.ts',
      'supabase/functions/moderate-event-queue/index.test.ts',
    ].join(' ')

    expect(packageJson.scripts?.['test:build25']).toBe(build25Command)
    expect(packageJson.scripts?.['test:functions:moderation']).toBe(moderationFunctionCommand)
    expect(`${build25UnitPaths.join(' ')} supabase/functions/report-event/index.test.ts supabase/functions/moderate-event-queue/index.test.ts`).not.toMatch(
      /checkout|connect|webhook|refund|dispute|stripe/i,
    )
  })

  it('requires independent Auth cleanup and observed secondary browser pages', async () => {
    const [browserRunner, journey, ...specs] = await Promise.all([
      readFile(browserRunnerPath, 'utf8'),
      readFile(journeyPath, 'utf8'),
      ...browserSpecPaths.map((specPath) => readFile(specPath, 'utf8')),
    ])

    expect(browserRunner).toContain(
      'for user_id in "$organizer_a_id" "$organizer_b_id" "$staff_id"; do',
    )
    expect(browserRunner).toContain('verify_auth_user_absent "$user_id"')
    expect(journey).toContain('export async function newObservedPage(')
    for (const spec of specs) {
      expect(spec).not.toMatch(/\.newPage\(\)/)
    }

    const afterFirstUser = await executePartialBrowserCleanup(
      browserRunner,
      ['10000000-0000-4000-8000-000000000001', '', ''],
    )
    expect(afterFirstUser.exitCode, afterFirstUser.stderr).toBe(0)
    expect(afterFirstUser.log).toBe(
      'delete:10000000-0000-4000-8000-000000000001\n' +
      'verify:10000000-0000-4000-8000-000000000001\n',
    )

    const afterSecondUser = await executePartialBrowserCleanup(
      browserRunner,
      [
        '10000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000002',
        '',
      ],
    )
    expect(afterSecondUser.exitCode, afterSecondUser.stderr).toBe(0)
    expect(afterSecondUser.log).toBe(
      'delete:10000000-0000-4000-8000-000000000001\n' +
      'verify:10000000-0000-4000-8000-000000000001\n' +
      'delete:10000000-0000-4000-8000-000000000002\n' +
      'verify:10000000-0000-4000-8000-000000000002\n',
    )
  })

  it('runs the closed database-only child allowlist through the Docker fallback', async () => {
    expect(expectedChildren).toHaveLength(24)
    const source = await readRunnerSource()
    expect(source, 'the canonical moderation proof runner is missing').not.toBeNull()
    if (source === null) return

    const result = await executeRunner(source)
    expect(result.exitCode, result.stderr).toBe(0)
    expect(result.stdout).toContain('Moderation database proof passed (24/24 children).')

    for (const child of [...moderationSqlChildren, ...compatibilitySqlChildren]) {
      expect(result.log).toContain('supabase:db query --linked --file ')
      expect(result.log).toContain(`supabase/tests/database/${child}.test.sql`)
    }
    for (const child of shellChildren) {
      expect(result.log).toContain(`child:${child}`)
    }
    expect(result.log).toContain(
      'pnpm:exec vitest run --config vitest.integration.config.ts tests/integration/moderation-public-projection.test.ts',
    )
    expect(result.log).not.toMatch(
      /checkout_boundaries|checkout_rate_limit|connect_refresh|refunds_disputes|webhook_|payment_fulfillment_concurrency|stripe-/,
    )
  })

  it('fails when a required child invocation is omitted', async () => {
    const source = await readRunnerSource()
    expect(source, 'the canonical moderation proof runner is missing').not.toBeNull()
    if (source === null) return

    const invocation =
      'run_child "moderation_action_concurrency" "$repository_root/supabase/tests/database/moderation_action_concurrency.test.sh"'
    const mutated = source.replace(invocation, ': # mutation omits moderation_action_concurrency')
    expect(mutated).not.toBe(source)

    const result = await executeRunner(mutated)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('Required moderation proof child did not complete: moderation_action_concurrency')
  })
})
