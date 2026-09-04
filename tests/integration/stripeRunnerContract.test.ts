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

async function runRunner(
  testFailure: boolean,
  priorSwitch = false,
  envOverrides: Record<string, string> = {},
  preexistingMaterialized = false,
) {
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
  if (preexistingMaterialized) {
    await mkdir(path.join(root, 'supabase/functions/task17-transaction-driver'), { recursive: true })
    await writeFile(
      path.join(root, 'supabase/functions/task17-transaction-driver/index.ts'),
      'preexisting source\n',
    )
  }
  await writeFile(path.join(root, 'supabase/.temp/project-ref'), 'abcdefghijklmnopqrst\n')
  const log = path.join(root, 'commands.log')
  const fakePnpm = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_COMMAND_LOG"
[ -z "\${STRIPE_SECRET_KEY-}" ] || printf '%s\\n' 'inherited-secret-visible' >> "$FAKE_COMMAND_LOG"
case "$*" in
  *"functions list"*) printf '%s\\n' '{"functions":[]}' ;;
  *"secrets list"*) printf '%s\\n' '{"secrets":[]}' ;;
  *"db query"*"with restored as"*) printf '%s\\n' '{"rows":[{"restored":true}]}' ;;
  *"db query"*"with enabled as"*) printf '%s\\n' '{"rows":[{"enabled":true}]}' ;;
  *"db query"*"select checkout_creation_enabled"*) printf '{"rows":[{"enabled":%s}]}\\n' "$FAKE_PRIOR_SWITCH" ;;
  *"functions deploy"*)
    mode=$(stat -f '%Lp' "$PWD/supabase/functions/task17-transaction-driver/index.ts")
    printf 'materialized-mode %s\\n' "$mode" >> "$FAKE_COMMAND_LOG"
    ;;
  *"secrets set --env-file"*)
    previous=''
    for argument in "$@"; do
      if [ "$previous" = '--env-file' ]; then
        mode=$(stat -f '%Lp' "$argument")
        printf 'secret-file-mode %s\\n' "$mode" >> "$FAKE_COMMAND_LOG"
      fi
      previous=$argument
    done
    [ "$FAKE_SECRET_SET_FAILURE" = 0 ]
    ;;
  *"vitest run"*) [ "$FAKE_TEST_FAILURE" = 0 ] ;;
esac
`
  const fakeCurl = `#!/bin/sh
printf 'curl %s\\n' "$*" >> "$FAKE_COMMAND_LOG"
previous=''
for argument in "$@"; do
  if [ "$previous" = '--config' ]; then
    mode=$(stat -f '%Lp' "$argument")
    printf 'curl-config-mode %s\\n' "$mode" >> "$FAKE_COMMAND_LOG"
  fi
  previous=$argument
done
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
      FAKE_PRIOR_SWITCH: priorSwitch ? 'true' : 'false',
      FAKE_SECRET_SET_FAILURE: '0',
      TEST_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      TEST_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_contract',
      VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_contract',
      TEST_CONNECTED_ACCOUNT_ID: 'acct_Task17Contract',
      TEST_CONNECTED_ACCOUNT_DISPOSABLE: '1',
      ...envOverrides,
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
    log: await readFile(log, 'utf8').catch(() => ''),
    materializedExists: await import('node:fs').then(({ existsSync }) =>
      existsSync(path.join(root, 'supabase/functions/task17-transaction-driver/index.ts'))),
    materializedContents: await readFile(
      path.join(root, 'supabase/functions/task17-transaction-driver/index.ts'),
      'utf8',
    ).catch(() => null),
  }
}

describe('Task 17 managed proof runner', () => {
  it('deploys the committed driver and tears down the endpoint and temporary secrets', async () => {
    const result = await runRunner(false)
    expect(result.exitCode).toBe(0)
    expect(result.log).toContain('supabase secrets set --env-file')
    expect(result.log).toContain('db query --linked --output-format json select checkout_creation_enabled')
    expect(result.log).toContain('set checkout_creation_enabled = true')
    expect(result.log).toContain('set checkout_creation_enabled = false')
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
    expect(result.log).toContain('secret-file-mode 600')
    expect(result.log).toContain('curl-config-mode 600')
    expect(result.log).toContain('materialized-mode 600')
    expect(result.materializedExists).toBe(false)
  })

  it('runs the same teardown when the canonical proof fails', async () => {
    const result = await runRunner(true)
    expect(result.exitCode).not.toBe(0)
    expect(result.log).toContain('curl ')
    expect(result.log).toContain('set checkout_creation_enabled = false')
    expect(result.log).toContain('supabase functions delete task17-transaction-driver')
    expect(result.log).toContain(
      'supabase secrets unset TASK17_PROOF_TOKEN TASK17_FIXTURE_PREFIX TASK17_CONNECTED_ACCOUNT_ID TASK17_CLOSE_CONNECTED_ACCOUNT',
    )
    expect(result.materializedExists).toBe(false)
  })

  it('restores an enabled prior switch after the proof succeeds', async () => {
    const result = await runRunner(false, true)
    expect(result.exitCode).toBe(0)
    expect(result.log).toContain('set checkout_creation_enabled = true')
    expect(result.log.match(/set checkout_creation_enabled = true/g)).toHaveLength(2)
  })

  it('rejects an inherited live restricted key before fixture collection', async () => {
    const result = await runRunner(false, false, { STRIPE_RESTRICTED_KEY: 'rk_live_forbidden' })
    expect(result.exitCode).not.toBe(0)
    expect(result.log).not.toContain('set checkout_creation_enabled = true')
    expect(result.log).not.toContain('functions deploy task17-transaction-driver')
    expect(result.log).not.toContain('curl ')
  })

  it('rejects any inherited live secret key before fixture collection', async () => {
    const result = await runRunner(false, false, { STRIPE_SECRET_KEY: 'sk_live_forbidden' })
    expect(result.exitCode).not.toBe(0)
    expect(result.log).not.toContain('set checkout_creation_enabled = true')
    expect(result.log).not.toContain('functions deploy task17-transaction-driver')
    expect(result.log).not.toContain('curl ')
  })

  it('attempts secret teardown when temporary secret installation fails partway', async () => {
    const result = await runRunner(false, false, { FAKE_SECRET_SET_FAILURE: '1' })
    expect(result.exitCode).not.toBe(0)
    expect(result.log).toContain(
      'supabase secrets unset TASK17_PROOF_TOKEN TASK17_FIXTURE_PREFIX TASK17_CONNECTED_ACCOUNT_ID TASK17_CLOSE_CONNECTED_ACCOUNT',
    )
    expect(result.log).not.toContain('functions deploy task17-transaction-driver')
    expect(result.materializedExists).toBe(false)
  })

  it('does not pass an inherited unused Stripe secret into child processes', async () => {
    const result = await runRunner(false, false, { STRIPE_SECRET_KEY: 'sk_test_unused' })
    expect(result.exitCode).toBe(0)
    expect(result.log).not.toContain('inherited-secret-visible')
  })

  it('refuses to replace or remove a pre-existing local driver materialization', async () => {
    const result = await runRunner(false, false, {}, true)
    expect(result.exitCode).not.toBe(0)
    expect(result.materializedContents).toBe('preexisting source\n')
    expect(result.log).not.toContain('functions deploy task17-transaction-driver')
  })
})
