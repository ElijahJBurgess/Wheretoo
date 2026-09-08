import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const runnerPath = new URL('../e2e/run-ticketing-browser-proof.sh', import.meta.url)
const packagePath = new URL('../../package.json', import.meta.url)
const runbookPath = new URL('../../Docs/testing/day2-ticketing-payments-verification.md', import.meta.url)

describe('Task 18 browser proof runner contract', () => {
  it('provides one canonical package command for the guarded browser proof', () => {
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      scripts?: Record<string, string>
    }

    expect(packageJson.scripts?.['test:e2e:ticketing']).toBe(
      'tests/e2e/run-ticketing-browser-proof.sh',
    )
  })

  it('preserves the ready test account while browser cleanup is still being certified', () => {
    const runner = readFileSync(runnerPath, 'utf8')

    expect(runner).toContain('trap cleanup EXIT HUP INT TERM')
    expect(runner).toContain('projects api-keys')
    expect(runner).toContain('/auth/v1/admin/users')
    expect(runner).toContain('functions deploy task17-transaction-driver')
    expect(runner).toContain('pnpm exec playwright test --config playwright.config.ts')
    expect(runner).toContain('tests/e2e/organizer-publish.spec.ts')
    expect(runner).toContain('tests/e2e/organizer-publish.visual.spec.ts')
    expect(runner).toContain('tests/e2e/ticket-purchase.spec.ts')
    expect(runner).toContain('tests/e2e/ticket-purchase.visual.spec.ts')
    expect(runner).not.toContain('pnpm test:e2e')
    expect(runner).toContain('\\"action\\":\\"checkout_status\\"')
    expect(runner).toContain('\\"action\\":\\"expire_checkout\\"')
    expect(runner).toContain('\\"action\\":\\"create_refund\\"')
    expect(runner).toContain('{"action":"cleanup","close_connected_account":false}')
    expect(runner).not.toContain('{"action":"cleanup","close_connected_account":true}')
    expect(runner).toContain('functions delete task17-transaction-driver')
    expect(runner).toContain('secrets unset')
    expect(runner).toContain('residue_count')
    expect(runner).toContain('order_count !== row.orders.length')
    expect(runner).toContain('checkout_parser_exit')
    expect(runner).toContain('TEST_CONNECTED_ACCOUNT_DISPOSABLE')
    expect(runner).toContain('TEST_TASK18_FIXTURE_PREFIX="$driver_prefix"')
    expect(runner).not.toContain('STRIPE_RESTRICTED_KEY=')
    expect(runner.indexOf('delete from public.orders')).toBeLessThan(
      runner.indexOf('delete from public.stripe_webhook_events'),
    )
  })

  it('materializes and tears down the self-contained driver without touching prior files', () => {
    const runner = readFileSync(runnerPath, 'utf8')

    expect(runner).toContain(
      'driver_contracts_source="$repository_root/tests/integration/edge/task17-transaction-driver/contracts.ts"',
    )
    expect(runner).toContain('driver_contracts_file="$driver_directory/contracts.ts"')
    expect(runner).toContain('driver_materialized=0')
    expect(runner).toContain('driver_directory_created=0')
    expect(runner).toContain('[[ -f "$driver_contracts_source" ]]')
    expect(runner).toContain('[[ ! -e "$driver_file" && ! -e "$driver_contracts_file" ]]')
    expect(runner).toContain(
      "sed 's#../../../../supabase/functions/#../#g' \"$driver_source\" >\"$driver_file\"",
    )
    expect(runner).toContain('cp "$driver_contracts_source" "$driver_contracts_file"')
    expect(runner).toContain('chmod 600 "$driver_file" "$driver_contracts_file"')
    expect(runner).toContain('pnpm exec deno check --config deno.json "$driver_file"')
    expect(runner).toContain('if [[ $driver_materialized -eq 1 ]]; then')
    expect(runner).toContain('rm -f "$driver_file" "$driver_contracts_file"')
    expect(runner).toContain('if [[ $driver_directory_created -eq 1 ]]; then')
    expect(runner.indexOf('rm -f "$driver_file" "$driver_contracts_file"')).toBeLessThan(
      runner.indexOf('rmdir "$driver_directory"'),
    )
  })

  it('documents the reviewed eight-case command without a stale incomplete verdict', () => {
    const runbook = readFileSync(runbookPath, 'utf8')

    expect(runbook).toContain('pnpm test:e2e:ticketing')
    expect(runbook).toContain('eight total mobile/desktop cases')
    expect(runbook).not.toContain('requires a fresh disposable recipient run before branch completion')
  })
})
