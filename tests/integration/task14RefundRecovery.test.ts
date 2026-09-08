import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import * as contracts from './edge/task17-transaction-driver/contracts'

const snapshot = { orderId: '11111111-1111-4111-8111-111111111111', paymentIntentId: 'pi_Test', chargeId: 'ch_Test', transferId: 'tr_Test', applicationFeeId: 'fee_Test', connectedAccountId: 'acct_Test', refundId: 're_Test', reversalId: 'trr_Test', feeRefundId: null }
const evidence = () => ({
  refunds: { has_more: false, data: [{ id: 're_Test', object: 'refund', livemode: false, status: 'succeeded', amount: 5500, currency: 'usd', payment_intent: 'pi_Test', charge: 'ch_Test', transfer_reversal: 'trr_Test', metadata: { order_id: snapshot.orderId, whereto_refund_policy: 'destination_v1', whereto_reverse_transfer: 'true', whereto_refund_application_fee: 'true' } }] },
  transfer: { id: 'tr_Test', object: 'transfer', livemode: false, amount: 5500, currency: 'usd', source_transaction: 'ch_Test', destination: 'acct_Test', reversals: { has_more: false, data: [{ id: 'trr_Test', object: 'transfer_reversal', amount: 5500, currency: 'usd', source_refund: 're_Test', transfer: 'tr_Test' }] } },
  fee: { id: 'fee_Test', object: 'application_fee', livemode: false, amount: 425, currency: 'usd', charge: 'ch_Test', account: 'acct_Test' },
  feeRefunds: { has_more: false, data: [{ id: 'fr_Test', object: 'fee_refund', amount: 425, currency: 'usd', fee: 'fee_Test' }] },
})

describe('Task14 existing-refund recovery', () => {
  it('admits exactly the three cancelled review tickets, never valid or already-refunded tickets', () => {
    const runner = readFileSync(new URL('./run-stripe-ticketing-proof.sh', import.meta.url), 'utf8')
    // Execute the actual portable SQL predicates against an in-memory database;
    // do not mock an admission result or contact the linked PostgreSQL instance.
    const predicates = runner.match(/\(select count\(\*\) from public\.tickets where order_id = candidate\.order_id(?: and status = '[a-z]+')?\) = 3/g)
    expect(predicates?.length).toBe(2)
    const actual = JSON.parse(execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', `
      import { DatabaseSync } from 'node:sqlite'
      import { readFileSync } from 'node:fs'
      const predicates = JSON.parse(readFileSync(0, 'utf8'))
      const db = new DatabaseSync(':memory:')
      db.exec("attach ':memory:' as public; create table public.tickets (order_id text, status text)")
      const result = []
      for (const statuses of [
        ['cancelled', 'cancelled', 'cancelled'], ['cancelled', 'cancelled'],
        ['cancelled', 'cancelled', 'valid'], ['refunded', 'refunded', 'refunded'],
        ['invalid', 'invalid', 'invalid'], ['cancelled', 'cancelled', 'cancelled', 'cancelled'],
      ]) {
        db.exec('delete from public.tickets')
        const insert = db.prepare('insert into public.tickets values (?, ?)')
        for (const status of statuses) insert.run('fixture-order', status)
        insert.run('unrelated-order', 'cancelled')
        result.push(db.prepare("select " + predicates.join(' and ') + " as admitted from (select 'fixture-order' as order_id) as candidate").get().admitted)
      }
      db.close()
      process.stdout.write(JSON.stringify(result))
    `], { input: JSON.stringify(predicates), encoding: 'utf8' }))
    expect(actual).toEqual([1, 0, 0, 0, 0, 0])
  })
  it('recovery-only driver permits only existing refund recovery and non-retiring cleanup', () => {
    expect(contracts.recoveryDriverActionAllowed('1', 'recover_refund')).toBe(true)
    expect(contracts.recoveryDriverActionAllowed('1', 'cleanup')).toBe(true)
    for (const action of ['setup', 'checkout_diagnostic', 'fixture_preflight', 'create_refund', 'retire_connected_account', 'deliver']) {
      expect(contracts.recoveryDriverActionAllowed('1', action)).toBe(false)
      expect(contracts.recoveryDriverActionAllowed('0', action)).toBe(true)
    }
  })
  it('requires exact durable refund and ticket state before certifying cleanup', () => {
    const state = {
      orders: [{ status: 'refunded', reconciliation_status: 'reconciled' }],
      refunds: [{ status: 'succeeded', policy_verified: true, policy_failure_code: null, amount_minor: 5500, transfer_reversal_amount_minor: 5500, application_fee_refund_amount_minor: 425, reverse_transfer: true, refund_application_fee: true }],
      tickets: [{ ticket_count: 3, unique_ticket_count: 3, valid_count: 0, refunded_count: 3, bindings_valid: true, sequences_valid: true, refunded_timestamps_valid: true }],
    }
    expect(contracts.recoveredRefundStateIsSafe(state)).toBe(true)
    for (const group of ['orders', 'refunds', 'tickets'] as const) {
      expect(contracts.recoveredRefundStateIsSafe({ ...state, [group]: [] })).toBe(false)
      expect(contracts.recoveredRefundStateIsSafe({ ...state, [group]: [...state[group], ...state[group]] })).toBe(false)
      for (const key of Object.keys(state[group][0])) {
        expect(contracts.recoveredRefundStateIsSafe({ ...state, [group]: [{ ...state[group][0], [key]: 'wrong' }] })).toBe(false)
      }
    }
  })
  it('retries missing evidence then enriches only the same verified refund', async () => {
    let reads = 0
    const writes: unknown[] = []
    const result = await contracts.recoverExistingRefundEvidence(snapshot, {
      read: async () => { const value = evidence(); if (++reads < 3) value.feeRefunds.data = []; return value },
      pause: async () => {},
      update: async (id, metadata) => { writes.push({ id, metadata }) },
    })
    expect(reads).toBe(3)
    expect(writes).toEqual([{ id: 're_Test', metadata: { ...evidence().refunds.data[0].metadata, whereto_transfer_reversal_amount: '5500', whereto_application_fee_refund_id: 'fr_Test', whereto_application_fee_refund_amount: '425' } }])
    expect(result).toEqual({ ok: true, livemode: false, amount: 5500, reversal_amount: 5500, application_fee_refund_amount: 425 })
  })
  it('bounds absence and never writes unverified metadata', async () => {
    let reads = 0
    let writes = 0
    await expect(contracts.recoverExistingRefundEvidence(snapshot, {
      read: async () => { reads++; return { ...evidence(), feeRefunds: { has_more: false, data: [] } } },
      pause: async () => {}, update: async () => { writes++ },
    })).rejects.toThrow('TASK14_REFUND_EVIDENCE_RETRYABLE')
    expect(reads).toBe(5)
    expect(writes).toBe(0)
  })
  it('keeps missing refund retrieval retryable even when the known reversal exists', async () => {
    let reads = 0
    await expect(contracts.recoverExistingRefundEvidence({ ...snapshot, refundId: null }, {
      read: async () => { reads++; return { ...evidence(), refunds: { has_more: false, data: [] } } },
      pause: async () => {}, update: async () => { throw new Error('unverified write') },
    })).rejects.toThrow('TASK14_REFUND_EVIDENCE_RETRYABLE')
    expect(reads).toBe(5)
  })
  it.each(['live', 'refund', 'charge', 'currency', 'reversal', 'fee', 'duplicate', 'truncated', 'metadata'])('fails closed immediately on %s contradiction', async (kind) => {
    const value = evidence()
    if (kind === 'live') value.fee.livemode = true
    if (kind === 'refund') value.refunds.data[0].id = 're_Other'
    if (kind === 'charge') value.fee.charge = 'ch_Other'
    if (kind === 'currency') value.feeRefunds.data[0].currency = 'eur'
    if (kind === 'reversal') value.transfer.reversals.data[0].amount = 5499
    if (kind === 'fee') value.feeRefunds.data[0].amount = 424
    if (kind === 'duplicate') value.refunds.data.push(value.refunds.data[0])
    if (kind === 'truncated') value.feeRefunds.has_more = true
    if (kind === 'metadata') value.refunds.data[0].metadata.order_id = 'other'
    let writes = 0
    await expect(contracts.recoverExistingRefundEvidence(snapshot, { read: async () => value, pause: async () => { throw new Error('unexpected retry') }, update: async () => { writes++ } })).rejects.toThrow('TASK14_REFUND_EVIDENCE_CONFLICT')
    expect(writes).toBe(0)
  })
})
