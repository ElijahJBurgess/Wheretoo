import { useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AsyncState } from '../../components/ui/AsyncState'
import { Button } from '../../components/ui/Button'
import { ReportEventDialog } from '../moderation/ReportEventDialog'
import { encodeCheckoutCart, MAX_CHECKOUT_QUANTITY } from '../checkout/checkout.cart'
import { TicketTierList } from './TicketTierList'
import { isRetryablePublicTicketingError } from './publicTicketing.errors'
import { usePublicTicketingEvent } from './publicTicketing.queries'
import type { CanonicalPublicTicketingEvent, PublicTicketTierTuple } from './ticket.types'

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  hour: 'numeric',
  minute: '2-digit',
})

const categoryLabels: Record<string, string> = {
  food_drink: 'Food & drink',
  music: 'Music',
  fitness: 'Fitness',
  art_culture: 'Art & culture',
  shopping: 'Shopping',
  community: 'Community',
  nightlife: 'Nightlife',
  other: 'Other',
}

function formatDateAndTime(startsAt: string, endsAt: string): { date: string; time: string } {
  const start = new Date(startsAt)
  const end = new Date(endsAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { date: 'Date unavailable', time: 'Time unavailable' }
  }

  const startDate = dateFormatter.format(start)
  const endDate = dateFormatter.format(end)

  return {
    date: startDate === endDate ? startDate : `${startDate} – ${endDate}`,
    time: `${timeFormatter.format(start)}–${timeFormatter.format(end)} PT`,
  }
}

function formatAddress(event: {
  address_line1: string
  address_line2: string | null
  city: string
  region: 'CA'
  postal_code: string
}): string {
  const street = [event.address_line1, event.address_line2].filter(Boolean).join(', ')
  return `${street}, ${event.city}, ${event.region} ${event.postal_code}`
}

type PublicEventStateProps = {
  action?: ReactNode
  description?: string
  status: 'loading' | 'empty' | 'error'
  title: string
}

function PublicEventState({ action, description, status, title }: PublicEventStateProps) {
  return (
    <main className="public-event-layout">
      <h1 className="public-event-state__title">{title}</h1>
      <AsyncState action={action} description={description} status={status} title={title} />
    </main>
  )
}

type PublicTicketPurchaseProps = {
  eventId: string
  tiers: PublicTicketTierTuple
}

function PublicTicketPurchase({ eventId, tiers }: PublicTicketPurchaseProps) {
  const navigate = useNavigate()
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const availabilityKey = tiers.map((tier) => `${tier.id}:${tier.availability_status}`).join('|')
  const [previousAvailabilityKey, setPreviousAvailabilityKey] = useState(availabilityKey)
  if (previousAvailabilityKey !== availabilityKey) {
    setPreviousAvailabilityKey(availabilityKey)
    setQuantities((current) => {
      const availableIds = new Set(tiers.filter((tier) => tier.availability_status === 'available').map((tier) => tier.id))
      const next = Object.fromEntries(Object.entries(current).filter(([tierId]) => availableIds.has(tierId)))
      return Object.keys(current).length === Object.keys(next).length ? current : next
    })
  }

  const items = tiers
    .filter((tier) => tier.availability_status === 'available')
    .flatMap((tier) => {
      const quantity = quantities[tier.id] ?? 0
      return Number.isSafeInteger(quantity) && quantity > 0 ? [{ tierId: tier.id, quantity }] : []
    })
  const hasInvalidQuantity = tiers.some((tier) => {
    const quantity = quantities[tier.id] ?? 0
    return tier.availability_status === 'available' &&
      (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > MAX_CHECKOUT_QUANTITY)
  })
  const total = items.reduce((sum, item) => sum + item.quantity, 0)
  const validCart = !hasInvalidQuantity && items.length > 0 && total <= MAX_CHECKOUT_QUANTITY &&
    items.every((item) => item.quantity <= MAX_CHECKOUT_QUANTITY)
  const hasAvailableTier = tiers.some((tier) => tier.availability_status === 'available')

  function changeQuantity(tierId: string, quantity: number) {
    setQuantities((current) => ({ ...current, [tierId]: quantity }))
  }

  function continueToCheckout() {
    if (!validCart) return
    navigate({
      pathname: `/events/${eventId}/checkout`,
      search: `?${encodeCheckoutCart(items)}`,
    })
  }

  return (
    <section aria-labelledby="public-event-tickets" className="public-event__tickets">
      <div>
        <p className="public-event__eyebrow">Tickets</p>
        <h2 id="public-event-tickets">Choose your tickets</h2>
      </div>
      <TicketTierList
        maxTotal={MAX_CHECKOUT_QUANTITY}
        onQuantityChange={changeQuantity}
        quantities={quantities}
        tiers={tiers}
      />
      {hasAvailableTier ? null : <p className="public-event__unavailable">Tickets are currently unavailable</p>}
      <Button disabled={!validCart} onClick={continueToCheckout}>Continue to checkout</Button>
    </section>
  )
}

export function PublicTicketEventPage() {
  const { eventId = '' } = useParams()
  const eventQuery = usePublicTicketingEvent(eventId)
  const hasRetryableStaleEvent = eventQuery.isError
    && eventQuery.data !== undefined
    && eventQuery.data !== null
    && isRetryablePublicTicketingError(eventQuery.error)

  if ((eventQuery.isPending || eventQuery.data === undefined) && !eventQuery.isError) {
    return <PublicEventState status="loading" title="Loading event" />
  }
  if (eventQuery.isError && !hasRetryableStaleEvent) {
    return <PublicEventState action={<Button onClick={() => void eventQuery.refetch()}>Try again</Button>} description="Check your connection, then try again." status="error" title="Event could not load" />
  }
  if (eventQuery.data === null) {
    return <PublicEventState description="This event may no longer be available." status="empty" title="Event not found" />
  }

  const publicEvent = eventQuery.data
  const { event } = publicEvent
  const paidPublicEvent = publicEvent.event.admission_type === 'paid'
    ? publicEvent as Extract<CanonicalPublicTicketingEvent, { event: { admission_type: 'paid' } }>
    : null
  const dateAndTime = formatDateAndTime(event.starts_at, event.ends_at)

  return (
    <main className="public-event-layout">
      {hasRetryableStaleEvent ? (
        <div className="public-event-refresh" role="status">
          <p>Showing the last event details we received. We could not check current availability.</p>
          <Button onClick={() => void eventQuery.refetch()} variant="secondary">Check again</Button>
        </div>
      ) : null}
      <article aria-labelledby="public-event-title" className="public-event">
        <div aria-label="Whereto event artwork placeholder" className="public-event__artwork" role="img">
          <span>Whereto presents</span>
          <strong>{event.title}</strong>
          <small>{categoryLabels[event.category]}</small>
        </div>
        <div className="public-event__content">
          <header className="public-event__header">
            <p className="public-event__eyebrow">Public event</p>
            <h1 id="public-event-title">{event.title}</h1>
            <p>Hosted by {event.organizer.display_name}</p>
          </header>
          <dl className="public-event__facts">
            <div><dt>Date</dt><dd>{dateAndTime.date}</dd></div>
            <div><dt>Time</dt><dd>{dateAndTime.time}</dd></div>
            <div><dt>Venue</dt><dd>{event.venue_name ?? 'Venue to be announced'}</dd></div>
            <div><dt>Location</dt><dd>{formatAddress(event)}</dd></div>
          </dl>
          <section aria-labelledby="public-event-about" className="public-event__description">
            <h2 id="public-event-about">About this event</h2>
            <p>{event.description}</p>
          </section>
          {paidPublicEvent !== null ? (
            <PublicTicketPurchase
              eventId={event.id}
              tiers={paidPublicEvent.tiers}
            />
          ) : (
            <section aria-labelledby="public-event-admission" className="public-event__tickets">
              <p className="public-event__eyebrow">Admission</p>
              <h2 id="public-event-admission">Free event</h2>
              <p>No ticket purchase is required.</p>
            </section>
          )}
          {!hasRetryableStaleEvent ? <ReportEventDialog eventId={event.id} /> : null}
        </div>
      </article>
    </main>
  )
}
