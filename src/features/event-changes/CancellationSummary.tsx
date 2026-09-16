import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { money, dateTime } from '../organizer-operations/operations.format'
import { useCancellationSummary } from './eventChanges.queries'
export function CancellationSummary({ eventId, ownerId }: { eventId: string; ownerId: string }) {
 const query = useCancellationSummary(eventId, ownerId)
 const summary = query.data
 return <section className="event-change-section" aria-labelledby="cancellation-summary-title"><h2 id="cancellation-summary-title">Cancellation summary</h2>
  {query.isPending ? <p role="status">Loading cancellation summary…</p> : query.isError || !summary ? <p role="alert">Summary unavailable. Cancellation status is independent of this summary.</p> : <>
   <p>Current counts as of {dateTime(summary.asOf)}. Unused admissions now cancelled are separate from used admission history.</p>
   {!summary.complete ? <p role="alert">Complete summary unavailable. Partial counts are not shown as totals.</p> : null}
   <h3>Admissions</h3>{summary.complete && summary.tickets ? <dl className="event-change-counts">{Object.entries({ 'Issued admissions': summary.tickets.issued, 'Unused now cancelled': summary.tickets.cancelledUnused, 'Used — history retained': summary.tickets.used, 'Refunded admissions': summary.tickets.refunded, 'Other current states': summary.tickets.other }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : <p>Unavailable</p>}
   {summary.admissionType === 'free' ? <><h3>Free registrations</h3>{summary.complete && summary.free ? <dl className="event-change-counts"><div><dt>Registrations</dt><dd>{summary.free.registrations}</dd></div><div><dt>Admissions</dt><dd>{summary.free.admissions}</dd></div><div><dt>Cancelled registrations</dt><dd>{summary.free.cancelledRegistrations}</dd></div></dl> : <p>Unavailable</p>}<p>Payments and refunds: Not applicable to free registrations.</p><Link to={`/organizer/events/${eventId}/registrations`}>Manage registrations</Link></> : <><h3>Payments and refunds</h3><p>Cancellation does not confirm refunds. Review each order to use the existing refund process.</p>{summary.complete && summary.paid ? <dl className="event-change-counts">{Object.entries({ 'Payment received orders': summary.paid.receivedOrders, 'Unpaid attempts': summary.paid.unpaidAttempts, 'Confirmed whole-order refunds': summary.paid.completedOrders, 'Not confirmed refunded': summary.paid.notConfirmedRefundedOrders, 'Eligible orders': summary.paid.eligibleOrders, 'Eligible amount': money(summary.paid.eligibleAmountMinor), 'Processing': summary.paid.processingOrders, 'Action required': summary.paid.actionRequiredOrders, 'Unknown': summary.paid.unknownOrders, 'Failed': summary.paid.failedOrders, 'Review': summary.paid.reviewOrders }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : <p>Payment summary unavailable</p>}<Link to={`/organizer/events/${eventId}/orders`}>Review orders and refunds</Link></>}
  </>}
  <Button disabled={query.isFetching} onClick={() => void query.refetch()} variant="secondary">Refresh summary</Button>
 </section>
}
