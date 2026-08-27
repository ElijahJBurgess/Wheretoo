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
const packagePath = path.join(repositoryRoot, 'package.json')

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
    printf '%s\\n' '{"migrations":[{"local":"20260826011000","remote":"20260826011000"}]}'
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

describe('Build 2.5 moderation proof runner', () => {
  it('exposes one canonical package command', async () => {
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
      scripts?: Record<string, string>
    }

    expect(packageJson.scripts?.['test:integration:moderation']).toBe(
      'tests/integration/run-moderation-proof.sh',
    )
  })

  it('runs the closed database-only child allowlist through the Docker fallback', async () => {
    expect(expectedChildren).toHaveLength(23)
    const source = await readRunnerSource()
    expect(source, 'the canonical moderation proof runner is missing').not.toBeNull()
    if (source === null) return

    const result = await executeRunner(source)
    expect(result.exitCode, result.stderr).toBe(0)
    expect(result.stdout).toContain('Moderation database proof passed (23/23 children).')

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
