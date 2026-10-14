import { formatBuyerSchedule } from '../../buyer-journey/format'
import { Link } from 'react-router-dom'
import type { TicketDisplay } from '../contracts/ticketCollection'
import { BuyerEventSummary, BuyerHeader, BuyerIcon } from '../../buyer-journey/BuyerPrimitives'

type TicketCollectionOverviewProps = {
  eventHref?: string
  collectionLabel: string
  ticketHref(selector: string): string
  tickets: readonly TicketDisplay[]
}

const statusLabels: Record<TicketDisplay['status'], string> = {
  valid: 'Valid', used: 'Already used', refunded: 'Refunded', cancelled: 'Cancelled',
}

export function TicketCollectionOverview({ collectionLabel, ticketHref, tickets, eventHref }: TicketCollectionOverviewProps) {
  const first = tickets[0]
  return <section className="buyer-wallet" aria-labelledby="ticket-collection-title">
    <BuyerHeader back={first ? <Link className="buyer-icon-button" aria-label="Return to event" to={eventHref ?? `/events/${first.eventId}`}><BuyerIcon name="back" /></Link> : undefined} />
    <div className="buyer-content">
      <header className="buyer-wallet__heading"><h1 id="ticket-collection-title">Ticket wallet</h1><p>{collectionLabel}</p></header>
      {first ? <BuyerEventSummary title={first.eventName} schedule={formatBuyerSchedule(first.startsAt, first.endsAt)} venue={first.venueName} /> : null}
      <section className="buyer-wallet__tickets"><h2>{tickets.every(ticket => ticket.status === 'valid') ? 'Available tickets' : 'Your tickets'}</h2>
        <ol>{tickets.map(ticket => <li key={ticket.selector}>
          <Link aria-label={`Ticket ${ticket.position}, ${ticket.admissionLabel}, ${statusLabels[ticket.status]}`} className="buyer-wallet-row" to={ticketHref(ticket.selector)}>
            <BuyerIcon name="ticket" className="buyer-ticket-icon" /><div><strong>{ticket.admissionLabel}</strong>{ticket.attendeeLabel ? <span>{ticket.attendeeLabel}</span> : <span>Ticket {ticket.position} of {ticket.totalInCollection}</span>}</div>
            <span className={`buyer-status buyer-status--${ticket.status}`}><i aria-hidden="true" />{statusLabels[ticket.status]}</span><span aria-hidden="true">›</span>
          </Link>
        </li>)}</ol>
      </section>
      {first ? <Link className="ui-button buyer-primary" to={ticketHref(first.selector)}>View first ticket<BuyerIcon name="arrow" /></Link> : null}
    </div>
  </section>
}
