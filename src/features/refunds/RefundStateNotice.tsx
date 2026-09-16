import { DeliverySupport } from '../ticket-delivery/DeliverySupport'
import type { RefundStatus } from './refunds.schemas'
export type RefundViewState = RefundStatus['state'] | 'unauthorized' | 'already_refunded'
const copy: Record<Exclude<RefundViewState, 'eligible'>, [string, string]> = {
 submitting: ['Submitting refund', 'Your request is being recorded. Completion is not yet confirmed.'],
 processing: ['Refund processing', 'Waiting for payment confirmation. Ticket status follows the confirmed order record.'],
 unknown: ['Refund outcome unknown', 'The result could not be confirmed. Check the existing refund before taking any further action.'],
 review: ['Refund needs review', 'This order needs a refund review. Ticket access may be held while the payment is reviewed.'],
 failed: ['Refund failed', 'The refund did not complete. No new refund attempt is available here.'],
 completed: ['Refund complete', 'The full order refund is confirmed. Unused tickets are refunded; previous check-ins remain in the event history.'],
 already_refunded: ['Already refunded', 'The full order refund was already confirmed. No additional refund was created.'],
 ineligible: ['Refund unavailable', 'This order is not eligible for a whole-order refund.'],
 unauthorized: ['Refund access unavailable', 'Sign in with the organizer account that owns this event to view its refund status.'],
}
export function RefundStateNotice({ state }: { state: RefundViewState }) {
 if (state === 'eligible') return null
 const [heading, description] = copy[state]
 return <div className={`refund-state refund-state--${state}`} role={['review', 'failed', 'unknown', 'unauthorized'].includes(state) ? 'alert' : 'status'}>
  <span className='refund-state__icon' aria-hidden='true'>{state === 'completed' || state === 'already_refunded' ? '✓' : '!'}</span>
  <div><h3>{heading}</h3><p>{description}</p>{['review', 'failed', 'unknown', 'ineligible'].includes(state) && <DeliverySupport />}</div>
 </div>
}
