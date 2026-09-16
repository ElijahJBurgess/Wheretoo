import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { z } from 'zod'
import { useCheckInContext } from './CheckInContext'
import { useOrder } from './operations.queries'
import { isOperationsAccessDenied } from './operations.errors'
import { ManualAdmissionDialog } from './ManualAdmissionDialog'
import { AdmissionResultView } from '../ticket-experience/scanner/OrganizerScannerView'
import { dateTime } from './operations.format'
export function GuestTicketDetailPage() {
  const { orderId = '', ticketId = '' } = useParams()
  const context = useCheckInContext()
  if (!z.uuid().safeParse(orderId).success || !z.uuid().safeParse(ticketId).success) {
    return (
      <section className='find-guest'>
        <h1>Invalid ticket selection</h1>
        <Link className='ops-button' to='../..' relative='path'>Back to search</Link>
      </section>
    )
  }
  return (
    <TicketDetails
      key={`${context.ownerId}:${context.eventId}:${orderId}:${ticketId}`}
      orderId={orderId}
      ticketId={ticketId}
    />
  )
}
function TicketDetails({ orderId, ticketId }: { orderId: string; ticketId: string }) {
  const { ownerId, identityVersion, eventId, event } = useCheckInContext()
  const query = useOrder(ownerId, eventId, orderId)
  const [confirm, setConfirm] = useState(false)
  const base = `/organizer/events/${eventId}/check-in`
  const navigation = (
    <div className='find-guest__actions'>
      <Link className='ops-button ops-button--primary' to={`${base}/scan`}>Return to scanner</Link>
      <Link className='ops-button' to={`${base}/find`}>Find another guest</Link>
    </div>
  )
  if (query.isPending || !query.isFetchedAfterMount) return <p role='status'>Loading guest…</p>
  if (!query.data || isOperationsAccessDenied(query.error)) {
    return (
      <section className='find-guest' role='alert'>
        <h1>Guest unavailable</h1>
        <p>Your access and selected ticket could not be confirmed.</p>
        <Link className='ops-button' to={`${base}/find`}>Back to search</Link>
      </section>
    )
  }
  const order = query.data
  const ticket = order.tickets.find((t) => t.id === ticketId)
  if (!ticket) {
    return (
      <section className='find-guest'>
        <AdmissionResultView
          source='manual'
          timeZone={event.timezone}
          result={{ outcome: 'invalid' }}
        >
          {navigation}
        </AdmissionResultView>
      </section>
    )
  }
  const number = order.tickets.findIndex((t) => t.id === ticketId) + 1
  if (!confirm && !query.isError && ticket.status !== 'valid') {
    return (
      <section className='find-guest'>
        <Link className='ops-back' to={`${base}/find`}>← Back to search</Link>
        <AdmissionResultView
          source='manual'
          timeZone={event.timezone}
          result={{
            outcome: ticket.status === 'used' ? 'already_used' : ticket.status,
            attendeeLabel: order.buyerName,
            admissionLabel: ticket.admissionLabel,
            ...(ticket.usedAt ? { usedAt: ticket.usedAt } : {}),
          }}
        >
          {navigation}
        </AdmissionResultView>
      </section>
    )
  }
  return (
    <section className='find-guest'>
      <Link className='ops-back' to={`${base}/find`}>← Back to search</Link>
      <h1>Guest Details</h1>
      <h2>{order.buyerName || 'Ticket buyer'}</h2>
      <p>{order.buyerEmail}</p>
      <p className='ops-note'>Buyer information · Ticket {number} of {order.tickets.length}</p>
      <dl className='find-guest__facts'>
        <div>
          <dt>Ticket type</dt>
          <dd>{ticket.admissionLabel}</dd>
        </div>
        <div>
          <dt>Event</dt>
          <dd>{event.title}</dd>
        </div>
        <div>
          <dt>Order reference</dt>
          <dd>{order.orderNumber}</dd>
        </div>
        <div>
          <dt>Ticket status</dt>
          <dd>
            <span className={`ops-badge ops-badge--${ticket.status}`}>
              {ticket.status === 'used' ? 'Already checked in' : ticket.status}
            </span>
          </dd>
        </div>
        {ticket.usedAt && (
          <div>
            <dt>Original check-in</dt>
            <dd>{dateTime(ticket.usedAt, event.timezone)}</dd>
          </div>
        )}
      </dl>
      {query.isError && (
        <p role='alert'>
          Ticket status could not refresh. Check-in is unavailable until confirmed.{' '}
          <button className='ops-button' onClick={() => void query.refetch()}>
            Refresh ticket
          </button>
        </p>
      )}
      {!query.isError && ticket.status === 'valid' && order.admissionEligible && (
        <button
          className='ops-button ops-button--primary'
          onClick={() => setConfirm(true)}
        >
          Check in guest
        </button>
      )}
      {!confirm && ticket.status === 'valid' && !order.admissionEligible && (
        <p role='alert'>Check-in closed. This ticket cannot currently be admitted.</p>
      )}
      {confirm && (
        <ManualAdmissionDialog
          ownerId={ownerId}
          identityVersion={identityVersion}
          eventId={eventId}
          orderId={orderId}
          orderNumber={order.orderNumber}
          timeZone={event.timezone}
          eventName={event.title ?? 'Selected event'}
          buyerName={order.buyerName}
          ticketNumber={number}
          ticket={ticket}
          canAdmit={!query.isError && ticket.status === 'valid' && order.admissionEligible}
          onClose={() => setConfirm(false)}
          journey
          resultActions={navigation}
        />
      )}
    </section>
  )
}
