import { cancelCheckout, createCheckout } from './checkout.api'
import { clearCheckoutAttemptForConfirmation, findCheckoutAttempt, getOrCreateCheckoutAttempt, markCheckoutRejected, markCheckoutSubmitted } from './checkout.attempt'
import { getOrderConfirmation } from '../orders/order.api'
import type { OrderConfirmation } from '../orders/order.types'
import { checkoutCanonicalSubmissionSchema, type CheckoutCanonicalSubmission } from './checkout.schemas'

export type CheckoutRecoveryResult =
  | { kind: 'hosted'; bearer: string; checkoutUrl: string }
  | { kind: 'order'; bearer: string; order: OrderConfirmation }
  | { kind: 'unknown'; bearer?: string }
  | { kind: 'stock' | 'unavailable'; bearer: string }
  | { kind: 'cancelled'; bearer: string }

const submissions = new Map<string, { canonical: string; operation: Promise<CheckoutRecoveryResult> }>()
const cancellations = new Map<string, Promise<CheckoutRecoveryResult>>()
const definitiveUnavailableCodes = new Set(['EVENT_NOT_SELLABLE', 'EVENT_NOT_FOUND', 'CONNECT_NOT_READY', 'CONNECT_ACTION_REQUIRED'])
const definitiveStockCodes = new Set(['TIER_SOLD_OUT', 'TIER_NOT_FOUND', 'TIER_NOT_ACTIVE'])

export async function checkCheckoutAttempt(bearer: string): Promise<CheckoutRecoveryResult> {
  try { return { kind: 'order', bearer, order: await getOrderConfirmation(bearer) } }
  catch { return { kind: 'unknown', bearer } }
}

export function submitCheckoutAttempt(submission: CheckoutCanonicalSubmission, verifiedEventId: string, replay = false, expectedBearer?: string): Promise<CheckoutRecoveryResult> {
  submission = checkoutCanonicalSubmissionSchema.parse(submission)
  const canonical = JSON.stringify(submission)
  const existing = submissions.get(submission.eventId)
  if (existing) return existing.canonical === canonical ? existing.operation : Promise.reject(new Error('Resolve your existing checkout before changing buyer details or tickets.'))
  const operation = (async (): Promise<CheckoutRecoveryResult> => {
    const attempt = await getOrCreateCheckoutAttempt(submission, expectedBearer, replay)
    const bearer = attempt.confirmationBearer
    if (cancellations.has(bearer)) return { kind: 'unknown', bearer }
    if (attempt.lifecycle === 'rejected') return { kind: attempt.rejectionKind ?? 'stock', bearer }
    const firstSubmission = attempt.lifecycle === 'prepared'
    if (!firstSubmission) {
      const current = await checkCheckoutAttempt(bearer)
      if (current.kind !== 'order' || current.order.status !== 'processing' || !replay) return current
    }
    // Persist uncertainty before transport: a lost response must never authorize replacement.
    markCheckoutSubmitted(submission.eventId, attempt, submission, verifiedEventId)
    try {
      const checkoutUrl = await createCheckout({ ...submission, clientRequestId: attempt.clientRequestId }, bearer)
      return { kind: 'hosted', bearer, checkoutUrl }
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
      if (firstSubmission && (definitiveStockCodes.has(code) || definitiveUnavailableCodes.has(code))) {
        const kind = definitiveStockCodes.has(code) ? 'stock' : 'unavailable'
        markCheckoutRejected(submission.eventId, attempt, kind)
        return { kind, bearer }
      }
      return { kind: 'unknown', bearer }
    }
  })().finally(() => { submissions.delete(submission.eventId) })
  submissions.set(submission.eventId, { canonical, operation })
  return operation
}

export function releaseRejectedCheckoutAttempt(bearer: string): boolean {
  const found = findCheckoutAttempt(bearer)
  if (!found || found.attempt.lifecycle !== 'rejected') return false
  clearCheckoutAttemptForConfirmation(bearer)
  return findCheckoutAttempt(bearer) === null
}

export function cancelCheckoutAttempt(bearer: string): Promise<CheckoutRecoveryResult> {
  const existing = cancellations.get(bearer)
  if (existing) return existing
  const operation = (async (): Promise<CheckoutRecoveryResult> => {
    const found = findCheckoutAttempt(bearer)
    const pending = found && submissions.get(found.eventId)
    if (pending) await pending.operation.catch(() => undefined)
    try {
      await cancelCheckout(bearer)
      clearCheckoutAttemptForConfirmation(bearer)
      return { kind: 'cancelled', bearer }
    } catch { return checkCheckoutAttempt(bearer) }
  })().finally(() => { cancellations.delete(bearer) })
  cancellations.set(bearer, operation)
  return operation
}
