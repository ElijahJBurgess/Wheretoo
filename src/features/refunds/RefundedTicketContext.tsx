import { DeliverySupport } from '../ticket-delivery/DeliverySupport'
import { dateTime } from '../organizer-operations/operations.format'
import './refunds.css'
export function RefundedTicketContext({ orderNumber, admissionLabel, position, status, usedAt, timezone }: {
 orderNumber: string; admissionLabel: string; position: number; status: 'used' | 'refunded'; usedAt: string | null; timezone?: string
}) {
 return <article className={`refund-inactive-ticket refund-inactive-ticket--${status}`}>
  <h3>Ticket {position} · {admissionLabel}</h3>
  <div className='refund-inactive-ticket__stamp'><svg aria-hidden='true' viewBox='0 0 32 32' fill='none' stroke='currentColor' strokeWidth='1.8'><circle cx='16' cy='16' r='12' /><path d={status === 'used' ? 'm10 16 4 4 8-9' : 'm8 24 16-16'} /></svg><span>{status === 'used' ? 'Used' : 'Refunded'}</span></div>
  <p>{status === 'used' ? 'This ticket was used. Its check-in history is preserved.' : 'This ticket is no longer valid for entry.'}</p>
  {status === 'used' && usedAt && <p>Checked in · {dateTime(usedAt, timezone)}</p>}
  <p className='ops-note'>Order #{orderNumber}</p>
 </article>
}
/** Safe attachment for refunded confirmation and inactive collection screens after shared-file integration. */
export function RefundSupportContext({ orderNumber }: { orderNumber?: string }) {
 return <aside className='refund-support-context'>{orderNumber && <p>Order #{orderNumber}</p>}<p>Refunded tickets cannot be used for entry. Previously used tickets keep their check-in history.</p><DeliverySupport /></aside>
}
