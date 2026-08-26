import { chmod, cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const temporaryDirectories: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })))
})

async function runRunner(testFailure: boolean) {
  const root = await mkdtemp(path.join(tmpdir(), 'task17-runner-'))
  temporaryDirectories.push(root)
  await mkdir(path.join(root, 'tests/integration/edge/task17-transaction-driver'), { recursive: true })
  await mkdir(path.join(root, 'supabase/functions'), { recursive: true })
  await mkdir(path.join(root, 'supabase/.temp'), { recursive: true })
  await mkdir(path.join(root, 'fake-bin'), { recursive: true })
  await cp(
    new URL('./run-stripe-ticketing-proof.sh', import.meta.url),
    path.join(root, 'tests/integration/run-stripe-ticketing-proof.sh'),
  )
  await cp(
    new URL('./edge/task17-transaction-driver/index.ts', import.meta.url),
    path.join(root, 'tests/integration/edge/task17-transaction-driver/index.ts'),
  )
  await writeFile(path.join(root, 'supabase/.temp/project-ref'), 'abcdefghijklmnopqrst\n')
  const log = path.join(root, 'commands.log')
  const fakePnpm = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_COMMAND_LOG"
case "$*" in
  *"functions list"*) printf '%s\\n' '{"functions":[]}' ;;
  *"secrets list"*) printf '%s\\n' '{"secrets":[]}' ;;
  *"vitest run"*) [ "$FAKE_TEST_FAILURE" = 0 ] ;;
esac
`
  const fakeCurl = `#!/bin/sh
printf 'curl %s\\n' "$*" >> "$FAKE_COMMAND_LOG"
printf '%s\\n' '{"ok":true,"event_count":0,"organizer_count":0,"connect_count":0,"order_count":0,"tier_count":0,"receipt_count":0,"ticket_count":0,"dispute_count":0,"refund_count":0,"item_count":0,"connected_account_closed":true}'
`
  await writeFile(path.join(root, 'fake-bin/pnpm'), fakePnpm)
  await writeFile(path.join(root, 'fake-bin/curl'), fakeCurl)
  await chmod(path.join(root, 'fake-bin/pnpm'), 0o700)
  await chmod(path.join(root, 'fake-bin/curl'), 0o700)

  const child = spawn('sh', [path.join(root, 'tests/integration/run-stripe-ticketing-proof.sh')], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${path.join(root, 'fake-bin')}:${process.env.PATH ?? ''}`,
      FAKE_COMMAND_LOG: log,
      FAKE_TEST_FAILURE: testFailure ? '1' : '0',
      TEST_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      TEST_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_contract',
      VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_contract',
      TEST_CONNECTED_ACCOUNT_ID: 'acct_Task17Contract',
      TEST_CONNECTED_ACCOUNT_DISPOSABLE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const [exitCode] = await Promise.all([
    new Promise<number | null>((resolve) => child.on('close', resolve)),
    new Promise<void>((resolve) => child.stdout.on('end', resolve)),
    new Promise<void>((resolve) => child.stderr.on('end', resolve)),
  ])
  return {
    exitCode,
    log: await readFile(log, 'utf8'),
    materializedExists: await import('node:fs').then(({ existsSync }) =>
      existsSync(path.join(root, 'supabase/functions/task17-transaction-driver/index.ts'))),
  }
}

describe('Task 17 managed proof runner', () => {
  it('deploys the committed driver and tears down the endpoint and temporary secrets', async () => {
    const result = await runRunner(false)
    expect(result.exitCode).toBe(0)
    expect(result.log).toContain('supabase secrets set --env-file')
    expect(result.log).toContain('supabase functions deploy task17-transaction-driver')
    expect(result.log).toContain('vitest run --config vitest.integration.config.ts tests/integration/stripe-ticketing.test.ts')
    expect(result.log).toContain('curl ')
    expect(result.log).toContain('supabase functions delete task17-transaction-driver')
    expect(result.log).toContain(
      'supabase secrets unset TASK17_PROOF_TOKEN TASK17_FIXTURE_PREFIX TASK17_CONNECTED_ACCOUNT_ID TASK17_CLOSE_CONNECTED_ACCOUNT',
    )
    expect(result.log.indexOf('curl ')).toBeLessThan(
      result.log.indexOf('supabase functions delete task17-transaction-driver'),
    )
    expect(result.log.indexOf('supabase functions delete task17-transaction-driver')).toBeLessThan(
      result.log.indexOf('supabase secrets unset TASK17_PROOF_TOKEN'),
    )
    expect(result.log).not.toContain('STRIPE_RESTRICTED_KEY=')
    expect(result.log).not.toContain('STRIPE_WEBHOOK_SECRET=')
    expect(result.materializedExists).toBe(false)
  })

  it('runs the same teardown when the canonical proof fails', async () => {
    const result = await runRunner(true)
    expect(result.exitCode).not.toBe(0)
    expect(result.log).toContain('curl ')
    expect(result.log).toContain('supabase functions delete task17-transaction-driver')
    expect(result.log).toContain(
      'supabase secrets unset TASK17_PROOF_TOKEN TASK17_FIXTURE_PREFIX TASK17_CONNECTED_ACCOUNT_ID TASK17_CLOSE_CONNECTED_ACCOUNT',
    )
    expect(result.materializedExists).toBe(false)
  })
})
