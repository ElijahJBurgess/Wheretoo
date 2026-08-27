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

  it('guards provisioning, real browser execution, reconciliation, and exact cleanup', () => {
    const runner = readFileSync(runnerPath, 'utf8')

    expect(runner).toContain('trap cleanup EXIT HUP INT TERM')
    expect(runner).toContain('projects api-keys')
    expect(runner).toContain('/auth/v1/admin/users')
    expect(runner).toContain('functions deploy task17-transaction-driver')
    expect(runner).toContain('pnpm test:e2e')
    expect(runner).toContain('\\"action\\":\\"create_refund\\"')
    expect(runner).toContain('{"action":"cleanup"}')
    expect(runner).toContain('functions delete task17-transaction-driver')
    expect(runner).toContain('secrets unset')
    expect(runner).toContain('residue_count')
    expect(runner).toContain('TEST_CONNECTED_ACCOUNT_DISPOSABLE')
    expect(runner).not.toContain('STRIPE_RESTRICTED_KEY=')
  })

  it('documents the reviewed eight-case command without a stale incomplete verdict', () => {
    const runbook = readFileSync(runbookPath, 'utf8')

    expect(runbook).toContain('pnpm test:e2e:ticketing')
    expect(runbook).toContain('eight total mobile/desktop cases')
    expect(runbook).not.toContain('requires a fresh disposable recipient run before branch completion')
  })
})
