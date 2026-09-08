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
  await mkdir(path.join(root, 'tests/integration/sql'), { recursive: true })
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
  await cp(
    new URL('./edge/task17-transaction-driver/contracts.ts', import.meta.url),
    path.join(root, 'tests/integration/edge/task17-transaction-driver/contracts.ts'),
  )
  await cp(
    new URL('./task17CleanupSql.sh', import.meta.url),
    path.join(root, 'tests/integration/task17CleanupSql.sh'),
  )
  await cp(
    new URL('./sql/task17-cleanup-runtime.sql', import.meta.url),
    path.join(root, 'tests/integration/sql/task17-cleanup-runtime.sql'),
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
previous=''
query_file=''
for argument in "$@"; do
  if [ "$previous" = '--file' ]; then query_file="$argument"; fi
  previous="$argument"
done
if [ -n "$query_file" ] && grep -q 'task17_cleanup_receipts' "$query_file"; then
  sed -n '1,520p' "$query_file" >> "$FAKE_COMMAND_LOG"
  if [ "$FAKE_DATABASE_CLEANUP_FAILURE" != 0 ]; then
    printf '%s\\n' 'unsafe database detail' >&2
    exit 1
  fi
fi
case "$*" in
  *"projects list"*)
    [ "$FAKE_PROJECT_LIST_FAILURE" = 0 ] || exit 1
    printf '%s\\n' "$FAKE_PROJECTS_RESPONSE"
    ;;
  *"functions list"*) printf '%s\\n' '{"functions":[]}' ;;
  *"secrets list"*) printf '%s\\n' '{"secrets":[]}' ;;
  *"migration list"*) printf '%s\\n' '{"migrations":[{"local":"123","remote":"123"}]}' ;;
  *"db query"*"policy_environment"*)
    [ "$FAKE_POLICY_QUERY_FAILURE" = 0 ] || exit 1
    printf '%s\\n' "$FAKE_POLICY_RESPONSE"
    ;;
  *"db query"*"residual_fixture_candidate"*)
    if [ "\${FAKE_RESIDUAL_QUERY_FAILURE:-0}" = 1 ]; then
      printf '%s\\n' 'unsafe database detail' >&2
      exit 1
    fi
    printf '%s\\n' "$FAKE_RESIDUAL_FIXTURE_RESPONSE"
    ;;
  *"db query"*"stable_fixture_candidate"*) printf '%s\\n' "$FAKE_STABLE_FIXTURE_RESPONSE" ;;
  *"db query"*"task17_cleanup_receipts"*)
    if [ "$FAKE_DATABASE_CLEANUP_FAILURE" != 0 ]; then
      printf '%s\n' 'unsafe database detail' >&2
      exit 1
    fi
    ;;
  *"db query"*"event_public_eligibility_intervals"*) printf '%s\\n' "$FAKE_TOMBSTONE_AUDIT_RESPONSE" ;;
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
        sed -n 's/^TASK17_FIXTURE_PREFIX=/fixture-prefix /p' "$argument" >> "$FAKE_COMMAND_LOG"
        if grep -q '^TASK17_CLOSE_CONNECTED_ACCOUNT=true$' "$argument"; then
          printf '%s\\n' 'retirement-authorization true' >> "$FAKE_COMMAND_LOG"
        fi
        if grep -q '^TASK17_CLOSE_CONNECTED_ACCOUNT=false$' "$argument"; then
          printf '%s\\n' 'retirement-authorization false' >> "$FAKE_COMMAND_LOG"
        fi
      fi
      previous=$argument
    done
    [ "$FAKE_SECRET_SET_FAILURE" = 0 ]
    ;;
  *"deno check"*) [ -f "$PWD/supabase/functions/task17-transaction-driver/contracts.ts" ] ;;
  *"vitest run"*)
    printf 'fixture-prefix %s\\n' "$TEST_STRIPE_FIXTURE_PREFIX" >> "$FAKE_COMMAND_LOG"
    [ "$FAKE_TEST_FAILURE" = 0 ]
    ;;
esac
`
  const fakeCurl = `#!/bin/sh
printf 'curl %s\\n' "$*" >> "$FAKE_COMMAND_LOG"
previous=''
config_file=''
for argument in "$@"; do
  if [ "$previous" = '--config' ]; then
    config_file="$argument"
    mode=$(stat -f '%Lp' "$argument")
    printf 'curl-config-mode %s\\n' "$mode" >> "$FAKE_COMMAND_LOG"
  fi
  previous=$argument
done
if grep -q 'recover_refund' "$config_file"; then
  printf '%s\\n' 'curl-action recover_refund' >> "$FAKE_COMMAND_LOG"
  printf '%s\\n' "$FAKE_RECOVERY_RESPONSE"
elif grep -q 'account_diagnostic' "$config_file"; then
  printf '%s\\n' 'curl-action account_diagnostic' >> "$FAKE_COMMAND_LOG"
  printf '%s\\n' "$FAKE_DIAGNOSTIC_RESPONSE"
elif grep -q 'checkout_diagnostic' "$config_file"; then
  printf '%s\\n' 'curl-action checkout_diagnostic' >> "$FAKE_COMMAND_LOG"
  printf '%s\\n' "$FAKE_CHECKOUT_DIAGNOSTIC_RESPONSE"
elif grep -q 'fixture_preflight' "$config_file"; then
  printf '%s\\n' 'curl-action fixture_preflight' >> "$FAKE_COMMAND_LOG"
  printf '%s\\n' "$FAKE_FIXTURE_PREFLIGHT_RESPONSE"
elif grep -q 'retire_connected_account' "$config_file"; then
  printf '%s\\n' 'curl-action retire_connected_account' >> "$FAKE_COMMAND_LOG"
  printf '%s\\n' "$FAKE_RETIREMENT_RESPONSE"
else
  if grep -q 'close_connected_account.*true' "$config_file"; then
    printf '%s\\n' 'cleanup-close-request true' >> "$FAKE_COMMAND_LOG"
  else
    printf '%s\\n' 'cleanup-close-request false' >> "$FAKE_COMMAND_LOG"
  fi
  printf '%s\\n' "$FAKE_CLEANUP_RESPONSE"
  [ "$FAKE_CLEANUP_FAILURE" = 0 ]
fi
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
      FAKE_PROJECT_LIST_FAILURE: '0',
      FAKE_PROJECTS_RESPONSE: '[{"id":"abcdefghijklmnopqrst","linked":true,"status":"ACTIVE_HEALTHY"}]',
      FAKE_POLICY_QUERY_FAILURE: '0',
      FAKE_POLICY_RESPONSE: '{"rows":[{"policy_environment":"development"}]}',
      FAKE_RESIDUAL_QUERY_FAILURE: '0',
      FAKE_STABLE_FIXTURE_RESPONSE: '{"rows":[]}',
      FAKE_RESIDUAL_FIXTURE_RESPONSE: '{"rows":[]}',
      FAKE_TOMBSTONE_AUDIT_RESPONSE: '{"rows":[{"namespace_prefix_count":1,"event_count":1,"organizer_count":1,"auth_user_inert":true,"audit_interval_count":3,"audit_action_count":3,"open_eligible_interval_count":0,"active_tier_count":0,"tier_count":0,"connect_count":0,"order_count":0,"item_count":0,"ticket_count":0,"refund_count":0,"staff_role_count":0,"public_projection_count":0,"event_tombstoned":true}]}',
      FAKE_DIAGNOSTIC_RESPONSE: '{"ok":true,"restricted_key_authenticated":true,"webhook_signature_verified":true,"livemode":false,"connected_account_matches":true,"transfers_status":"active","payouts_status":"active","requirements_status":"clear"}',
      FAKE_CHECKOUT_DIAGNOSTIC_RESPONSE: '{"ok":true,"candidate_count":1,"session_contract":{"session_object_valid":true,"test_mode":true,"payment_mode":true,"currency_usd":true,"subtotal_exact":true,"total_exact":true,"payment_status_unpaid":true,"fixture_buyer_bound":true,"client_reference_bound":true,"metadata_bound":true,"integration_identifier_bound":true,"automatic_tax_disabled":true,"line_items_complete":true,"line_count_exact":true,"admission_count_exact":true,"line_amounts_exact":true,"line_bindings_unique":true,"payment_intent_present":false,"payment_intent_expanded":false,"payment_intent_test_mode":false,"payment_intent_amount_exact":false,"application_fee_exact":false,"destination_bound":false,"payment_intent_metadata_bound":false,"failure_cleanup_expired":true}}',
      FAKE_FIXTURE_PREFLIGHT_RESPONSE: '{"ok":true,"fixture_purchasable":true,"cleanup_strategy":"audit_tombstone","stable_fixture":true}',
      FAKE_CLEANUP_RESPONSE: '{"ok":true,"stable_fixture":true,"fixture_reusable":true,"event_count":1,"organizer_count":1,"auth_user_inert":true,"event_sellable":false,"public_projection_count":0,"active_tier_count":0,"connect_count":0,"order_count":0,"item_count":0,"ticket_count":0,"receipt_count":0,"refund_count":0,"dispute_count":0,"connected_account_closed":false,"connected_account_preserved":true}',
      FAKE_CLEANUP_FAILURE: '0',
      FAKE_DATABASE_CLEANUP_FAILURE: '0',
      FAKE_RETIREMENT_RESPONSE: '{"ok":true,"connected_account_closed":true,"connected_account_preserved":false}',
      TEST_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      TEST_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_contract',
      VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_contract',
      TEST_CONNECTED_ACCOUNT_ID: 'acct_Task17Contract',
      TEST_CONNECTED_ACCOUNT_DISPOSABLE: '1',
      ...envOverrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += String(chunk) })
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })
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
    materializedContractsExist: await import('node:fs').then(({ existsSync }) =>
      existsSync(path.join(root, 'supabase/functions/task17-transaction-driver/contracts.ts'))),
    materializedContents: await readFile(
      path.join(root, 'supabase/functions/task17-transaction-driver/index.ts'),
      'utf8',
    ).catch(() => null),
    stdout,
    stderr,
  }
}

describe('Task 17 managed proof runner', () => {
  it.each([true, false])('Task14 recovery-only never enables checkout or creates/retire objects (certified=%s)', async (certified) => {
    const result = await runRunner(false, false, {
      TASK14_REFUND_RECOVERY_ONLY: '1',
      FAKE_RESIDUAL_FIXTURE_RESPONSE: '{"rows":[{"residual_fixture_candidate":"task17_checkout0001","residual_fixture_exact":true}]}',
      FAKE_RECOVERY_RESPONSE: JSON.stringify({ ok: true, livemode: false, amount: 5500, reversal_amount: 5500, application_fee_refund_amount: 425, order_refunded: certified, reconciled: certified, refund_count: 1, policy_verified: certified, ticket_count: 3, invalid_ticket_count: 3, refunded_ticket_count: 3 }),
    })
    expect(result.exitCode).toBe(certified ? 0 : 1)
    expect(result.log).toContain('curl-action recover_refund')
    expect(result.log).not.toContain('curl-action fixture_preflight')
    expect(result.log).not.toContain('curl-action checkout_diagnostic')
    expect(result.log).not.toContain('curl-action retire_connected_account')
    expect(result.log).not.toContain('with enabled as')
    expect(result.log).not.toContain('vitest run')
    expect(result.log.includes('task17_cleanup_receipts')).toBe(certified)
    expect(result.materializedExists).toBe(false)
  })
  const exactResidual = '{"rows":[{"residual_fixture_candidate":"task17_oldfixture01","residual_fixture_exact":true}]}'
  const exactResidualCleanup = '{"ok":true,"stable_fixture":true,"fixture_reusable":true,"event_count":1,"organizer_count":1,"auth_user_inert":true,"event_sellable":false,"public_projection_count":0,"active_tier_count":2,"tier_count":2,"connect_count":1,"order_count":1,"item_count":2,"ticket_count":0,"receipt_count":1,"refund_count":0,"dispute_count":0,"database_cleanup_required":true,"connected_account_closed":false,"connected_account_preserved":true}'

  it('cleanup-only accepts the exact inert residual and invokes only cleanup before audit teardown', async () => {
    const result = await runRunner(false, false, {
      TASK13_CLEANUP_ONLY: '1',
      FAKE_RESIDUAL_FIXTURE_RESPONSE: exactResidual,
      FAKE_CLEANUP_RESPONSE: exactResidualCleanup,
    })

    expect(result.exitCode).toBe(0)
    expect(result.log).toContain('residual_fixture_candidate')
    expect(result.log).toContain('owner.banned_until > statement_timestamp()')
    expect(result.log).toContain('not exists (select 1 from public.get_public_event')
    expect(result.log).toContain('orders.quantity = 3')
    expect(result.log).toContain('orders.subtotal_minor = 5500')
    expect(result.log).toContain('orders.application_fee_amount_minor = 425')
    expect(result.log).toContain("orders.status = 'expired'")
    expect(result.log).toContain("orders.status <> 'expired'")
    expect(result.log).toContain('orders.reservation_expires_at <= statement_timestamp()')
    expect(result.log).toContain('orders.reservation_expires_at is null')
    expect(result.log).toContain('orders.expired_at is not null')
    expect(result.log).toContain('orders.expired_at is null')
    expect(result.log).toContain('count(*) from public.ticket_tiers')
    expect(result.log).toContain('count(*) from public.order_items')
    expect(result.log.match(/tiers\.name = 'Task 17 General Admission'/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
    expect(result.log.match(/tiers\.name = 'Task 17 VIP'/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
    expect(result.log).toContain("error_code = 'STRIPE_OBJECT_INVALID'")
    expect(result.log).toContain('fixture-prefix task17_oldfixture01')
    expect(result.log).toContain('cleanup-close-request false')
    expect(result.log).toContain('task17_cleanup_receipts')
    expect(result.log).toContain('event_public_eligibility_intervals')
    expect(result.log.indexOf('cleanup-close-request false')).toBeLessThan(
      result.log.lastIndexOf('event_public_eligibility_intervals'),
    )
    expect(result.log).not.toContain('curl-action account_diagnostic')
    expect(result.log).not.toContain('curl-action checkout_diagnostic')
    expect(result.log).not.toContain('curl-action fixture_preflight')
    expect(result.log).not.toContain('set checkout_creation_enabled = true')
    expect(result.log).not.toContain('vitest run')
    expect(result.log).not.toContain('retirement-authorization true')
    expect(result.log).not.toContain('curl-action retire_connected_account')
    expect(result.log.match(/select checkout_creation_enabled as enabled/g)).toHaveLength(2)
    expect(result.log).toContain('supabase functions delete task17-transaction-driver')
    expect(result.log).toContain(
      'supabase secrets unset TASK17_PROOF_TOKEN TASK17_FIXTURE_PREFIX TASK17_CONNECTED_ACCOUNT_ID TASK17_CLOSE_CONNECTED_ACCOUNT',
    )
    expect(result.materializedExists).toBe(false)
    expect(result.materializedContractsExist).toBe(false)
  })

  it('cleanup-only requires checkout to be disabled before temporary deployment', async () => {
    const result = await runRunner(false, true, {
      TASK13_CLEANUP_ONLY: '1',
      FAKE_RESIDUAL_FIXTURE_RESPONSE: exactResidual,
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.log).toContain('select checkout_creation_enabled')
    expect(result.log).not.toContain('supabase secrets set --env-file')
    expect(result.log).not.toContain('functions deploy task17-transaction-driver')
    expect(result.log).not.toContain('curl ')
    expect(result.log).not.toContain('set checkout_creation_enabled = true')
  })

  it.each([
    '{"rows":[]}',
    '{"rows":[{"residual_fixture_candidate":"task17_oldfixture01","residual_fixture_exact":false}]}',
    '{"rows":[{"residual_fixture_candidate":"task17_oldfixture01","residual_fixture_exact":true,"unexpected":true}]}',
    '{"rows":[{"residual_fixture_candidate":"task17_oldfixture01","residual_fixture_exact":true},{"residual_fixture_candidate":"task17_otherfix01","residual_fixture_exact":true}]}',
    'unsafe database detail',
  ])('cleanup-only rejects every non-exact residual candidate set', async (response) => {
    const result = await runRunner(false, false, {
      TASK13_CLEANUP_ONLY: '1',
      FAKE_RESIDUAL_FIXTURE_RESPONSE: response,
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.stdout).toContain('Task 17 cleanup error kind: CLEANUP_RESIDUAL_ADMISSION_FAILED')
    expect(result.stdout).not.toContain('unsafe database detail')
    expect(result.stderr).not.toContain('unsafe database detail')
    expect(result.log).not.toContain('supabase secrets set --env-file')
    expect(result.log).not.toContain('functions deploy task17-transaction-driver')
    expect(result.log).not.toContain('curl ')
    expect(result.log).not.toContain('set checkout_creation_enabled = true')
  })

  it('cleanup-only reports a sanitized residual-query stage before deployment', async () => {
    const result = await runRunner(false, false, {
      TASK13_CLEANUP_ONLY: '1',
      FAKE_RESIDUAL_QUERY_FAILURE: '1',
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.stdout).toContain('Task 17 cleanup error kind: CLEANUP_RESIDUAL_QUERY_FAILED')
    expect(result.stdout).not.toContain('unsafe database detail')
    expect(result.stderr).not.toContain('unsafe database detail')
    expect(result.log).not.toContain('supabase secrets set --env-file')
    expect(result.log).not.toContain('functions deploy task17-transaction-driver')
    expect(result.log).not.toContain('curl ')
  })

  it.each([
    'CLEANUP_SESSION_RETRIEVE_FAILED',
    'CLEANUP_SESSION_EXPIRE_FAILED',
    'CLEANUP_CATALOG_DISCOVERY_FAILED',
    'CLEANUP_PRICE_ARCHIVE_FAILED',
    'CLEANUP_PRODUCT_ARCHIVE_FAILED',
    'DATABASE_DELETE_AUTH',
  ])('cleanup-only reports fixed stage %s without leaking provider detail', async (kind) => {
    const result = await runRunner(false, false, {
      TASK13_CLEANUP_ONLY: '1',
      FAKE_RESIDUAL_FIXTURE_RESPONSE: exactResidual,
      FAKE_CLEANUP_FAILURE: '1',
      FAKE_CLEANUP_RESPONSE: JSON.stringify({ ok: false, kind }),
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.stdout).toContain(`Task 17 cleanup error kind: ${kind}`)
    expect(result.stdout).not.toContain('provider detail')
    expect(result.log).not.toContain('set checkout_creation_enabled = true')
    expect(result.log).not.toContain('vitest run')
    expect(result.log).not.toContain('curl-action retire_connected_account')
    expect(result.log).toContain('supabase functions delete task17-transaction-driver')
  })

  it('cleanup-only reports only the bounded Price failure diagnostic', async () => {
    const result = await runRunner(false, false, {
      TASK13_CLEANUP_ONLY: '1',
      FAKE_RESIDUAL_FIXTURE_RESPONSE: exactResidual,
      FAKE_CLEANUP_FAILURE: '1',
      FAKE_CLEANUP_RESPONSE: JSON.stringify({
        ok: false,
        kind: 'CLEANUP_PRICE_ARCHIVE_FAILED',
        cleanup_diagnostic: {
          request_reached_stripe: true,
          failure_class: 'PERMISSION',
          http_status: 403,
          provider_message: 'raw provider detail must not escape',
        },
      }),
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.stdout).toContain(
      'Task 17 cleanup diagnostic: request_reached_stripe=true failure_class=PERMISSION http_status=403',
    )
    expect(result.stdout).not.toContain('raw provider detail')
    expect(result.stderr).not.toContain('raw provider detail')
    expect(result.log).not.toContain('set checkout_creation_enabled = true')
    expect(result.log).not.toContain('vitest run')
    expect(result.log).not.toContain('curl-action retire_connected_account')
  })

  it('cleanup-only database deletion is one rollback-safe transaction and can be retried', async () => {
    const first = await runRunner(false, false, {
      TASK13_CLEANUP_ONLY: '1',
      FAKE_RESIDUAL_FIXTURE_RESPONSE: exactResidual,
      FAKE_DATABASE_CLEANUP_FAILURE: '1',
      FAKE_CLEANUP_RESPONSE: exactResidualCleanup,
    })
    const retried = await runRunner(false, false, {
      TASK13_CLEANUP_ONLY: '1',
      FAKE_RESIDUAL_FIXTURE_RESPONSE: exactResidual,
      FAKE_CLEANUP_RESPONSE: exactResidualCleanup,
    })

    expect(first.exitCode).not.toBe(0)
    expect(first.stdout).toContain('Task 17 cleanup error kind: DATABASE_DELETE_RUNTIME')
    expect(first.stdout).not.toContain('unsafe database detail')
    expect(first.stderr).not.toContain('unsafe database detail')
    expect(retried.exitCode).toBe(0)
    for (const result of [first, retried]) {
      const transaction = result.log.match(/begin;[\s\S]*?create temporary table task17_cleanup_receipts[\s\S]*?commit;/)?.[0] ?? ''
      expect(transaction).toContain('create temporary table task17_cleanup_receipts')
      expect(transaction).toContain('delete from public.refunds')
      expect(transaction).toContain('delete from public.orders')
      expect(transaction).toContain('delete from public.stripe_webhook_events')
      expect(transaction).toMatch(/exists \(\s*select 1 from private\.staff_roles/)
      expect(transaction).toContain("evaluations.status = 'queued'")
      expect(transaction).toContain("evaluations.source = 'contextual'")
      expect(transaction).toMatch(/exists \(\s*select 1 from public\.disputes/)
      expect(transaction).not.toContain('delete from public.disputes')
      expect(transaction.indexOf('create temporary table task17_cleanup_receipts')).toBeLessThan(
        transaction.indexOf('delete from public.refunds'),
      )
      expect(transaction.indexOf('delete from public.refunds')).toBeLessThan(
        transaction.indexOf('delete from public.stripe_webhook_events'),
      )
      expect(result.log).not.toContain('set checkout_creation_enabled = true')
      expect(result.log).not.toContain('curl-action retire_connected_account')
    }
  })

  it('cleanup-only can be rerun in a new process after a provider stage failure', async () => {
    const failed = await runRunner(false, false, {
      TASK13_CLEANUP_ONLY: '1',
      FAKE_RESIDUAL_FIXTURE_RESPONSE: exactResidual,
      FAKE_CLEANUP_FAILURE: '1',
      FAKE_CLEANUP_RESPONSE: JSON.stringify({
        ok: false,
        kind: 'CLEANUP_PRODUCT_ARCHIVE_FAILED',
      }),
    })
    const retried = await runRunner(false, false, {
      TASK13_CLEANUP_ONLY: '1',
      FAKE_RESIDUAL_FIXTURE_RESPONSE: exactResidual,
      FAKE_CLEANUP_RESPONSE: exactResidualCleanup,
    })

    expect(failed.exitCode).not.toBe(0)
    expect(failed.log).not.toContain('task17_cleanup_receipts')
    expect(retried.exitCode).toBe(0)
    expect(retried.log).toContain('task17_cleanup_receipts')
  })

  const invalidCleanupModes: Array<Record<string, string>> = [
    { TASK13_CLEANUP_ONLY: '2' },
    { TASK13_BROWSER_DIAGNOSTIC_ONLY: '2' },
    { TASK13_CLEANUP_ONLY: '1', TASK13_FIXTURE_PREFLIGHT_ONLY: '1' },
    { TASK13_CLEANUP_ONLY: '1', TASK13_CHECKOUT_DIAGNOSTIC_ONLY: '1' },
    { TASK13_BROWSER_DIAGNOSTIC_ONLY: '1', TASK13_FIXTURE_PREFLIGHT_ONLY: '1' },
    { TASK13_BROWSER_DIAGNOSTIC_ONLY: '1', TASK13_CHECKOUT_DIAGNOSTIC_ONLY: '1' },
    { TASK13_BROWSER_DIAGNOSTIC_ONLY: '1', TASK13_CLEANUP_ONLY: '1' },
  ]

  it.each(invalidCleanupModes)('rejects invalid or overlapping cleanup-only modes before mutation', async (overrides) => {
    const result = await runRunner(false, false, overrides)

    expect(result.exitCode).not.toBe(0)
    expect(result.log).not.toContain('supabase secrets set --env-file')
    expect(result.log).not.toContain('functions deploy task17-transaction-driver')
    expect(result.log).not.toContain('curl ')
  })

  it.each([
    ['zero', '{"rows":[]}'],
    ['ambiguous', '{"rows":[{"stable_fixture_candidate":"task17_oldfixture01","stable_fixture_recoverable":true,"stable_fixture_safe":true},{"stable_fixture_candidate":"task17_checkout0001","stable_fixture_recoverable":true,"stable_fixture_safe":true}]}'],
  ])('Task 14 rejects %s stable fixture candidates before any deployment or setup', async (_label, response) => {
    const result = await runRunner(false, false, {
      TASK14_BROWSER_PROJECT: 'mobile-chromium',
      VITE_MAPBOX_ACCESS_TOKEN: 'pk.local_contract',
      FAKE_STABLE_FIXTURE_RESPONSE: response,
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.log).toContain('stable_fixture_candidate')
    expect(result.log).not.toContain('supabase secrets set --env-file')
    expect(result.log).not.toContain('functions deploy task17-transaction-driver')
    expect(result.log).not.toContain('curl ')
    expect(result.log).not.toContain('set checkout_creation_enabled = true')
    expect(result.log).not.toContain('playwright test')
    expect(result.materializedExists).toBe(false)
    expect(result.materializedContractsExist).toBe(false)
  })

  it('Task 14 admits exactly one existing stable fixture without substituting a seed prefix', async () => {
    const result = await runRunner(false, false, {
      TASK14_BROWSER_PROJECT: 'desktop-chromium',
      VITE_MAPBOX_ACCESS_TOKEN: 'pk.local_contract',
      FAKE_STABLE_FIXTURE_RESPONSE: '{"rows":[{"stable_fixture_candidate":"task17_oldfixture01","stable_fixture_recoverable":true,"stable_fixture_safe":true}]}',
      FAKE_SECRET_SET_FAILURE: '1',
    })

    // Stop at the fake secret boundary: this contract exercises admission, not browser setup.
    expect(result.exitCode).not.toBe(0)
    expect(result.log).toContain('fixture-prefix task17_oldfixture01')
    expect(result.log).not.toContain('fixture-prefix task17_checkout0001')
    expect(result.log).not.toContain('functions deploy task17-transaction-driver')
  })

  it('preserves canonical Task 13 seed selection when no stable fixture exists', async () => {
    const result = await runRunner(false)

    expect(result.exitCode).toBe(0)
    expect(result.log).toContain('fixture-prefix task17_checkout0001')
    expect(result.log).toContain('vitest run')
  })

  it('adopts the one exact protected legacy fixture instead of creating a second shell', async () => {
    const result = await runRunner(false, false, {
      FAKE_STABLE_FIXTURE_RESPONSE: '{"rows":[{"stable_fixture_candidate":"task17_oldfixture01","stable_fixture_recoverable":true,"stable_fixture_safe":true,"stable_fixture_needs_moderation":false}]}',
    })

    expect(result.exitCode).toBe(0)
    expect(result.log).toContain('stable_fixture_candidate')
    expect(result.log).toContain('fixture-prefix task17_oldfixture01')
    expect(result.log).not.toContain('fixture-prefix task17_checkout0001')
  })

  it('adopts one exact unsellable legacy shell for authenticated owner recovery', async () => {
    const result = await runRunner(false, false, {
      FAKE_STABLE_FIXTURE_RESPONSE: '{"rows":[{"stable_fixture_candidate":"task17_oldfixture01","stable_fixture_recoverable":true,"stable_fixture_safe":false,"stable_fixture_needs_moderation":false}]}',
    })

    expect(result.exitCode).toBe(0)
    expect(result.log).toContain('fixture-prefix task17_oldfixture01')
    expect(result.log).not.toContain('fixture-prefix task17_checkout0001')
  })

  it('uses only the exact service fixture moderation boundary', async () => {
    const result = await runRunner(false, false, {
      FAKE_STABLE_FIXTURE_RESPONSE: '{"rows":[{"stable_fixture_candidate":"task17_oldfixture01","stable_fixture_recoverable":true,"stable_fixture_safe":false,"stable_fixture_needs_moderation":true}]}',
    })
    const driver = await readFile(
      new URL('./edge/task17-transaction-driver/index.ts', import.meta.url),
      'utf8',
    )

    expect(result.exitCode).toBe(0)
    expect(driver).toContain('server_claim_checkout_integrity_fixture_evaluation')
    expect(driver).not.toContain('.rpc("list_moderation_queue"')
    expect(driver).not.toContain('.rpc("get_moderation_case"')
    expect(driver).not.toContain('.rpc("moderate_event"')
    expect(result.log).not.toContain('insert into private.staff_roles')
    expect(result.log).not.toContain('delete from private.staff_roles')
  })

  it('fails closed when the Task 17 namespace contains one unsafe partial shell', async () => {
    const result = await runRunner(false, false, {
      FAKE_STABLE_FIXTURE_RESPONSE: '{"rows":[{"stable_fixture_candidate":"task17_partial00001","stable_fixture_recoverable":false,"stable_fixture_safe":false,"stable_fixture_needs_moderation":false}]}',
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.log).toContain('stable_fixture_candidate')
    expect(result.log).not.toContain('curl-action account_diagnostic')
    expect(result.log).not.toContain('set checkout_creation_enabled = true')
    expect(result.log).not.toContain('vitest run')
  })

  it('fails closed when one safe shell and one unsafe shell coexist', async () => {
    const result = await runRunner(false, false, {
      FAKE_STABLE_FIXTURE_RESPONSE: '{"rows":[{"stable_fixture_candidate":"task17_oldfixture01","stable_fixture_recoverable":true,"stable_fixture_safe":true,"stable_fixture_needs_moderation":false},{"stable_fixture_candidate":"task17_partial00001","stable_fixture_recoverable":false,"stable_fixture_safe":false,"stable_fixture_needs_moderation":false}]}',
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.log).not.toContain('curl-action account_diagnostic')
    expect(result.log).not.toContain('set checkout_creation_enabled = true')
    expect(result.log).not.toContain('vitest run')
  })

  it('preserves the account after exact absent cleanup when setup never created a shell', async () => {
    const result = await runRunner(false, false, {
      FAKE_FIXTURE_PREFLIGHT_RESPONSE: '{"ok":false,"kind":"FIXTURE_AUTH_FAILED"}',
      FAKE_CLEANUP_RESPONSE: '{"ok":true,"event_count":0,"organizer_count":0,"connect_count":0,"order_count":0,"tier_count":0,"receipt_count":0,"ticket_count":0,"dispute_count":0,"refund_count":0,"item_count":0,"auth_user_absent":true,"connected_account_closed":false,"connected_account_preserved":true}',
      FAKE_TOMBSTONE_AUDIT_RESPONSE: '{"rows":[{"namespace_prefix_count":0,"event_count":0,"organizer_count":0,"auth_user_absent":true,"auth_user_inert":false,"audit_interval_count":0,"audit_action_count":0,"open_eligible_interval_count":0,"active_tier_count":0,"tier_count":0,"connect_count":0,"order_count":0,"item_count":0,"ticket_count":0,"refund_count":0,"staff_role_count":0,"public_projection_count":0,"event_tombstoned":false}]}',
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.log).not.toContain('curl-action retire_connected_account')
  })

  it('proves the stable fixture sellable before enabling checkout or starting Stripe proof', async () => {
    const result = await runRunner(false)

    expect(result.exitCode).toBe(0)
    expect(result.log).toContain('curl-action fixture_preflight')
    expect(result.log.indexOf('curl-action account_diagnostic')).toBeLessThan(
      result.log.indexOf('curl-action fixture_preflight'),
    )
    expect(result.log.indexOf('curl-action fixture_preflight')).toBeLessThan(
      result.log.indexOf('set checkout_creation_enabled = true'),
    )
    expect(result.log.indexOf('curl-action fixture_preflight')).toBeLessThan(
      result.log.indexOf('vitest run'),
    )
    expect(result.log).toContain('fixture-prefix task17_checkout0001')
  })

  it('fails closed before checkout enablement when the fixture is not sellable', async () => {
    const result = await runRunner(false, false, {
      FAKE_FIXTURE_PREFLIGHT_RESPONSE: '{"ok":false,"kind":"FIXTURE_ELIGIBILITY_FAILED"}',
      FAKE_CLEANUP_RESPONSE: '{"ok":true,"stable_fixture":true,"fixture_reusable":true,"event_count":1,"organizer_count":1,"auth_user_inert":true,"event_sellable":false,"public_projection_count":0,"active_tier_count":0,"connect_count":0,"order_count":0,"item_count":0,"ticket_count":0,"receipt_count":0,"refund_count":0,"dispute_count":0,"connected_account_closed":false,"connected_account_preserved":true}',
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.log).toContain('curl-action fixture_preflight')
    expect(result.log).not.toContain('set checkout_creation_enabled = true')
    expect(result.log).not.toContain('vitest run')
    expect(result.log).toContain('cleanup-close-request false')
    expect(result.log).not.toContain('cleanup-close-request true')
    expect(result.log).not.toContain('curl-action retire_connected_account')
  })

  it('preserves the account on scoped fixture moderation failure', async () => {
    const result = await runRunner(false, false, {
      FAKE_STABLE_FIXTURE_RESPONSE: '{"rows":[{"stable_fixture_candidate":"task17_oldfixture01","stable_fixture_recoverable":true,"stable_fixture_safe":false,"stable_fixture_needs_moderation":true}]}',
      FAKE_FIXTURE_PREFLIGHT_RESPONSE: '{"ok":false,"kind":"FIXTURE_MODERATION_FAILED"}',
      FAKE_CLEANUP_RESPONSE: '{"ok":true,"stable_fixture":true,"fixture_reusable":true,"event_count":1,"organizer_count":1,"auth_user_inert":true,"event_sellable":false,"public_projection_count":0,"active_tier_count":0,"connect_count":0,"order_count":0,"item_count":0,"ticket_count":0,"receipt_count":0,"refund_count":0,"dispute_count":0,"connected_account_closed":false,"connected_account_preserved":true}',
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.log).not.toContain('insert into private.staff_roles')
    expect(result.log).not.toContain('delete from private.staff_roles')
    expect(result.log).not.toContain('set checkout_creation_enabled = true')
    expect(result.log).not.toContain('retirement-authorization true')
    expect(result.log).not.toContain('curl-action retire_connected_account')
  })

  it.each([
    'FIXTURE_PREPARATION_FAILED',
    'FIXTURE_ORGANIZER_FAILED',
    'FIXTURE_ACCOUNT_BINDING_FAILED',
    'FIXTURE_EVENT_FAILED',
    'FIXTURE_TIER_SETUP_FAILED',
    'FIXTURE_MODERATION_FAILED',
    'FIXTURE_AUTH_FAILED',
    'FIXTURE_DISCLOSURE_SAVE_FAILED',
    'FIXTURE_POLICY_ACCEPTANCE_FAILED',
    'FIXTURE_PUBLISH_FAILED',
    'FIXTURE_ELIGIBILITY_FAILED',
    'FIXTURE_CHECKOUT_PREFLIGHT_FAILED',
  ])('reports the sanitized fixture stage %s and preserves the account', async (kind) => {
    const result = await runRunner(false, false, {
      FAKE_FIXTURE_PREFLIGHT_RESPONSE: JSON.stringify({ ok: false, kind }),
      FAKE_TOMBSTONE_AUDIT_RESPONSE: '{"rows":[{"namespace_prefix_count":1,"event_count":1,"organizer_count":1,"auth_user_inert":true,"audit_interval_count":1,"audit_action_count":0,"open_eligible_interval_count":0,"active_tier_count":0,"tier_count":0,"connect_count":0,"order_count":0,"item_count":0,"ticket_count":0,"refund_count":0,"staff_role_count":0,"public_projection_count":0,"event_tombstoned":true}]}',
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain(`Task 17 fixture preflight: ${kind}`)
    expect(result.stderr).not.toContain('NOT_SELLABLE_OR_UNSAFE')
    expect(result.log).toContain('cleanup-close-request false')
    expect(result.log).not.toContain('retirement-authorization true')
    expect(result.log).not.toContain('curl-action retire_connected_account')
  })

  it('accepts an inert organizer-edit hold after failed legacy recovery without certifying retirement', async () => {
    const result = await runRunner(false, false, {
      FAKE_FIXTURE_PREFLIGHT_RESPONSE: '{"ok":false,"kind":"FIXTURE_PUBLISH_FAILED"}',
      FAKE_TOMBSTONE_AUDIT_RESPONSE: '{"rows":[{"namespace_prefix_count":1,"event_count":1,"organizer_count":1,"auth_user_inert":true,"audit_interval_count":1,"audit_action_count":1,"open_eligible_interval_count":0,"active_tier_count":0,"tier_count":0,"connect_count":0,"order_count":0,"item_count":0,"ticket_count":0,"refund_count":0,"staff_role_count":0,"public_projection_count":0,"event_inert":true,"event_tombstoned":false}]}',
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('Task 17 fixture preflight: FIXTURE_PUBLISH_FAILED')
    expect(result.stderr).not.toContain('Task 17 teardown verification: fail')
    expect(result.log).not.toContain('retirement-authorization true')
    expect(result.log).not.toContain('curl-action retire_connected_account')
  })

  it('accepts only the inert reusable audit tombstone cleanup contract', async () => {
    const result = await runRunner(false)

    expect(result.exitCode).toBe(0)
    expect(result.log).toContain('event_public_eligibility_intervals')
    expect(result.log).toContain('event_moderation_actions')
    expect(result.log.indexOf('event_public_eligibility_intervals')).toBeLessThan(
      result.log.indexOf('supabase functions delete task17-transaction-driver'),
    )
  })

  it('fails teardown when the linked audit tombstone verification is unsafe', async () => {
    const result = await runRunner(false, false, {
      FAKE_TOMBSTONE_AUDIT_RESPONSE: '{"rows":[{"namespace_prefix_count":1,"event_count":1,"organizer_count":1,"auth_user_inert":true,"audit_interval_count":3,"audit_action_count":3,"open_eligible_interval_count":1,"active_tier_count":0,"tier_count":0,"connect_count":0,"order_count":0,"item_count":0,"ticket_count":0,"refund_count":0,"staff_role_count":0,"public_projection_count":0,"event_tombstoned":true}]}',
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.log).not.toContain('curl-action retire_connected_account')
    expect(result.log).not.toContain('retirement-authorization true')
  })

  it('fails teardown when another Task 17 namespace shell remains', async () => {
    const result = await runRunner(false, false, {
      FAKE_TOMBSTONE_AUDIT_RESPONSE: '{"rows":[{"namespace_prefix_count":2,"event_count":1,"organizer_count":1,"auth_user_inert":true,"audit_interval_count":3,"audit_action_count":3,"open_eligible_interval_count":0,"active_tier_count":0,"tier_count":0,"connect_count":0,"order_count":0,"item_count":0,"ticket_count":0,"refund_count":0,"staff_role_count":0,"public_projection_count":0,"event_tombstoned":true}]}',
    })

    expect(result.exitCode).not.toBe(0)
  })

  it('diagnoses before ownership and preserves the account when the contract mismatches', async () => {
    const result = await runRunner(false, false, {
      FAKE_DIAGNOSTIC_RESPONSE: '{"ok":false,"kind":"ACCOUNT_CONTRACT_MISMATCH","account_contract":{"dashboard_is_express":false,"recipient_configuration_only":false,"default_currency_is_usd":true,"fees_collector_is_application":true,"losses_collector_is_application":true,"requirements_collector_is_stripe":true}}',
      FAKE_CLEANUP_RESPONSE: '{"ok":true,"event_count":0,"organizer_count":0,"connect_count":0,"order_count":0,"tier_count":0,"receipt_count":0,"ticket_count":0,"dispute_count":0,"refund_count":0,"item_count":0,"auth_user_absent":true,"connected_account_closed":false,"connected_account_preserved":true}',
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.log).toContain('curl-action account_diagnostic')
    expect(result.log).toContain('cleanup-close-request false')
    expect(result.log).not.toContain('set checkout_creation_enabled = true')
    expect(result.log).not.toContain('vitest run')
    expect(result.log).toContain('supabase functions delete task17-transaction-driver')
    expect(result.log).toContain(
      'supabase secrets unset TASK17_PROOF_TOKEN TASK17_FIXTURE_PREFIX TASK17_CONNECTED_ACCOUNT_ID TASK17_CLOSE_CONNECTED_ACCOUNT',
    )
  })

  it('preserves the account when the diagnostic cannot retrieve it', async () => {
    const result = await runRunner(false, false, {
      FAKE_DIAGNOSTIC_RESPONSE: '{"ok":false,"kind":"ACCOUNT_RETRIEVE_FAILED"}',
      FAKE_CLEANUP_RESPONSE: '{"ok":true,"event_count":0,"organizer_count":0,"connect_count":0,"order_count":0,"tier_count":0,"receipt_count":0,"ticket_count":0,"dispute_count":0,"refund_count":0,"item_count":0,"auth_user_absent":true,"connected_account_closed":false,"connected_account_preserved":true}',
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.log).toContain('curl-action account_diagnostic')
    expect(result.log).toContain('cleanup-close-request false')
    expect(result.log).not.toContain('set checkout_creation_enabled = true')
    expect(result.log).not.toContain('vitest run')
  })

  it('retires the connected account only after proof, cleanup, and tombstone certification', async () => {
    const result = await runRunner(false)

    expect(result.exitCode).toBe(0)
    expect(result.log).toContain('curl-action account_diagnostic')
    expect(result.log.indexOf('curl-action account_diagnostic')).toBeLessThan(
      result.log.indexOf('set checkout_creation_enabled = true'),
    )
    expect(result.log.indexOf('curl-action account_diagnostic')).toBeLessThan(
      result.log.indexOf('vitest run'),
    )
    expect(result.log.match(/cleanup-close-request false/g)).toHaveLength(1)
    expect(result.log).not.toContain('cleanup-close-request true')
    expect(result.log.match(/curl-action retire_connected_account/g)).toHaveLength(1)
    expect(result.log.indexOf('vitest run')).toBeLessThan(
      result.log.indexOf('cleanup-close-request false'),
    )
    expect(result.log.indexOf('cleanup-close-request false')).toBeLessThan(
      result.log.lastIndexOf('event_public_eligibility_intervals'),
    )
    expect(result.log.lastIndexOf('event_public_eligibility_intervals')).toBeLessThan(
      result.log.indexOf('retirement-authorization true'),
    )
    expect(result.log.indexOf('retirement-authorization true')).toBeLessThan(
      result.log.indexOf('curl-action retire_connected_account'),
    )
    expect(result.log.indexOf('curl-action retire_connected_account')).toBeLessThan(
      result.log.indexOf('supabase functions delete task17-transaction-driver'),
    )
  })

  it('can run fixture preflight and cleanup without enabling checkout or retiring the account', async () => {
    const result = await runRunner(false, false, {
      TASK13_FIXTURE_PREFLIGHT_ONLY: '1',
      FAKE_TOMBSTONE_AUDIT_RESPONSE: '{"rows":[{"namespace_prefix_count":1,"event_count":1,"organizer_count":1,"auth_user_inert":true,"audit_interval_count":1,"audit_action_count":0,"open_eligible_interval_count":0,"active_tier_count":0,"tier_count":0,"connect_count":0,"order_count":0,"item_count":0,"ticket_count":0,"refund_count":0,"staff_role_count":0,"public_projection_count":0,"event_tombstoned":true}]}',
    })

    expect(result.exitCode).toBe(0)
    expect(result.log).toContain('curl-action fixture_preflight')
    expect(result.log).toContain('cleanup-close-request false')
    expect(result.log).not.toContain('set checkout_creation_enabled = true')
    expect(result.log).not.toContain('vitest run')
    expect(result.log).not.toContain('curl-action retire_connected_account')
  })

  it('diagnoses the prior Checkout response without enabling checkout or retiring the account', async () => {
    const result = await runRunner(false, false, {
      TASK13_CHECKOUT_DIAGNOSTIC_ONLY: '1',
      FAKE_TOMBSTONE_AUDIT_RESPONSE: '{"rows":[{"namespace_prefix_count":1,"event_count":1,"organizer_count":1,"auth_user_inert":true,"audit_interval_count":3,"audit_action_count":3,"open_eligible_interval_count":0,"active_tier_count":0,"tier_count":0,"connect_count":0,"order_count":0,"item_count":0,"ticket_count":0,"refund_count":0,"staff_role_count":0,"public_projection_count":0,"event_tombstoned":true}]}',
    })

    expect(result.exitCode).toBe(0)
    expect(result.log).toContain('curl-action account_diagnostic')
    expect(result.log).toContain('curl-action checkout_diagnostic')
    expect(result.log.indexOf('curl-action account_diagnostic')).toBeLessThan(
      result.log.indexOf('curl-action checkout_diagnostic'),
    )
    expect(result.log).not.toContain('curl-action fixture_preflight')
    expect(result.log).not.toContain('set checkout_creation_enabled = true')
    expect(result.log).not.toContain('vitest run')
    expect(result.log).toContain('cleanup-close-request false')
    expect(result.log).not.toContain('curl-action retire_connected_account')
    expect(result.stdout).toContain(
      'Task 13 checkout diagnostic: payment_intent_present=false',
    )
    expect(result.stdout).not.toContain('cs_test_')
    expect(result.stdout).not.toContain('acct_')
    expect(result.stdout).not.toContain('@example.invalid')
  })

  it('runs one guaranteed-decline browser diagnostic after complete preflight and never retires', async () => {
    const result = await runRunner(false, false, {
      TASK13_BROWSER_DIAGNOSTIC_ONLY: '1',
    })

    expect(result.exitCode).toBe(0)
    expect(result.log).toContain('curl-action account_diagnostic')
    expect(result.log).toContain('curl-action fixture_preflight')
    expect(result.log.indexOf('curl-action account_diagnostic')).toBeLessThan(
      result.log.indexOf('curl-action fixture_preflight'),
    )
    expect(result.log.indexOf('curl-action fixture_preflight')).toBeLessThan(
      result.log.indexOf('set checkout_creation_enabled = true'),
    )
    expect(result.log).toContain(
      'vitest run --config vitest.integration.config.ts tests/integration/stripe-ticketing.test.ts -t runs one guaranteed-decline hosted browser diagnostic',
    )
    expect(result.log.match(/vitest run/g)).toHaveLength(1)
    expect(result.log).toContain('set checkout_creation_enabled = false')
    expect(result.log).toContain('cleanup-close-request false')
    expect(result.log).toContain('task17_cleanup_receipts')
    expect(result.log).toContain('event_public_eligibility_intervals')
    expect(result.log).not.toContain('retirement-authorization true')
    expect(result.log).not.toContain('curl-action retire_connected_account')
  })

  it('cleans the diagnostic fixture and preserves the account when browser automation fails', async () => {
    const result = await runRunner(true, false, {
      TASK13_BROWSER_DIAGNOSTIC_ONLY: '1',
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.log).toContain('curl-action account_diagnostic')
    expect(result.log).toContain('curl-action fixture_preflight')
    expect(result.log).toContain(
      'vitest run --config vitest.integration.config.ts tests/integration/stripe-ticketing.test.ts -t runs one guaranteed-decline hosted browser diagnostic',
    )
    expect(result.log).toContain('set checkout_creation_enabled = false')
    expect(result.log).toContain('cleanup-close-request false')
    expect(result.log).toContain('task17_cleanup_receipts')
    expect(result.log).toContain('event_public_eligibility_intervals')
    expect(result.log).not.toContain('retirement-authorization true')
    expect(result.log).not.toContain('curl-action retire_connected_account')
  })

  it('requires checkout disabled before opening the guarded browser diagnostic window', async () => {
    const result = await runRunner(false, true, {
      TASK13_BROWSER_DIAGNOSTIC_ONLY: '1',
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.log).toContain('curl-action account_diagnostic')
    expect(result.log).toContain('curl-action fixture_preflight')
    expect(result.log).toContain('select checkout_creation_enabled')
    expect(result.log).not.toContain('set checkout_creation_enabled = true')
    expect(result.log).not.toContain('vitest run')
    expect(result.log).toContain('cleanup-close-request false')
    expect(result.log).not.toContain('retirement-authorization true')
    expect(result.log).not.toContain('curl-action retire_connected_account')
  })

  it('deploys the committed driver and tears down the endpoint and temporary secrets', async () => {
    const result = await runRunner(false)
    expect(result.exitCode).toBe(0)
    expect(result.log).toContain('supabase secrets set --env-file')
    expect(result.log).toContain('supabase projects list --output json')
    expect(result.log).toContain('policy_environment')
    expect(result.log.indexOf('supabase projects list --output json')).toBeLessThan(
      result.log.indexOf('supabase secrets set --env-file'),
    )
    expect(result.log.indexOf('policy_environment')).toBeLessThan(
      result.log.indexOf('supabase secrets set --env-file'),
    )
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
    expect(result.materializedContractsExist).toBe(false)
  })

  it('runs the same teardown when the canonical proof fails', async () => {
    const result = await runRunner(true, false, {
      FAKE_CLEANUP_RESPONSE: '{"ok":true,"stable_fixture":true,"fixture_reusable":true,"event_count":1,"organizer_count":1,"auth_user_inert":true,"event_sellable":false,"public_projection_count":0,"active_tier_count":0,"connect_count":0,"order_count":0,"item_count":0,"ticket_count":0,"receipt_count":0,"refund_count":0,"dispute_count":0,"connected_account_closed":false,"connected_account_preserved":true}',
    })
    expect(result.exitCode).not.toBe(0)
    expect(result.log).toContain('curl ')
    expect(result.log).toContain('cleanup-close-request false')
    expect(result.log).not.toContain('cleanup-close-request true')
    expect(result.log).not.toContain('curl-action retire_connected_account')
    expect(result.log).toContain('set checkout_creation_enabled = false')
    expect(result.log).toContain('supabase functions delete task17-transaction-driver')
    expect(result.log).toContain(
      'supabase secrets unset TASK17_PROOF_TOKEN TASK17_FIXTURE_PREFIX TASK17_CONNECTED_ACCOUNT_ID TASK17_CLOSE_CONNECTED_ACCOUNT',
    )
    expect(result.materializedExists).toBe(false)
    expect(result.materializedContractsExist).toBe(false)
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

  it('fails teardown when the retained fixture Auth identity is not proven inert', async () => {
    const result = await runRunner(false, false, {
      FAKE_CLEANUP_RESPONSE: '{"ok":true,"stable_fixture":true,"fixture_reusable":true,"event_count":1,"organizer_count":1,"auth_user_inert":false,"event_sellable":false,"public_projection_count":0,"active_tier_count":0,"connect_count":0,"order_count":0,"item_count":0,"ticket_count":0,"receipt_count":0,"refund_count":0,"dispute_count":0,"connected_account_closed":false,"connected_account_preserved":true}',
    })
    expect(result.exitCode).not.toBe(0)
  })

  it('refuses to replace or remove a pre-existing local driver materialization', async () => {
    const result = await runRunner(false, false, {}, true)
    expect(result.exitCode).not.toBe(0)
    expect(result.materializedContents).toBe('preexisting source\n')
    expect(result.log).not.toContain('functions deploy task17-transaction-driver')
  })

  it.each([
    ['project-list command failure', {
      FAKE_PROJECT_LIST_FAILURE: '1',
    }],
    ['project-list parse failure', {
      FAKE_PROJECTS_RESPONSE: 'not-json',
    }],
    ['zero linked matches', {
      FAKE_PROJECTS_RESPONSE: '[]',
    }],
    ['multiple linked matches', {
      FAKE_PROJECTS_RESPONSE: '[{"id":"abcdefghijklmnopqrst","linked":true,"status":"ACTIVE_HEALTHY"},{"id":"bbbbbbbbbbbbbbbbbbbb","linked":true,"status":"ACTIVE_HEALTHY"}]',
    }],
    ['linked reference mismatch', {
      FAKE_PROJECTS_RESPONSE: '[{"id":"bbbbbbbbbbbbbbbbbbbb","linked":true,"status":"ACTIVE_HEALTHY"}]',
    }],
    ['linked project is not healthy', {
      FAKE_PROJECTS_RESPONSE: '[{"id":"abcdefghijklmnopqrst","linked":true,"status":"INACTIVE"}]',
    }],
    ['Supabase URL mismatch', {
      TEST_SUPABASE_URL: 'https://bbbbbbbbbbbbbbbbbbbb.supabase.co',
    }],
    ['non-development database', {
      FAKE_POLICY_RESPONSE: '{"rows":[{"policy_environment":"production"}]}',
    }],
    ['environment-query command failure', {
      FAKE_POLICY_QUERY_FAILURE: '1',
    }],
    ['environment-query parse failure', {
      FAKE_POLICY_RESPONSE: 'not-json',
    }],
    ['zero environment rows', {
      FAKE_POLICY_RESPONSE: '{"rows":[]}',
    }],
    ['multiple environment rows', {
      FAKE_POLICY_RESPONSE: '{"rows":[{"policy_environment":"development"},{"policy_environment":"development"}]}',
    }],
  ])('fails closed before mutation on %s', async (_label, overrides) => {
    const result = await runRunner(false, false, overrides)
    expect(result.exitCode).not.toBe(0)
    expect(result.log).not.toContain('supabase secrets set --env-file')
    expect(result.log).not.toContain('functions deploy task17-transaction-driver')
    expect(result.log).not.toContain('set checkout_creation_enabled = true')
    expect(result.log).not.toContain('curl ')
  })
})
