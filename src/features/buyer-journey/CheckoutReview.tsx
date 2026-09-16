import { formatBuyerMoney, formatBuyerSchedule } from './format'
import type { ReactNode } from 'react'
import { BuyerEventSummary, BuyerHeader, BuyerIcon, BuyerProgress } from './BuyerPrimitives'
import type { PublicTicketingEvent } from '../tickets/ticket.types'

export function CheckoutReview({ event, lines, totalMinor, back, editSelection, children }: {
  event: PublicTicketingEvent['event']
  lines: readonly { name: string; quantity: number; unitAmountMinor: number }[]
  totalMinor: number
  back: ReactNode
  editSelection: ReactNode
  children: ReactNode
}) {
  const artwork = event.artwork_path && /^(https?:|data:|blob:)/i.test(event.artwork_path) ? event.artwork_path : null
  return <main className="buyer-page buyer-checkout">
    <BuyerHeader back={back} />
    <BuyerProgress step={2} />
    <h1 className="buyer-visually-hidden">Review your tickets</h1>
    <div className="buyer-content">
      <BuyerEventSummary title={event.title} organizer={event.organizer.display_name} artwork={artwork}
        schedule={formatBuyerSchedule(event.starts_at, event.ends_at, event.timezone)} venue={event.venue_name ?? 'Venue to be announced'} location={`${event.city}, ${event.region}`} />
      <section aria-label="Ticket summary" className="buyer-section">
        <div className="buyer-section-heading"><h2>Your tickets</h2>{editSelection}</div>
        <ul className="buyer-checkout-lines">{lines.map((line, index) => <li key={`${line.name}-${index}`}>
          <BuyerIcon name="ticket" className="buyer-ticket-icon" /><div><strong>{line.name}</strong><span><span>{line.quantity} {line.quantity === 1 ? 'ticket' : 'tickets'}</span> · {formatBuyerMoney(line.unitAmountMinor)} each</span></div>
          <b>{formatBuyerMoney(line.unitAmountMinor * line.quantity)}</b>
        </li>)}</ul>
      </section>
      {children}
      <section className="buyer-section buyer-payment" aria-labelledby="buyer-payment-heading">
        <div className="buyer-section-heading"><h2 id="buyer-payment-heading">Payment</h2><span><BuyerIcon name="lock" /> Secure & encrypted</span></div>
        <div className="buyer-payment__surface"><BuyerIcon name="lock" /><div><strong>Secure checkout with Stripe</strong><p>Choose your payment method and complete your purchase on Stripe.</p></div></div>
      </section>
      <section aria-labelledby="buyer-order-summary" className="buyer-section buyer-order-summary">
        <h2 id="buyer-order-summary">Order summary</h2>
        <dl><div><dt>Total</dt><dd>{formatBuyerMoney(totalMinor)}</dd></div></dl>
      </section>
    </div>
  </main>
}
