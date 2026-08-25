import type { Organizer } from '../organizers/organizer.api'
import type { EventRow } from './event.types'

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

function validDate(value: string | null): Date | null {
  if (value === null) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function eventDate(event: EventRow): string {
  const start = validDate(event.starts_at)
  return start === null ? 'Date not added' : dateFormatter.format(start)
}

function eventTime(event: EventRow): string {
  const start = validDate(event.starts_at)
  const end = validDate(event.ends_at)
  if (start === null || end === null) return 'Time not added'
  return `${timeFormatter.format(start)}–${timeFormatter.format(end)}`
}

function fullAddress(event: EventRow): string {
  const street = [event.address_line1, event.address_line2].filter(Boolean).join(', ')
  const cityRegion = [event.city, event.region].filter(Boolean).join(', ')
  const locality = [cityRegion, event.postal_code].filter(Boolean).join(' ')
  return [street, locality].filter(Boolean).join(', ') || 'Address not added'
}

type EventSummaryProps = {
  event: EventRow
  organizer: Organizer
}

export function EventSummary({ event, organizer }: EventSummaryProps) {
  const title = event.title?.trim() || 'Untitled event'
  const description = event.description?.trim() || 'Description not added'
  const category = event.category ? (categoryLabels[event.category] ?? 'Other') : 'Category not added'
  const venue = event.venue_name?.trim() || 'Venue not added'

  return (
    <article className="event-summary">
      <div aria-label="Whereto event artwork placeholder" className="event-summary__artwork" role="img">
        <span>Whereto presents</span>
        <strong>{title}</strong>
        <small>Event artwork coming soon</small>
      </div>
      <div className="event-summary__content">
        <header className="event-summary__header">
          <p className="organizer-eyebrow">Persisted event preview</p>
          <h1>{title}</h1>
          <p>Hosted by {organizer.display_name}</p>
        </header>
        <dl className="event-summary__facts">
          <div><dt>Date</dt><dd>{eventDate(event)}</dd></div>
          <div><dt>Time</dt><dd>{eventTime(event)}</dd></div>
          <div><dt>Timezone</dt><dd>Pacific time (America/Los_Angeles)</dd></div>
          <div><dt>Category</dt><dd>{category}</dd></div>
          <div><dt>Admission</dt><dd>{event.admission_type === 'free' ? 'Free' : 'Paid'}</dd></div>
          <div><dt>Venue</dt><dd>{venue}</dd></div>
          <div className="event-summary__wide"><dt>Address</dt><dd>{fullAddress(event)}</dd></div>
        </dl>
        <section aria-labelledby="event-summary-description" className="event-summary__description">
          <h2 id="event-summary-description">About this event</h2>
          <p>{description}</p>
        </section>
      </div>
    </article>
  )
}
