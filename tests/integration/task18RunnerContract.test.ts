import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const runnerPath = new URL('../e2e/run-ticketing-browser-proof.sh', import.meta.url)
const packagePath = new URL('../../package.json', import.meta.url)
const runbookPath = new URL('../../Docs/testing/day2-ticketing-payments-verification.md', import.meta.url)
const sharedRunnerPath = new URL('./run-stripe-ticketing-proof.sh', import.meta.url)

describe('Task 18 browser proof runner contract', () => {
  it('runs only buyer visuals then payment within one project cleanup boundary', () => {
    const runner = readFileSync(sharedRunnerPath, 'utf8')
    const helper = runner.match(/run_task14_browser_project\(\) \{[\s\S]*?\n\}/)?.[0]
    expect(typeof helper).toBe('string')
    const result = spawnSync('sh', ['-c', `set -eu
${helper}
pnpm() { printf '%s\\n' "$*"; }
TASK14_BROWSER_PROJECT=mobile-chromium
run_task14_browser_project
`], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stdout.trim().split('\n')).toEqual([
      'exec playwright test --config playwright.config.ts tests/e2e/ticket-purchase.visual.spec.ts --project=mobile-chromium --output=test-results/e2e/task14/mobile-chromium/visual',
      'exec playwright test --config playwright.config.ts tests/e2e/ticket-purchase.spec.ts --project=mobile-chromium --output=test-results/e2e/task14/mobile-chromium/purchase',
    ])
  })
  it('provides one canonical package command for the guarded browser proof', () => {
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      scripts?: Record<string, string>
    }

    expect(packageJson.scripts?.['test:e2e:ticketing']).toBe(
      'tests/e2e/run-ticketing-browser-proof.sh',
    )
  })

  it('refuses missing public map configuration and stale linked migrations before fixture setup', () => {
    const shared = readFileSync(sharedRunnerPath, 'utf8')
    const helper = shared.match(/verify_task14_browser_prerequisites\(\) \{[\s\S]*?\n\}/)?.[0]
    expect(typeof helper).toBe('string')
    const directory = mkdtempSync(join(tmpdir(), 'task14-preflight-contract-'))
    try {
      for (const [mapbox, remote, expected] of [['pk.local', '123', 0], ['', '123', 1], ['pk.local', '122', 1]] as const) {
        const result = spawnSync('sh', ['-c', `set -e
${helper}
read_public_env() { printf '%s' "$MAPBOX"; }
pnpm() { printf '%s' '{"migrations":[{"local":"123","remote":"${remote}"}]}'; }
TEMP_DIR="$CONTRACT_DIR"
verify_task14_browser_prerequisites
`], { encoding: 'utf8', env: { ...process.env, CONTRACT_DIR: directory, MAPBOX: mapbox } })
        expect(result.status).toBe(expected)
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.each([0, 23])('keeps the account and original browser status %s after exact cleanup', (status) => {
    const result = runCleanup(status, false)
    expect(result.status).toBe(status)
    expect(result.stdout).toContain('settle')
    expect(result.stdout).toContain('delete-runtime')
    expect(result.stdout).toContain('Task 17 teardown verification: pass')
    expect(result.stdout).not.toContain('RETIRE')
  })

  it('does not delete financial evidence when failed-browser settlement is unverified', () => {
    const result = runCleanup(23, true)
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('settle')
    expect(result.stdout).not.toContain('delete-runtime')
    expect(result.stdout).not.toContain('RETIRE')
    expect(result.stderr).toContain('Task 17 teardown verification: fail')
  })

  it('delegates both viewports to the guarded lifecycle and stops on its failure', () => {
    const wrapper = readFileSync(runnerPath, 'utf8')
    const body = wrapper.slice(wrapper.indexOf('for browser_project'))
    for (const failing of [false, true]) {
      const result = spawnSync('bash', ['-c', `set -e
function tests/integration/run-stripe-ticketing-proof.sh() {
  printf '%s\\n' "$TASK14_BROWSER_PROJECT"
  return ${failing ? 7 : 0}
}
${body}`], { encoding: 'utf8' })
      expect(result.status).toBe(failing ? 7 : 0)
      expect(result.stdout).toContain('mobile-chromium')
      if (failing) expect(result.stdout).not.toContain('desktop-chromium')
      else expect(result.stdout).toContain('desktop-chromium')
    }
  })

  it('documents the buyer guard separately from historical eight-case evidence', () => {
    const runbook = readFileSync(runbookPath, 'utf8')

    expect(runbook).toContain('pnpm test:e2e:ticketing')
    expect(runbook).toContain('four buyer-only cases')
    expect(runbook).toContain('eight total mobile/desktop cases')
    expect(runbook).not.toContain('requires a fresh disposable recipient run before branch completion')
  })
})

function runCleanup(originalStatus: number, settlementFails: boolean) {
  const shared = readFileSync(sharedRunnerPath, 'utf8')
  const cleanup = shared.slice(shared.indexOf('\ncleanup() {'), shared.indexOf('\ntrap cleanup EXIT HUP INT TERM'))
  const directory = mkdtempSync(join(tmpdir(), 'task14-cleanup-contract-'))
  writeFileSync(join(directory, 'fixture'), '{}')
  const cleaned = {
    ok: true, connected_account_closed: false, connected_account_preserved: true,
    database_cleanup_required: true, stable_fixture: true, fixture_reusable: true,
    event_count: 1, organizer_count: 1, auth_user_inert: true, event_sellable: false,
    public_projection_count: 0, active_tier_count: 2, tier_count: 2, connect_count: 1,
    order_count: 1, item_count: 2, ticket_count: 3, receipt_count: 3, refund_count: 1, dispute_count: 0,
  }
  const audit = { rows: [{
    namespace_prefix_count: 1, event_count: 1, organizer_count: 1,
    auth_user_inert: true, audit_interval_count: 3, audit_action_count: 3,
    open_eligible_interval_count: 0, active_tier_count: 0, tier_count: 0,
    connect_count: 0, order_count: 0, item_count: 0, ticket_count: 0,
    refund_count: 0, staff_role_count: 0, public_projection_count: 0, event_tombstoned: true,
  }] }
  try {
    return spawnSync('sh', ['-c', `
restore_checkout_switch() { return 0; }
task14_fixture_action() { echo settle; return ${settlementFails ? 1 : 0}; }
write_cleanup_config() { return 0; }
delete_fixture_runtime() { echo delete-runtime; }
authorize_account_retirement() { echo RETIRE; return 1; }
remote_function_count() { echo 0; }
temporary_secret_count() { echo 0; }
curl() { printf '%s' '${JSON.stringify(cleaned)}'; }
pnpm() {
  case "$*" in
    *'db query'*) printf '%s' '${JSON.stringify(audit)}' ;;
    *) printf '[]' ;;
  esac
}
TEMP_DIR="$CONTRACT_DIR"
TASK14_FIXTURE_FILE="$TEMP_DIR/fixture"
CURL_CONFIG="$TEMP_DIR/fixture"
CLEANUP_RESPONSE="$TEMP_DIR/cleaned"
TOMBSTONE_CERTIFICATION_FILE="$TEMP_DIR/certification"
TASK14_BROWSER_PROJECT=mobile-chromium
TASK14_SETTLEMENT_FAILED=0
TASK13_CLEANUP_ONLY=0
TEARDOWN_FAILURE=0
DRIVER_DEPLOYED=1
DRIVER_DELETE_REQUIRED=1
TEMP_SECRETS_SET=1
MATERIALIZED_CREATED=0
MATERIALIZED_DIR_CREATED=0
ACCOUNT_OWNERSHIP_ACCEPTED=1
PROOF_COMPLETED=${originalStatus === 0 ? 1 : 0}
TEST_STRIPE_FIXTURE_PREFIX=task17_checkout0001
PROJECT_REF=fixture
${cleanup}
(exit ${originalStatus})
cleanup
`], { encoding: 'utf8', env: { ...process.env, CONTRACT_DIR: directory } })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
