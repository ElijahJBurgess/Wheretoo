import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { transpile } from 'typescript'
import * as contracts from './edge/task17-transaction-driver/contracts'

const snapshot = { orderId: '11111111-1111-4111-8111-111111111111', paymentIntentId: 'pi_Test', chargeId: 'ch_Test', transferId: 'tr_Test', applicationFeeId: 'fee_Test', connectedAccountId: 'acct_Test', refundId: 're_Test', reversalId: 'trr_Test', feeRefundId: null }
const evidence = () => ({
  refunds: { has_more: false, data: [{ id: 're_Test', object: 'refund', livemode: false, status: 'succeeded', amount: 5500, currency: 'usd', payment_intent: 'pi_Test', charge: 'ch_Test', transfer_reversal: 'trr_Test', metadata: { order_id: snapshot.orderId, whereto_refund_policy: 'destination_v1', whereto_reverse_transfer: 'true', whereto_refund_application_fee: 'true' } }] },
  transfer: { id: 'tr_Test', object: 'transfer', livemode: false, amount: 5500, amount_reversed: 5500, currency: 'usd', source_transaction: 'ch_Test', destination: 'acct_Test', reversals: { has_more: false, data: [{ id: 'trr_Test', object: 'transfer_reversal', amount: 5500, currency: 'usd', source_refund: 're_Test', transfer: 'tr_Test' }] } },
  fee: { id: 'fee_Test', object: 'application_fee', livemode: false, amount: 425, amount_refunded: 425, currency: 'usd', charge: 'ch_Test', account: 'acct_Test' },
  feeRefunds: { has_more: false, data: [{ id: 'fr_Test', object: 'fee_refund', amount: 425, currency: 'usd', fee: 'fee_Test' }] },
})
const recoveredState = () => ({
  orders: [{ status: 'refunded', reconciliation_status: 'reconciled' }],
  refunds: [{ status: 'succeeded', policy_verified: true, policy_failure_code: null, amount_minor: 5500, transfer_reversal_amount_minor: 5500, application_fee_refund_amount_minor: 425, reverse_transfer: true, refund_application_fee: true }],
  tickets: [{ ticket_count: 3, unique_ticket_count: 3, valid_count: 0, refunded_count: 3, bindings_valid: true, sequences_valid: true, refunded_timestamps_valid: true }],
})
const recoveredProjection = { ok: true, livemode: false, amount: 5500, reversal_amount: 5500, application_fee_refund_amount: 425, order_refunded: true, reconciled: true, refund_count: 1, policy_verified: true, ticket_count: 3, invalid_ticket_count: 3, refunded_ticket_count: 3 }

describe('Task14 existing-refund recovery', () => {
  it.each([null, 'REFUND_STATE_IGNORED'])('certifies a processed receipt (%s) only with exact recovered state', (error_code) => {
    expect(contracts.certifyRecoveredRefund(recoveredState(), { processing_status: 'processed', error_code })).toEqual(recoveredProjection)
    const state = recoveredState()
    state.tickets[0].refunded_count = 2
    expect(() => contracts.certifyRecoveredRefund(state, { processing_status: 'processed', error_code })).toThrow('STRIPE')
    expect(() => contracts.certifyRecoveredRefund(recoveredState(), { processing_status: 'processing', error_code })).toThrow('STRIPE')
  })
  it.each(['REFUND_POLICY_MISMATCH', undefined, 'arbitrary'])('does not certify a different receipt outcome (%s)', (error_code) => {
    expect(() => contracts.certifyRecoveredRefund(recoveredState(), { processing_status: 'processed', error_code })).toThrow('STRIPE')
  })
  it.each(['exact', 'bad_policy', 'cancelled', 'missing_fee_id', 'wrong_binding', 'live', 'missing_refunded_timestamp', 'missing_paid_timestamp', 'missing_order_payment', 'missing_order_transfer'])('runs the actual recovered driver path without a provider boundary (%s)', async (variant) => {
    const state = recoveredState()
    if (variant === 'bad_policy') state.refunds[0].policy_verified = false
    if (variant === 'cancelled') state.tickets[0].refunded_count = 0
    const scope = { event_id: 'fixture', organizer_id: 'owner', livemode: variant !== 'live' ? false : true, currency: 'usd', quantity: 3, stripe_destination_account_id: 'acct_Test', paid_at: variant === 'missing_paid_timestamp' ? undefined : 'fixture-time', refunded_at: variant === 'missing_refunded_timestamp' ? null : 'fixture-time', failure_code: null }
    const refund = { stripe_refund_id: 're_Test', stripe_transfer_reversal_id: 'trr_Test', stripe_application_fee_refund_id: variant === 'missing_fee_id' ? null : 'fr_Test', stripe_payment_intent_id: variant === 'wrong_binding' ? 'pi_Other' : 'pi_Test', stripe_charge_id: 'ch_Test', currency: 'usd' }
    const order = { id: 'order', status: 'refunded', total_minor: 5500, application_fee_amount_minor: 425, stripe_payment_intent_id: 'pi_Test', stripe_charge_id: 'ch_Test', stripe_transfer_id: 'tr_Test', stripe_application_fee_id: 'fee_Test' }
    if (variant === 'missing_order_payment') { order.stripe_payment_intent_id = ''; refund.stripe_payment_intent_id = '' }
    if (variant === 'missing_order_transfer') order.stripe_transfer_id = ''
    const client = { from: (table: string) => {
      const result = { error: null, data: table === 'orders' ? scope : table === 'events' ? { id: 'fixture', organizer_id: 'owner' } : [refund] }
      const query = { select: () => query, eq: () => query, single: async () => result, then: (resolve: (value: unknown) => unknown) => resolve(result) }
      return query
    } }
    let providerCalls = 0
    const dependencies = { getServiceClient: () => client, runRefundRecoveryStage: contracts.runRefundRecoveryStage,
      proofOrder: async () => order,
      connectedAccountId: () => 'acct_Test', fixturePrefix: () => 'fixture', inspect: async () => state,
      certifyRecoveredRefund: contracts.certifyRecoveredRefund,
      getStripe: () => { providerCalls++; throw new Error('forbidden provider boundary') },
    }
    // Execute the real function; only its external DB/provider boundaries are replaced.
    const source = readFileSync(new URL('./edge/task17-transaction-driver/index.ts', import.meta.url), 'utf8')
    const body = source.slice(source.indexOf('async function recoverRefund('), source.indexOf('\nasync function cleanup(', source.indexOf('async function recoverRefund(')))
    const run = new Function(...Object.keys(dependencies), `${transpile(body)}; return recoverRefund`)(...Object.values(dependencies)) as (handle: string) => Promise<unknown>
    if (variant === 'exact') await expect(run('paid')).resolves.toEqual(recoveredProjection)
    else await expect(run('paid')).rejects.toThrow()
    expect(providerCalls).toBe(0)
  })
  it('reports both reversal relations while a separate fee contradiction blocks enrichment', async () => {
    const value = evidence()
    Object.assign(value.refunds.data[0], { transfer_reversal: null, source_transfer_reversal: 'trr_Test' })
    value.feeRefunds.data[0].amount = 424
    let caught: unknown
    let writes = 0
    try {
      await contracts.runRefundRecoveryStage('evidence_validation', () => contracts.recoverExistingRefundEvidence(snapshot, {
        read: async () => value, pause: async () => {}, update: async () => { writes++ },
      }))
    } catch (error) { caught = error }
    const diagnostic = contracts.refundRecoveryDiagnostic(caught) as unknown as { evidence?: Record<string, boolean> }
    expect(diagnostic?.evidence?.refund_transfer_reversal_matches).toBe(false)
    expect(diagnostic?.evidence?.refund_source_transfer_reversal_matches).toBe(true)
    expect(diagnostic?.evidence?.refund_canonical_reversal_matches).toBe(true)
    expect(writes).toBe(0)
    expect(Object.values(diagnostic.evidence ?? {}).every((value) => typeof value === 'boolean')).toBe(true)
    expect(JSON.stringify(diagnostic)).not.toMatch(/trr_Test|re_Test|pi_Test|ch_Test|acct_Test|fee_Test|fr_Test/)
  })
  it.each(['transfer', 'source'])('accepts the authoritative omitted-mode/refund and originating-transaction fee shape (%s reversal)', async (relation) => {
    const value = evidence()
    Object.assign(value.refunds.data[0], { livemode: undefined, transfer_reversal: relation === 'transfer' ? 'trr_Test' : null, source_transfer_reversal: relation === 'source' ? 'trr_Test' : null })
    Object.assign(value.fee, { originating_transaction: 'ch_Test', charge: 'py_ConnectedSide' })
    let writes = 0
    await expect(contracts.recoverExistingRefundEvidence(snapshot, { read: async () => value, pause: async () => {}, update: async () => { writes++ } })).resolves.toMatchObject({ ok: true, reversal_amount: 5500, application_fee_refund_amount: 425 })
    expect(writes).toBe(1)
  })
  it.each([
    ['refund_mode', true], ['refund_mode', null], ['refund_mode', 'false'],
    ['originating_transaction', 'ch_Other'], ['canonical_reversal', 'trr_Other'],
    ['amount_reversed', 5499], ['amount_reversed', undefined], ['amount_reversed', '5500'],
    ['amount_refunded', 424], ['amount_refunded', undefined], ['amount_refunded', '425'],
  ])('never enriches contradictory %s evidence (%s)', async (field, badValue) => {
    const value = evidence()
    if (field === 'refund_mode') Object.assign(value.refunds.data[0], { livemode: badValue })
    if (field === 'originating_transaction') Object.assign(value.fee, { originating_transaction: badValue })
    if (field === 'canonical_reversal') Object.assign(value.refunds.data[0], { transfer_reversal: badValue, source_transfer_reversal: 'trr_Test' })
    if (field === 'amount_reversed') Object.assign(value.transfer, { amount_reversed: badValue })
    if (field === 'amount_refunded') Object.assign(value.fee, { amount_refunded: badValue })
    let writes = 0
    await expect(contracts.recoverExistingRefundEvidence(snapshot, { read: async () => value, pause: async () => {}, update: async () => { writes++ } })).rejects.toThrow('TASK14_REFUND_EVIDENCE_CONFLICT')
    expect(writes).toBe(0)
  })
  it.each([[undefined, true], [false, true], [true, false], [null, false], ['false', false]])('checks metadata update response mode %s without inventing an absent field', (livemode, expected) => {
    expect(contracts.refundModeIsTestCompatible({ livemode })).toBe(expected)
  })
  it('identifies the exact failed economic predicate without reporting provider values', async () => {
    const value = evidence()
    value.feeRefunds.data[0].amount = 424
    let caught: unknown
    try {
      await contracts.runRefundRecoveryStage('evidence_validation', () => contracts.recoverExistingRefundEvidence(snapshot, {
        read: async () => value, pause: async () => {}, update: async () => { throw new Error('unexpected update') },
      }))
    } catch (error) { caught = error }
    const diagnostic = contracts.refundRecoveryDiagnostic(caught) as unknown as { evidence?: Record<string, boolean> }
    expect(diagnostic?.evidence?.fee_refund_amount_matches).toBe(false)
    expect(diagnostic?.evidence?.reversal_amount_matches).toBe(true)
    expect(JSON.stringify(diagnostic)).not.toContain('424')
  })
  it('reports the exact failing recovery stage without retaining arbitrary provider detail', async () => {
    let caught: unknown
    try {
      await contracts.runRefundRecoveryStage('evidence_validation', () => contracts.runRefundRecoveryStage('refund_retrieve', async () => {
        throw new Error('unsafe-provider-detail')
      }))
    } catch (error) { caught = error }
    expect(contracts.refundRecoveryDiagnostic(caught)).toEqual({ stage: 'refund_retrieve', category: 'provider_or_network' })
    expect(JSON.stringify(caught)).not.toContain('unsafe-provider-detail')
    expect(contracts.refundRecoveryDiagnostic(new Error('unsafe-provider-detail'))).toBeNull()
  })
  it.each(['TASK14_REFUND_EVIDENCE_CONFLICT', 'TASK14_REFUND_EVIDENCE_RETRYABLE'])('retains safe evidence classification %s', async (category) => {
    let caught: unknown
    try { await contracts.runRefundRecoveryStage('evidence_validation', async () => { throw new Error(category) }) }
    catch (error) { caught = error }
    expect(contracts.refundRecoveryDiagnostic(caught)).toEqual({ stage: 'evidence_validation', category })
  })
  it('admits only coupled exact review or recovered financial states using the runner SQL', () => {
    const runner = readFileSync(new URL('./run-stripe-ticketing-proof.sh', import.meta.url), 'utf8')
    const admission = runner.match(/or (\(\$TASK14_REFUND_RECOVERY_ONLY = 1\n {10}and \(select count\(\*\) from public\.tickets[\s\S]*?)\)\n {8}and not exists \(select 1 from public\.disputes/)?.[1]
    const candidate = runner.match(/and (\(\( \$TASK14_REFUND_RECOVERY_ONLY = 0 and orders\.status[\s\S]*?)\n {8}and orders\.quantity/)?.[1]
    expect(admission).toBeDefined()
    expect(candidate).toBeDefined()
    const actual = JSON.parse(execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', `
      import { DatabaseSync } from 'node:sqlite'
      import { readFileSync } from 'node:fs'
      const admission = JSON.parse(readFileSync(0, 'utf8')).replaceAll('$TASK14_REFUND_RECOVERY_ONLY', '1').replaceAll(' ~ ', ' REGEXP ')
      const db = new DatabaseSync(':memory:')
      db.function('regexp', (pattern, value) => Number(typeof value === 'string' && new RegExp(pattern).test(value)))
      db.exec("attach ':memory:' as public; create table public.tickets (order_id text, status text)")
      const baseOrder = { id: 'fixture-order', status: 'requires_review', reconciliation_status: 'requires_review', failure_code: 'REFUND_POLICY_MISMATCH', paid_at: 'fixture-time', refunded_at: null, stripe_payment_intent_id: 'pi_Test', stripe_charge_id: 'ch_Test' }
      const baseRefund = { order_id: 'fixture-order', status: 'succeeded', currency: 'usd', amount_minor: 5500, reverse_transfer: 1, refund_application_fee: 1, stripe_payment_intent_id: 'pi_Test', stripe_charge_id: 'ch_Test', stripe_refund_id: 're_Test', stripe_transfer_reversal_id: 'trr_Test', transfer_reversal_amount_minor: 5500, stripe_application_fee_refund_id: null, application_fee_refund_amount_minor: 0, policy_verified: 0, policy_failure_code: 'REFUND_POLICY_MISMATCH' }
      for (const [table, value] of [['orders', baseOrder], ['refunds', baseRefund]]) db.exec('create table public.' + table + ' (' + Object.keys(value).join(',') + ')')
      const insert = (table, value) => db.prepare('insert into public.' + table + ' values (' + Object.keys(value).map(() => '?').join(',') + ')').run(...Object.values(value))
      const result = []
      for (const variant of ['review', 'recovered', 'mixed_tickets', 'short', 'extra', 'valid', 'review_refunded_tickets', 'recovered_cancelled_tickets', 'wrong_binding', 'wrong_fee', 'missing_fee_id', 'bad_policy', 'missing_timestamp', 'wrong_order_status', 'duplicate_refund']) {
        db.exec('delete from public.tickets; delete from public.orders; delete from public.refunds')
        const recovered = !['review', 'review_refunded_tickets'].includes(variant)
        const order = { ...baseOrder, ...(recovered ? { status: 'refunded', reconciliation_status: 'reconciled', failure_code: null, refunded_at: 'fixture-time' } : {}) }
        const refund = { ...baseRefund, ...(recovered ? { stripe_application_fee_refund_id: 'fr_Test', application_fee_refund_amount_minor: 425, policy_verified: 1, policy_failure_code: null } : {}) }
        const statuses = Array(variant === 'short' ? 2 : variant === 'extra' ? 4 : 3).fill(recovered ? 'refunded' : 'cancelled')
        if (variant === 'mixed_tickets') statuses[0] = 'cancelled'
        if (variant === 'valid') statuses[0] = 'valid'
        if (variant === 'review_refunded_tickets') statuses.fill('refunded')
        if (variant === 'recovered_cancelled_tickets') statuses.fill('cancelled')
        if (variant === 'wrong_binding') refund.stripe_charge_id = 'ch_Other'
        if (variant === 'wrong_fee') refund.application_fee_refund_amount_minor = 424
        if (variant === 'missing_fee_id') refund.stripe_application_fee_refund_id = null
        if (variant === 'bad_policy') refund.policy_verified = 0
        if (variant === 'missing_timestamp') order.refunded_at = null
        if (variant === 'wrong_order_status') order.status = 'requires_review'
        insert('orders', order); insert('refunds', refund)
        if (variant === 'duplicate_refund') insert('refunds', refund)
        for (const status of statuses) insert('tickets', { order_id: 'fixture-order', status })
        insert('tickets', { order_id: 'unrelated-order', status: 'cancelled' })
        result.push(db.prepare("select " + admission + " as admitted from (select 'fixture-order' as order_id) as candidate cross join public.orders as orders cross join (select 'clear' as moderation_status) as events").get().admitted)
      }
      db.close()
      process.stdout.write(JSON.stringify(result))
    `], { input: JSON.stringify(`(${candidate}) and (${admission})`), encoding: 'utf8' }))
    expect(actual).toEqual([1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
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
