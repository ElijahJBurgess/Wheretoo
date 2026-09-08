import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { browserRefundRecoveryIsSafe } from '../e2e/support/ticketingFixture'
import { certifyRecoveredRefund } from './edge/task17-transaction-driver/contracts'

const runner = 'tests/e2e/run-core-ticket-truth-lite-proof.sh'
const ordinaryRefund = { ok: true, livemode: false, amount: 5500, reversal_amount: 5500,
  application_fee_refund_amount: 425, order_refunded: true, reconciled: true, refund_count: 1,
  policy_verified: true, ticket_count: 3, invalid_ticket_count: 3, refunded_ticket_count: 3 }

describe('Core Ticket Truth Lite launch proof boundary', () => {
  it('refuses before shared reads or writes unless the owner explicitly authorizes the run', () => {
    expect(existsSync(runner)).toBe(true)
    const result = spawnSync('bash', [runner], {
      encoding: 'utf8', env: { PATH: process.env.PATH, CORE_TICKET_LITE_SHARED_APPROVED: '' },
    })
    expect(result.status).toBe(78)
    expect(result.stderr).toContain('Shared proof requires owner approval')
  })

  it('retains the ordinary three-refunded gate and verifies used history when explicitly expected', () => {
    expect(browserRefundRecoveryIsSafe(ordinaryRefund)).toBe(true)
    expect(browserRefundRecoveryIsSafe({ ...ordinaryRefund, used_ticket_count: 1 })).toBe(false)
    const used = { ...ordinaryRefund, refunded_ticket_count: 2, used_ticket_count: 1, used_history_preserved: true }
    expect(browserRefundRecoveryIsSafe(used)).toBe(false)
    expect(browserRefundRecoveryIsSafe(used, 1)).toBe(true)
    expect(browserRefundRecoveryIsSafe({ ...used, used_history_preserved: false }, 1)).toBe(false)
    expect(browserRefundRecoveryIsSafe({ ...used, refunded_ticket_count: 3 }, 1)).toBe(false)
    expect(browserRefundRecoveryIsSafe({ ...used, used_ticket_count: 2 }, 1)).toBe(false)
  })

  it('requires exact financial reconciliation and preserved used timestamps before driver certification', () => {
    const state = {
      orders: [{ status: 'refunded', reconciliation_status: 'reconciled' }],
      refunds: [{ status: 'succeeded', policy_verified: true, policy_failure_code: null, amount_minor: 5500,
        transfer_reversal_amount_minor: 5500, application_fee_refund_amount_minor: 425, reverse_transfer: true, refund_application_fee: true }],
      tickets: [{ ticket_count: 3, unique_ticket_count: 3, valid_count: 0, refunded_count: 2, used_count: 1,
        used_timestamps_valid: true, bindings_valid: true, sequences_valid: true, refunded_timestamps_valid: true }],
    }
    expect(() => certifyRecoveredRefund(state)).toThrow('STRIPE')
    expect(() => certifyRecoveredRefund(state, undefined, 1, false)).toThrow('STRIPE')
    expect(browserRefundRecoveryIsSafe(certifyRecoveredRefund(state, undefined, 1, true), 1)).toBe(true)
    state.tickets[0].used_timestamps_valid = false
    expect(() => certifyRecoveredRefund(state, undefined, 1, true)).toThrow('STRIPE')
    state.tickets[0].used_timestamps_valid = true
    state.refunds[0].policy_verified = false
    expect(() => certifyRecoveredRefund(state, undefined, 1, true)).toThrow('STRIPE')
  })

  // Explicit release requirement: audit wiring as well as executable refusal above.
  it('composes the guarded provider harness and preserves secret/function ownership', () => {
    expect(existsSync(runner)).toBe(true)
    const wrapper = readFileSync(runner, 'utf8')
    expect(wrapper).toContain('tests/integration/run-stripe-ticketing-proof.sh')
    const guarded = readFileSync('tests/integration/run-stripe-ticketing-proof.sh', 'utf8')
    for (const guard of ['policy_environment', "!== 'development'", 'pk_test_', 'rk_live_*|sk_live_*',
      'capture_checkout_switch', 'restore_checkout_switch', 'trap cleanup EXIT HUP INT TERM',
      'TICKET_CREDENTIAL_SECRET', 'ticket-collection', 'ticket-admission', 'openssl rand -hex 6',
      'temporary_secret_count', 'runtimeEmpty', 'provider_cleanup_verified']) expect(guarded).toContain(guard)
    expect(guarded).not.toMatch(/secrets (?:set|unset)[^\n]*TICKET_CREDENTIAL_SECRET/)
    expect(guarded).not.toMatch(/functions (?:deploy|delete) (?:ticket-collection|ticket-admission)/)
  })
})
