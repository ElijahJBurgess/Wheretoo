import { useState } from 'react'
import { RefundOrderDialog } from './RefundOrderDialog'
import { ManualAdmissionDialog } from './ManualAdmissionDialog'
import type { OrderDetail } from './operations.schemas'
import { Link, useParams } from 'react-router-dom'
import { useSession } from '../auth/SessionProvider'
import { useEventMetrics, useOrder } from './operations.queries'
import { OperationsError } from './OperationsUi'
import { dateTime, money, statusLabel } from './operations.format'
export function OrganizerOrderDetailPage() {
  const { eventId = '', orderId = '' } = useParams()
  const session = useSession()
  const ownerId = session.status === 'authenticated' ? session.user.id : ''
  return (
    <OrderDetailContent
      key={`${ownerId}:${eventId}:${orderId}`}
      ownerId={ownerId}
      eventId={eventId}
      orderId={orderId}
    />
  )
}
function OrderDetailContent(
  { ownerId, eventId, orderId }: { ownerId: string; eventId: string; orderId: string },
) {
  const [refundOpen, setRefundOpen] = useState(false)
  const event = useEventMetrics(ownerId, eventId)
  const [selected, setSelected] = useState<OrderDetail['tickets'][number] | null>(null)
  const query = useOrder(ownerId, eventId, orderId)
  if (query.isPending) return <p role='status' className='operations-state'>Loading order…</p>
  if (query.isError) {
    return (
      <OperationsError
        title='Order unavailable'
        retry={() => void query.refetch()}
      />
    )
  }
  const order = query.data
  return (
    <section className='operations-page ops-detail'>
      <Link className='ops-back' to={`/organizer/events/${eventId}/orders`}>← Orders</Link>
      <p className='ops-detail-event'>{event.data?.event.title ?? 'Event operations'}</p>
      <h1>Order Details</h1>
      {selected && (
        <ManualAdmissionDialog
          key={`${ownerId}:${eventId}:${selected.id}`}
          ownerId={ownerId}
          eventId={eventId}
          buyerName={order.buyerName}
          eventName={event.data?.event.title || `Event ${eventId}`}
          ticketNumber={order.tickets.findIndex((ticket) => ticket.id === selected.id) + 1}
          ticket={selected}
          onClose={() => setSelected(null)}
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
            <dd>{dateTime(order.paidAt ?? order.createdAt)}</dd>
          </div>
          <div>
            <dt>{order.paidAt ? 'Total paid' : 'Total due'}</dt>
            <dd>{money(order.totalMinor)}</dd>
          </div>
        </dl>
      </div>
      <h2>Purchased</h2>
      <div className='ops-panel'>
        {order.items.map((item, index) => (
          <div className='ops-tier' key={index}>
            <h3>{item.tierName} ×{item.quantity}</h3>
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
            <p>{order.buyerName}</p>
            <p className='ops-muted'>{ticket.admissionLabel}</p>
            {ticket.usedAt && <p className='ops-note'>Checked in · {dateTime(ticket.usedAt)}</p>}
            {ticket.status === 'valid' && order.admissionEligible && (
              <button
                className='ops-button'
                onClick={() => setSelected(ticket)}
              >
                Check in ticket
              </button>
            )}
          </article>
        ))}
      </div>
      {order.refundState === 'pending' && (
        <p role='status' className='ops-note'>Refund pending. Waiting for payment confirmation.</p>
      )}
      {(order.refundState === 'available' || order.refundState === 'recoverable') && (
        <div className='ops-actions'>
          <button className='ops-button ops-button--danger' onClick={() => setRefundOpen(true)}>
            {order.refundState === 'recoverable' ? 'Retry refund confirmation' : 'Refund order'}
          </button>
        </div>
      )}
      {refundOpen && (
        <RefundOrderDialog
          ownerId={ownerId}
          eventId={eventId}
          orderId={orderId}
          orderNumber={order.orderNumber}
          totalMinor={order.totalMinor}
          quantity={order.quantity}
          onClose={() => setRefundOpen(false)}
        />
      )}
      <p className='ops-note'>
        V1 refunds cover the entire order. Used admissions retain their check-in history.
      </p>
    </section>
  )
}
