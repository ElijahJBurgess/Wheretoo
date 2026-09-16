import { RefundSupportContext } from '../../refunds/RefundedTicketContext'
import { formatBuyerSchedule } from '../../buyer-journey/format'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { TicketDisplay } from '../contracts/ticketCollection'
import type { WalletCapability } from '../contracts/wallet'
import { AdmissionQr } from './AdmissionQr'
import { InactiveTicketArtwork } from './InactiveTicketArtwork'
import { BuyerEventSummary, BuyerHeader, BuyerIcon } from '../../buyer-journey/BuyerPrimitives'

export type FocusedTicketViewProps = {
  backAction?: ReactNode
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

  const endsAt = (ticket.endsAt === null ? NaN : Date.parse(ticket.endsAt))
  if (!Number.isFinite(endsAt)) return 'unavailable'
  return now().getTime() >= endsAt ? 'ended' : 'valid'
}

export function FocusedTicketView({
  ticket,
  backAction,
  now,
  previousSelector,
  nextSelector,
  onSelect,
  focusHeadingOnMount = false,
  onHeadingFocused,
}: FocusedTicketViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [clockRevision, setClockRevision] = useState(0)
  useEffect(() => {
    const remaining = (ticket.endsAt === null ? NaN : Date.parse(ticket.endsAt)) - now().getTime()
    if (ticket.status !== 'valid' || !Number.isFinite(remaining) || remaining <= 0) return
    const timer = window.setTimeout(() => setClockRevision(value => value + 1), Math.min(remaining + 1, 2_147_483_647))
    return () => window.clearTimeout(timer)
  }, [ticket.endsAt, ticket.status, now, clockRevision])
  const status = presentationStatus(ticket, now)
  const presentation = statusPresentation[status]
  const isMultiTicket = ticket.totalInCollection > 1

  useLayoutEffect(() => {
    if (!focusHeadingOnMount) return
    headingRef.current?.focus()
    onHeadingFocused?.()
  }, [focusHeadingOnMount, onHeadingFocused])

  return (
    <article className={`buyer-focused buyer-focused--${status}`}>
      <BuyerHeader back={backAction ?? (isMultiTicket
        ? <button className="buyer-icon-button" aria-label="Back to all tickets" onClick={() => onSelect(null)} type="button"><BuyerIcon name="close" /></button>
        : <a className="buyer-icon-button" aria-label="Return to event" href={`/events/${encodeURIComponent(ticket.eventId)}`}><BuyerIcon name="close" /></a>)} />
      <div className="buyer-content">
        <header className="buyer-focused__heading">
          {status === 'valid' ? <BuyerIcon name="ticket" className="buyer-focused__ticket-icon" /> : <span aria-hidden="true" className="buyer-focused__status-icon">{presentation.icon}</span>}
          <h1 className={status === 'valid' ? 'buyer-visually-hidden' : ''} ref={headingRef} tabIndex={-1}>{status === 'valid' ? `Ticket ${ticket.position}` : presentation.label}</h1>
          {status !== 'valid' ? <p>{presentation.detail}</p> : null}
        </header>
        <section className="buyer-focused__admission" aria-label="Admission credential">
          {status === 'valid' && ticket.status === 'valid' ? <AdmissionQr credential={ticket.admissionCredential} /> : <InactiveTicketArtwork />}
        </section>
        <div className="buyer-focused__type">
          <strong>{ticket.admissionLabel}</strong>
          <p aria-live="polite" role="status">{status !== 'valid' ? <span className="buyer-visually-hidden">{presentation.label}. </span> : null}Ticket {ticket.position} of {ticket.totalInCollection}</p>
          {ticket.attendeeLabel ? <p>{ticket.attendeeLabel}</p> : null}
          {ticket.usedAt ? <p>Checked in · {new Date(ticket.usedAt).toLocaleString('en-US', { timeZone: ticket.timezone ?? 'UTC', timeZoneName: 'short' })}</p> : null}
        </div>
        {ticket.eventStatus === 'cancelled' ? <p role="status">Event cancelled. Prior check-ins remain recorded.</p> : ticket.eventUpdated ? <p role="status">Event updated. Review the latest published details below.</p> : null}
        {ticket.eventFactsAvailable === false ? <p>Previous published event details are unavailable.</p> : null}
        <BuyerEventSummary title={ticket.eventName} schedule={formatBuyerSchedule(ticket.startsAt, ticket.endsAt, ticket.timezone)} venue={ticket.venueName} />
        {status === 'refunded' ? <RefundSupportContext /> : null}
        {status === 'valid' ? <div className="buyer-focused__valid"><span><BuyerIcon name="check" />Valid ticket</span><p>{presentation.detail}</p></div> : null}
        {ticket.directionsUrl ? <a className="ui-button buyer-secondary" href={ticket.directionsUrl} rel="noreferrer">Get directions</a> : null}
        {isMultiTicket ? <footer className="buyer-focused__navigation">
          <button className="buyer-nav-button" disabled={previousSelector === null} onClick={() => onSelect(previousSelector)} type="button"><BuyerIcon name="back" /><span>Previous ticket</span></button>
          <button className="buyer-nav-button" disabled={nextSelector === null} onClick={() => onSelect(nextSelector)} type="button"><BuyerIcon name="arrow" /><span>Next ticket</span></button>
        </footer> : null}
      </div>
    </article>
  )
}
