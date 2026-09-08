import { useLayoutEffect, useRef } from 'react'
import type { TicketDisplay } from '../contracts/ticketCollection'
import type { WalletCapability } from '../contracts/wallet'
import { AdmissionQr } from './AdmissionQr'

export type FocusedTicketViewProps = {
  ticket: TicketDisplay
  walletCapability: WalletCapability
  now: () => Date
  previousSelector: string | null
  nextSelector: string | null
  onSelect(selector: string | null): void
  focusHeadingOnMount?: boolean
  onHeadingFocused?(): void
}

type PresentationStatus = 'valid' | 'used' | 'refunded' | 'cancelled' | 'ended' | 'unavailable'

const statusPresentation: Record<PresentationStatus, { icon: string; label: string; detail: string }> = {
  valid: { icon: '✓', label: 'Valid', detail: 'Present this QR at the door.' },
  used: { icon: '✓', label: 'Already used', detail: 'This ticket has already been checked in.' },
  refunded: { icon: '↺', label: 'Refunded', detail: 'This ticket is no longer valid for admission.' },
  cancelled: { icon: '×', label: 'Cancelled', detail: 'This ticket is no longer valid for admission.' },
  ended: { icon: '—', label: 'Event ended', detail: 'This event has ended and the ticket is no longer scannable.' },
  unavailable: { icon: '!', label: 'Ticket unavailable', detail: 'This ticket cannot be presented for admission.' },
}

function presentationStatus(ticket: TicketDisplay, now: () => Date): PresentationStatus {
  if (ticket.status !== 'valid') return ticket.status

  const endsAt = Date.parse(ticket.endsAt)
  if (!Number.isFinite(endsAt)) return 'unavailable'
  return now().getTime() >= endsAt ? 'ended' : 'valid'
}

function formatEventTime(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt)
  const end = new Date(endsAt)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return 'Schedule unavailable'

  const date = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${date.format(start)} · ${time.format(start)}–${time.format(end)}`
}

export function FocusedTicketView({
  ticket,
  walletCapability,
  now,
  previousSelector,
  nextSelector,
  onSelect,
  focusHeadingOnMount = false,
  onHeadingFocused,
}: FocusedTicketViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const status = presentationStatus(ticket, now)
  const presentation = statusPresentation[status]
  const isMultiTicket = ticket.totalInCollection > 1

  useLayoutEffect(() => {
    if (!focusHeadingOnMount) return
    headingRef.current?.focus()
    onHeadingFocused?.()
  }, [focusHeadingOnMount, onHeadingFocused])

  return (
    <article className={`focused-ticket focused-ticket--${status}`}>
      <header className="focused-ticket__header">
        <div>
          <p className="ticket-kicker">{ticket.eventName}</p>
          <h1 ref={headingRef} tabIndex={-1}>Ticket {ticket.position}</h1>
        </div>
        <span className={`ticket-status ticket-status--${status}`}>
          <span aria-hidden="true">{presentation.icon}</span>
          {presentation.label}
        </span>
      </header>

      <section className="focused-ticket__admission" aria-label="Admission credential">
        {status === 'valid' && ticket.status === 'valid'
          ? <AdmissionQr credential={ticket.admissionCredential} />
          : (
            <div className="focused-ticket__inactive" role="status">
              <span aria-hidden="true">{presentation.icon}</span>
              <strong>{presentation.label}</strong>
              <p>{presentation.detail}</p>
            </div>
          )}
        {status === 'valid' ? <p className="focused-ticket__scan-note">{presentation.detail}</p> : null}
      </section>

      <dl className="focused-ticket__facts">
        <div><dt>Admission</dt><dd>{ticket.admissionLabel}</dd></div>
        {ticket.attendeeLabel ? <div><dt>Guest</dt><dd>{ticket.attendeeLabel}</dd></div> : null}
        <div><dt>When</dt><dd>{formatEventTime(ticket.startsAt, ticket.endsAt)}</dd></div>
        <div><dt>Where</dt><dd>{ticket.venueName}</dd></div>
      </dl>

      <div className="focused-ticket__actions">
        {ticket.directionsUrl
          ? <a className="ui-button ui-button--secondary" href={ticket.directionsUrl} rel="noreferrer">Get directions</a>
          : null}
        <button className="ui-button ui-button--secondary" disabled type="button">
          {walletCapability.label}
        </button>
      </div>

      {isMultiTicket ? (
        <footer className="focused-ticket__navigation">
          <p aria-live="polite" role="status">Ticket {ticket.position} of {ticket.totalInCollection}</p>
          <div>
            <button
              className="ui-button ui-button--secondary"
              disabled={previousSelector === null}
              onClick={() => onSelect(previousSelector)}
              type="button"
            >
              Previous ticket
            </button>
            <button
              className="ui-button ui-button--primary"
              disabled={nextSelector === null}
              onClick={() => onSelect(nextSelector)}
              type="button"
            >
              Next ticket
            </button>
          </div>
        </footer>
      ) : null}
    </article>
  )
}
