import { ReadState } from '../../components/ui/ReadState'
import { useState } from 'react'
import { isOperationsAccessDenied } from './operations.errors'
import { RefundOrderPanel } from '../refunds/RefundOrderPanel'
import { ManualAdmissionDialog } from './ManualAdmissionDialog'
import { Link, useParams } from 'react-router-dom'
import { useSession } from '../auth/SessionProvider'
import { useOwnedEvent } from '../events/event.queries'
import { useOrder } from './operations.queries'
import { OperationsError } from './OperationsUi'
import { dateTime, money, statusLabel } from './operations.format'
export function OrganizerOrderDetailPage() {
  const { eventId = '', orderId = '' } = useParams()
  const session = useSession()
  const ownerId = session.status === 'authenticated' ? session.user.id : ''
  return (
    <OrderDetailContent
      key={`${ownerId}:${session.identityVersion ?? 0}:${eventId}:${orderId}`}
      ownerId={ownerId}
      identityVersion={session.identityVersion ?? 0}
      eventId={eventId}
      orderId={orderId}
    />
  )
}
function OrderDetailContent(
  { ownerId, identityVersion, eventId, orderId }: { ownerId: string; identityVersion: number; eventId: string; orderId: string },
) {
  const event = useOwnedEvent(eventId, ownerId, { revalidateOnMount: true })
  const verifiedEvent = event.isFetchedAfterMount && !event.isError ? event.data : undefined
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const query = useOrder(ownerId, eventId, orderId)
  if (query.isPending || !query.isFetchedAfterMount) return <ReadState headingAs='h1' paused={query.fetchStatus === 'paused'} status='loading' skeleton='detail-fields' title='Loading order…' />
  if (query.isError && (!query.data || isOperationsAccessDenied(query.error))) {
    return (
      <OperationsError
        title='Order unavailable'
        retry={() => void query.refetch()}
      />
    )
  }
  const order = query.data
  const selected = order.tickets.find(ticket => ticket.id === selectedId)
  return (
    <section className='operations-page ops-detail'>
      <Link className='ops-back' to={`/organizer/events/${eventId}/orders`}>← Orders</Link>
      <p className='ops-detail-event'>{verifiedEvent?.title ?? 'Event operations'}</p>
      <h1>Order Details</h1>
      {query.isError && <p role='alert'>Ticket status could not refresh. Check-in is unavailable until status is confirmed.</p>}
      {selected && (
        <ManualAdmissionDialog
          key={`${ownerId}:${identityVersion}:${eventId}:${selected.id}`}
          ownerId={ownerId}
          identityVersion={identityVersion}
          eventId={eventId}
          orderId={orderId}
          orderNumber={order.orderNumber}
          timeZone={verifiedEvent?.timezone}
          buyerName={order.buyerName}
          eventName={verifiedEvent?.title || `Event ${eventId}`}
          ticketNumber={order.tickets.findIndex((ticket) => ticket.id === selected.id) + 1}
          ticket={selected}
          canAdmit={!query.isError && selected.status === 'valid' && order.admissionEligible}
          onClose={() => setSelectedId(null)}
        />
      )}
      <div className='ops-panel ops-order-summary'>
        <div className='ops-section-heading'>
          <h2>Order #{order.orderNumber}</h2>
          <span className={`ops-badge ops-badge--${order.status}`}>
            {statusLabel(order.status)}
          </span>
        </div>
        <h3>{order.buyerName}</h3>
        <p className='ops-muted'>{order.buyerEmail}</p>
        <dl className='ops-order-facts'>
          <div>
            <dt>{order.paidAt ? 'Purchased' : 'Created'}</dt>
            <dd>{dateTime(order.paidAt ?? order.createdAt, verifiedEvent?.timezone)}</dd>
          </div>
          <div>
            <dt>{order.paidAt ? 'Total paid' : 'Total due'}</dt>
            <dd>{money(order.totalMinor)}</dd>
          </div>
          <div><dt>Subtotal</dt><dd>{money(order.subtotalMinor)}</dd></div>
          <div><dt>Tax</dt><dd>{money(order.taxMinor)}</dd></div>
        </dl>
      </div>
      <Link className="ops-button" to={`/organizer/events/${eventId}/email-attendees?order=${orderId}`}>Email customer</Link>
      <h2>Purchased</h2>
      <div className='ops-panel'>
        {order.items.map((item, index) => (
          <div className='ops-tier' key={index}>
            <div><h3>{item.tierName} ×{item.quantity}</h3><p className='ops-note'>{money(item.unitAmountMinor)} each</p></div>
            <strong>{money(item.subtotalMinor)}</strong>
          </div>
        ))}
      </div>
      <h2>Tickets</h2>
      <div className='ops-ticket-list'>
        {order.tickets.length === 0 && (
          <p className='ops-panel operations-state'>No tickets issued.</p>
        )}
        {order.tickets.map((ticket, index) => (
          <article className='ops-panel ops-ticket' key={ticket.id}>
            <div className='ops-section-heading'>
              <h3>Ticket {index + 1}</h3>
              <span className={`ops-badge ops-badge--${ticket.status}`}>
                {ticket.status === 'valid'
                  ? 'Valid'
                  : ticket.status === 'used'
                  ? 'Used'
                  : ticket.status === 'refunded'
                  ? 'Refunded'
                  : 'Cancelled'}
              </span>
            </div>
            <p>Buyer: {order.buyerName}</p>
            <p className='ops-muted'>{ticket.admissionLabel}</p>
            {ticket.usedAt && <p className='ops-note'>Checked in · {dateTime(ticket.usedAt, verifiedEvent?.timezone)}</p>}
            {ticket.status === 'valid' && order.admissionEligible && (
              <button
                className='ops-button'
                onClick={() => setSelectedId(ticket.id)}
              >
                Check in ticket
              </button>
            )}
          </article>
        ))}
      </div>
      <RefundOrderPanel ownerId={ownerId} eventId={eventId} orderId={orderId} orderReadUnavailable={query.isError} />
    </section>
  )
}
