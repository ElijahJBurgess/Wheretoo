export const task18CheckoutTierNames = ['Task 17 General Admission', 'Task 17 VIP'] as const

type DriverInvoke = (action: string, input?: Record<string, unknown>, signal?: AbortSignal) => Promise<Record<string, unknown>>

export async function prepareStableBuyerFixture(invoke: DriverInvoke, prefix: string) {
  const setup = await invoke('setup')
  const items = setup.items as Array<Record<string, unknown>> | undefined
  if (!/^task17_[a-z0-9]{12}$/.test(prefix) || setup.ok !== true ||
    typeof setup.event_id !== 'string' || !/^[0-9a-f-]{36}$/.test(setup.event_id) ||
    setup.quantity !== 3 || setup.subtotal_minor !== 5500 || setup.total_minor !== 5500 ||
    !Array.isArray(items) || items.length !== 2 ||
    !items.some((item) => item.label === 'ga' && item.name === task18CheckoutTierNames[0] &&
      item.quantity === 2 && item.unit_amount_minor === 1500 && item.subtotal_minor === 3000 && item.currency === 'usd') ||
    !items.some((item) => item.label === 'vip' && item.name === task18CheckoutTierNames[1] &&
      item.quantity === 1 && item.unit_amount_minor === 2500 && item.subtotal_minor === 2500 && item.currency === 'usd')) {
    throw new Error('TASK14_FIXTURE_CONTRACT')
  }
  return {
    eventId: setup.event_id,
    publicEventPath: `/events/${setup.event_id}`,
    title: `${prefix} transaction`,
    buyerEmail: `${prefix}-paid@example.invalid`,
    orderHandle: 'paid' as const,
  }
}

// The outer runner invokes this even when Playwright fails after payment.
// Refuse destructive database teardown until the exact session is settled.
export async function settleBrowserCheckout(
  invoke: DriverInvoke,
  eventId: string,
  liteProof = false,
  deadlines = { requestTimeoutMs: 30_000, settlementTimeoutMs: 120_000 },
) {
  if (![deadlines.requestTimeoutMs, deadlines.settlementTimeoutMs].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('TASK14_SETTLEMENT_TIMEOUT')
  }
  const controller = new AbortController()
  const abort = () => controller.abort(new Error('TASK14_SETTLEMENT_TIMEOUT'))
  const settlementTimer = setTimeout(abort, deadlines.settlementTimeoutMs)
  try {
    await settleBrowserCheckoutWithinDeadline(async (action, input) => {
      controller.signal.throwIfAborted()
      const requestTimer = setTimeout(abort, deadlines.requestTimeoutMs)
      let onAbort = () => {}
      const expired = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(controller.signal.reason)
        controller.signal.addEventListener('abort', onAbort, { once: true })
      })
      try {
        // Race as well as abort: a transport that stalls or ignores cancellation
        // cannot block outer cleanup. A timed-out write remains financially uncertain.
        return await Promise.race([invoke(action, input, controller.signal), expired])
      } finally {
        clearTimeout(requestTimer)
        controller.signal.removeEventListener('abort', onAbort)
      }
    }, eventId, liteProof)
  } finally {
    clearTimeout(settlementTimer)
  }
}

async function settleBrowserCheckoutWithinDeadline(invoke: DriverInvoke, eventId: string, liteProof: boolean) {
  const inspection = await invoke('inspect', { event_id: eventId })
  const orders = inspection.orders as Array<Record<string, unknown>> | undefined
  const unsafe = () => { throw new Error('TASK14_CLEANUP_UNSAFE') }
  if (!Array.isArray(orders) || orders.length > 1 || orders.some((order) => order.order_handle !== 'paid')) unsafe()
  if (orders!.length === 0) return
  const input = { order_handle: 'paid' }
  if (orders![0].status === 'refunded') {
    // The completed payment is historical after refund. Replaying it can
    // correctly trigger Checkout Integrity review; certify the refund instead.
    const existing = inspection.refunds as Array<Record<string, unknown>> | undefined
    const ticketSets = inspection.tickets as Array<Record<string, unknown>> | undefined
    const expectedUsed = liteProof ? ticketSets?.[0]?.used_count : 0
    if (orders![0].reconciliation_status !== 'reconciled' || orders![0].failure_code !== null ||
      !Array.isArray(existing) || existing.length !== 1 || existing[0].order_handle !== 'paid' ||
      !Number.isInteger(expectedUsed) || Number(expectedUsed) < 0 || Number(expectedUsed) > 3) unsafe()
    // Existing refunded-state recovery only reads and certifies durable truth.
    const refund = await invoke('recover_refund', input)
    if (!browserRefundRecoveryIsSafe(refund, Number(expectedUsed))) unsafe()
    return
  }
  const status = await invoke('checkout_status', input)
  if (status.ok !== true || status.livemode !== false) unsafe()
  const paid = status.status === 'complete' && status.payment_status === 'paid' && status.charge_paid === true
  const unpaid = ['open', 'expired'].includes(String(status.status)) && status.payment_status === 'unpaid' && status.charge_paid !== true
  if (!paid && !unpaid) unsafe()
  if (status.status === 'open') {
    const expired = await invoke('expire_checkout', input)
    if (expired.ok !== true || expired.livemode !== false || expired.status !== 'expired') unsafe()
  }
  const delivery = await invoke('deliver', { event: {
    event_handle: crypto.randomUUID(),
    type: paid ? 'checkout.session.completed' : 'checkout.session.expired',
    object: 'checkout.session', order_handle: 'paid', created: Math.floor(Date.now() / 1000),
  } })
  if (delivery.status !== 200 || (delivery.receipt as Record<string, unknown>)?.processing_status !== 'processed') unsafe()
  if (paid) {
    const ticketSets = inspection.tickets as Array<Record<string, unknown>> | undefined
    const expectedUsed = liteProof ? ticketSets?.[0]?.used_count : 0
    if (!Number.isInteger(expectedUsed) || Number(expectedUsed) < 0 || Number(expectedUsed) > 3) unsafe()
    // Creation can succeed before enrichment fails. Never retry creation here.
    const existing = inspection.refunds as Array<Record<string, unknown>> | undefined
    if (existing !== undefined && (!Array.isArray(existing) || existing.length > 1 ||
      existing.some((refund) => refund.order_handle !== 'paid'))) unsafe()
    if (!existing?.length) {
      try { await invoke('create_refund', input) } catch { /* authoritative same-refund recovery below */ }
    }
    const refund = await invoke('recover_refund', input)
    if (!browserRefundRecoveryIsSafe(refund, Number(expectedUsed))) unsafe()
  }
}

export function browserRefundRecoveryIsSafe(refund: Record<string, unknown>, expectedUsed = 0) {
  return refund.ok === true && refund.livemode === false && refund.amount === 5500 &&
    refund.reversal_amount === 5500 && refund.application_fee_refund_amount === 425 &&
    refund.order_refunded === true && refund.reconciled === true && refund.refund_count === 1 &&
    refund.policy_verified === true && refund.ticket_count === 3 && refund.invalid_ticket_count === 3 &&
    Number.isInteger(expectedUsed) && expectedUsed >= 0 && expectedUsed <= 3 &&
    refund.refunded_ticket_count === 3 - expectedUsed &&
    (expectedUsed === 0 ? (refund.used_ticket_count === undefined || refund.used_ticket_count === 0)
      : (refund.used_ticket_count === expectedUsed && refund.used_history_preserved === true))
}

type CheckoutAttemptIdentity = {
  clientRequestId: string
  confirmationBearer: string
}

export function checkoutAttemptMatches(
  left: CheckoutAttemptIdentity,
  right: CheckoutAttemptIdentity,
): boolean {
  return left.clientRequestId === right.clientRequestId &&
    left.confirmationBearer === right.confirmationBearer
}
