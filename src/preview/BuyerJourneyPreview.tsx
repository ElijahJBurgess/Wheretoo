import { formatBuyerMoney } from '../features/buyer-journey/format'
import { createContext, useContext, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { BuyerIcon } from '../features/buyer-journey/BuyerPrimitives'
import { EventPageView } from '../features/buyer-journey/EventPageView'
import { CheckoutReview } from '../features/buyer-journey/CheckoutReview'
import { OrderConfirmationView } from '../features/buyer-journey/OrderConfirmationView'
import { TicketSelectionPreviewPage } from '../features/tickets/TicketSelectionPreviewPage'
import { TicketCollectionOverview } from '../features/ticket-experience/customer/TicketCollectionOverview'
import { FocusedTicketView } from '../features/ticket-experience/customer/FocusedTicketView'
import type { TicketDisplay } from '../features/ticket-experience/contracts/ticketCollection'
import type { OrderConfirmation } from '../features/orders/order.types'
import { publicEvent } from './fixtures'
import artwork from './assets/rooftop-reference.png'

const previewTiers = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'General Admission', unitAmountMinor: 2500 },
  { id: '00000000-0000-4000-8000-000000000002', name: 'VIP', unitAmountMinor: 6000 },
]
const defaultQuantities = { [previewTiers[0]!.id]: 2, [previewTiers[1]!.id]: 1 }
const PreviewCart = createContext<{ quantities: Readonly<Record<string, number>>; update(value: Readonly<Record<string, number>>): void } | null>(null)

export function BuyerPreviewProvider({ children }: { children: ReactNode }) {
  const [quantities, update] = useState<Readonly<Record<string, number>>>(defaultQuantities)
  return <PreviewCart value={{ quantities, update }}>{children}</PreviewCart>
}

const previewEvent = { ...publicEvent.event, artwork_path: new URL(artwork, window.location.origin).href }
const back = (slug: string, label = 'Back') => <Link className="buyer-icon-button" aria-label={label} to={slug ? `/preview/${slug}` : '/preview'}><BuyerIcon name="back" /></Link>

export function BuyerJourneyPreview({ slug }: { slug: string }) {
  const navigate = useNavigate()
  const cart = useContext(PreviewCart)
  if (!cart) throw new Error('Buyer preview requires its isolated cart provider')
  const { quantities, update } = cart
  const [search, setSearch] = useSearchParams()
  const parsedIndex = Number(search.get('ticket') ?? 1) - 1
  const requestedIndex = Number.isSafeInteger(parsedIndex) && parsedIndex >= 0 ? parsedIndex : 0
  const lines = previewTiers.flatMap(tier => (quantities[tier.id] ?? 0) > 0 ? [{ ...tier, quantity: quantities[tier.id]! }] : [])
  const totalMinor = lines.reduce((sum, line) => sum + line.quantity * line.unitAmountMinor, 0)
  const order: OrderConfirmation = {
    orderNumber: 'PREVIEW-0001', status: 'paid', currency: 'usd', subtotalMinor: totalMinor, taxAmountMinor: 0, totalMinor,
    quantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    items: lines.map(line => ({ tierName: line.name, quantity: line.quantity, unitAmountMinor: line.unitAmountMinor, subtotalMinor: line.unitAmountMinor * line.quantity, currency: 'usd' })),
    event: { title: previewEvent.title, startsAt: previewEvent.starts_at, endsAt: previewEvent.ends_at, timezone: previewEvent.timezone, venueName: previewEvent.venue_name },
  }
  const tickets: TicketDisplay[] = lines.flatMap(line => Array.from({ length: line.quantity }, () => line)).map((line, index) => ({
    selector: `preview-ticket-${index + 1}`, eventId: previewEvent.id, eventName: previewEvent.title,
    startsAt: previewEvent.starts_at, endsAt: previewEvent.ends_at, venueName: previewEvent.venue_name!,
    admissionLabel: line.name, position: index + 1, totalInCollection: order.quantity,
    status: 'valid', admissionCredential: `WHERETOO PREVIEW ONLY - NOT VALID FOR ENTRY - ${index + 1}`,
  }))

  const focusedIndex = requestedIndex < tickets.length ? requestedIndex : 0

  if (slug === 'event-page') return <EventPageView title={previewEvent.title} organizer={previewEvent.organizer.display_name}
    date="Sat Sep 19 · 7:00 PM" venue={previewEvent.venue_name!} location="Oakland, CA" description={previewEvent.description}
    artwork={artwork} back={back('', 'Screen hub')} action={<Link className="ui-button buyer-primary" to="/preview/ticket-selection">Get tickets<BuyerIcon name="arrow" /></Link>} />
  if (slug === 'ticket-selection') return <TicketSelectionPreviewPage artwork={artwork} initialQuantities={quantities} back={back('event-page', 'Return to event')} onContinue={value => { update(value); navigate('/preview/checkout') }} />
  if (slug === 'checkout') return <CheckoutReview event={previewEvent} lines={lines} totalMinor={totalMinor} back={back('ticket-selection')} editSelection={<Link to="/preview/ticket-selection">Edit selection</Link>}>
    <form className="buyer-checkout-form" onSubmit={event => { event.preventDefault(); navigate('/preview/confirmation') }}>
      <section className="buyer-details"><h2>Buyer details</h2><div className="buyer-details__fields">
        <label className="ui-field">Your name<input autoComplete="off" placeholder="Full name" /></label>
        <label className="ui-field">Email address<input autoComplete="off" placeholder="you@example.com" type="email" /></label>
      </div></section>
      <button className="ui-button buyer-primary" type="submit">Preview confirmation<BuyerIcon name="arrow" /></button>
    </form>
  </CheckoutReview>
  if (slug === 'confirmation') return <OrderConfirmationView order={order} ticketAction={<Link className="ui-button buyer-primary" to="/preview/ticket-wallet">View tickets<BuyerIcon name="arrow" /></Link>} />
  if (slug === 'ticket-wallet') return <main className="buyer-page"><TicketCollectionOverview eventHref="/preview/event-page" collectionLabel={`${previewEvent.title} tickets`} tickets={tickets} ticketHref={selector => `/preview/qr-ticket?ticket=${tickets.findIndex(ticket => ticket.selector === selector) + 1}`} /></main>
  const status = slug === 'used-ticket' ? 'used' : slug === 'refunded-ticket' ? 'refunded' : slug === 'cancelled-ticket' ? 'cancelled' : 'valid'
  const focused = tickets[focusedIndex] ?? tickets[0]!
  const ticket: TicketDisplay = status === 'valid' ? focused : { ...focused, status, admissionCredential: null }
  return <main className="buyer-page"><FocusedTicketView backAction={back('ticket-wallet', 'Back to all tickets')} ticket={ticket} now={() => new Date('2026-09-18T12:00:00Z')} walletCapability={{ kind: 'unavailable', label: 'Add to Wallet — Coming later' }}
    previousSelector={focusedIndex > 0 ? tickets[focusedIndex - 1]!.selector : null} nextSelector={tickets[focusedIndex + 1]?.selector ?? null}
    onSelect={selector => { if (selector === null) navigate('/preview/ticket-wallet'); else setSearch({ ticket: String(tickets.findIndex(item => item.selector === selector) + 1) }) }} />
    <span className="buyer-visually-hidden">Preview order total {formatBuyerMoney(totalMinor)}</span>
  </main>
}
