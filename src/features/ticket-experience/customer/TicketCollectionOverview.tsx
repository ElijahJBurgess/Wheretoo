import { Link } from 'react-router-dom'
import type { TicketDisplay } from '../contracts/ticketCollection'

type TicketCollectionOverviewProps = {
  collectionLabel: string
  ticketHref(selector: string): string
  tickets: readonly TicketDisplay[]
}

const statusLabels: Record<TicketDisplay['status'], string> = {
  valid: 'Valid',
  used: 'Already used',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
}

export function TicketCollectionOverview({
  collectionLabel,
  ticketHref,
  tickets,
}: TicketCollectionOverviewProps) {
  return (
    <section className="ticket-collection" aria-labelledby="ticket-collection-title">
      <header className="ticket-collection__header">
        <p className="ticket-kicker">{collectionLabel}</p>
        <h1 id="ticket-collection-title">Your tickets</h1>
        <p>Choose the ticket you are presenting. Only one QR opens at a time.</p>
      </header>

      <ol className="ticket-collection__list">
        {tickets.map((ticket) => (
          <li key={ticket.selector}>
            <Link
              aria-label={`Ticket ${ticket.position}, ${ticket.admissionLabel}, ${statusLabels[ticket.status]}`}
              className={`ticket-card ticket-card--${ticket.status}`}
              to={ticketHref(ticket.selector)}
            >
              <div className="ticket-card__number" aria-hidden="true">
                <span>{String(ticket.position).padStart(2, '0')}</span>
                <small>of {ticket.totalInCollection}</small>
              </div>
              <div className="ticket-card__copy">
                <p>{ticket.eventName}</p>
                <strong>{ticket.admissionLabel}</strong>
                <span className={`ticket-status ticket-status--${ticket.status}`}>
                  {statusLabels[ticket.status]}
                </span>
              </div>
              <span className="ticket-card__arrow" aria-hidden="true">→</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
