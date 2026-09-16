import { formatBuyerSchedule } from '../../buyer-journey/format'
import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import type { TicketDisplay } from '../contracts/ticketCollection'
import { BuyerEventSummary, BuyerHeader, BuyerIcon } from '../../buyer-journey/BuyerPrimitives'

type TicketCollectionOverviewProps = {
  eventHref?: string
  collectionLabel: string
  ticketHref(selector: string): string
  tickets: readonly TicketDisplay[]
  freeEventClock?: () => Date
}

const statusLabels: Record<TicketDisplay['status'], string> = {
  valid: 'Valid', used: 'Already used', refunded: 'Refunded', cancelled: 'Cancelled',
}

export function TicketCollectionOverview({ collectionLabel, ticketHref, tickets, eventHref, freeEventClock }: TicketCollectionOverviewProps) {
  const first = tickets[0]
  const [clockRevision, setClockRevision] = useState(0)
  const endsAt = first?.endsAt ? Date.parse(first.endsAt) : NaN
  const ended = Boolean(freeEventClock && endsAt <= freeEventClock().getTime())
  useEffect(() => {
    if (!freeEventClock || !Number.isFinite(endsAt)) return
    const remaining = endsAt - freeEventClock().getTime()
    if (remaining <= 0) return
    const timer = window.setTimeout(() => setClockRevision(value => value + 1), Math.min(remaining + 1, 2_147_483_647))
    return () => window.clearTimeout(timer)
  }, [endsAt, freeEventClock, clockRevision])
  const statusLabel = (ticket: TicketDisplay) => ticket.eventFactsAvailable === false && ticket.status === 'valid' ? 'Status unavailable' : ended && ticket.status === 'valid' ? 'Event ended' : statusLabels[ticket.status]
  return <section className="buyer-wallet" aria-labelledby="ticket-collection-title">
    <BuyerHeader back={first ? <Link className="buyer-icon-button" aria-label="Return to event" to={eventHref ?? `/events/${first.eventId}`}><BuyerIcon name="back" /></Link> : undefined} />
    <div className="buyer-content">
      <header className="buyer-wallet__heading"><h1 id="ticket-collection-title">Ticket wallet</h1><p>{collectionLabel}</p></header>
      {first?.eventStatus === 'cancelled' ? <p role="status">Event cancelled. Each ticket keeps its admission history.</p> : first?.eventUpdated ? <p role="status">Event updated. Review the latest published details.</p> : null}
      {first?.eventFactsAvailable === false ? <p>Previous published event details are unavailable.</p> : null}
      {first ? <BuyerEventSummary title={first.eventName} schedule={formatBuyerSchedule(first.startsAt, first.endsAt, first.timezone)} venue={first.venueName} /> : null}
      <section className="buyer-wallet__tickets"><h2>{!ended && first?.eventFactsAvailable !== false && tickets.every(ticket => ticket.status === 'valid') ? 'Available tickets' : 'Your tickets'}</h2>
        <ol>{tickets.map(ticket => <li key={ticket.selector}>
          <Link aria-label={`Ticket ${ticket.position}, ${ticket.admissionLabel}, ${statusLabel(ticket)}`} className="buyer-wallet-row" to={ticketHref(ticket.selector)}>
            <BuyerIcon name="ticket" className="buyer-ticket-icon" /><div><strong>{ticket.admissionLabel}</strong>{ticket.attendeeLabel ? <span>{ticket.attendeeLabel}</span> : <span>Ticket {ticket.position} of {ticket.totalInCollection}</span>}</div>
            <span className={`buyer-status buyer-status--${ended && ticket.status === 'valid' ? 'ended' : ticket.status}`}><i aria-hidden="true" />{statusLabel(ticket)}</span><span aria-hidden="true">›</span>
          </Link>
        </li>)}</ol>
      </section>
      {first ? <Link className="ui-button buyer-primary" to={ticketHref(first.selector)}>View first ticket<BuyerIcon name="arrow" /></Link> : null}
      <Link className="ui-button buyer-secondary" to="/discover">Browse events</Link>
    </div>
  </section>
}
