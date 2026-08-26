import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AsyncState } from '../../components/ui/AsyncState'
import { Button } from '../../components/ui/Button'
import { TicketTierList } from './TicketTierList'
import { usePublicTicketingEvent } from './publicTicketing.queries'

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

  return {
    date: dateFormatter.format(start),
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

export function PublicTicketEventPage() {
  const { eventId = '' } = useParams()
  const navigate = useNavigate()
  const eventQuery = usePublicTicketingEvent(eventId)
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null)

  if ((eventQuery.isPending || eventQuery.data === undefined) && !eventQuery.isError) {
    return <main className="public-event-layout"><AsyncState status="loading" title="Loading event" /></main>
  }
  if (eventQuery.isError) {
    return (
      <main className="public-event-layout">
        <AsyncState
          action={<Button onClick={() => void eventQuery.refetch()}>Try again</Button>}
          description="Check your connection, then try again."
          status="error"
          title="Event could not load"
        />
      </main>
    )
  }
  if (eventQuery.data === null) {
    return (
      <main className="public-event-layout">
        <AsyncState description="This event may no longer be available." status="empty" title="Event not found" />
      </main>
    )
  }

  const publicEvent = eventQuery.data
  const { event, tiers } = publicEvent
  const selectedTier = tiers.find(
    (tier) => tier.id === selectedTierId && tier.availability_status === 'available',
  ) ?? null
  const hasAvailableTier = tiers.some((tier) => tier.availability_status === 'available')
  const dateAndTime = formatDateAndTime(event.starts_at, event.ends_at)

  function continueToCheckout() {
    if (selectedTier === null) return
    navigate({
      pathname: `/events/${event.id}/checkout`,
      search: `?tier=${encodeURIComponent(selectedTier.id)}`,
    })
  }

  return (
    <main className="public-event-layout">
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
          <section aria-labelledby="public-event-tickets" className="public-event__tickets">
            <div>
              <p className="public-event__eyebrow">Tickets</p>
              <h2 id="public-event-tickets">Choose your ticket</h2>
            </div>
            <TicketTierList onSelect={setSelectedTierId} selectedTierId={selectedTierId} tiers={tiers} />
            {hasAvailableTier ? null : <p className="public-event__unavailable">Tickets are currently unavailable</p>}
            <Button disabled={selectedTier === null} onClick={continueToCheckout}>Continue to checkout</Button>
          </section>
        </div>
      </article>
    </main>
  )
}
