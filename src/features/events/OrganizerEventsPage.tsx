import { Link } from 'react-router-dom'
import { AsyncState } from '../../components/ui/AsyncState'
import { Button } from '../../components/ui/Button'
import { useSession } from '../auth/SessionProvider'
import { useOwnedEvents } from './event.queries'
import type { EventRow } from './event.types'

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Los_Angeles',
})

function formatInstant(value: string): string {
  const instant = new Date(value)
  return Number.isNaN(instant.getTime()) ? 'Date unavailable' : dateTimeFormatter.format(instant)
}

function eventDestination(event: EventRow): string {
  return event.status === 'draft'
    ? `/organizer/events/${event.id}/edit`
    : `/organizer/events/${event.id}`
}

function organizerEventStatus(event: EventRow): { label: string; style: string } {
  if (event.status === 'cancelled') return { label: 'Cancelled', style: 'cancelled' }
  if (event.status === 'draft') return { label: 'Draft', style: 'draft' }
  if (event.moderation_status === 'blocked') return { label: 'Blocked', style: 'blocked' }
  if (event.moderation_status === 'removed') return { label: 'Removed', style: 'removed' }
  if (event.moderation_status === 'under_review' || event.moderation_status === 'not_evaluated') {
    return { label: 'Under review', style: 'under-review' }
  }
  return { label: 'Published', style: 'published' }
}

export function OrganizerEventsPage() {
  const sessionState = useSession()
  const organizerId = sessionState.status === 'authenticated' ? sessionState.user.id : ''
  const eventsQuery = useOwnedEvents(organizerId)

  if (eventsQuery.isPending || sessionState.status !== 'authenticated') {
    return <AsyncState status="loading" title="Loading your events" />
  }

  if (eventsQuery.isError) {
    return (
      <AsyncState
        action={<Button onClick={() => void eventsQuery.refetch()}>Try again</Button>}
        description="Check your connection, then try again."
        status="error"
        title="Your events could not load"
      />
    )
  }

  if (!eventsQuery.data?.length) {
    return (
      <AsyncState
        action={<Link className="ui-button ui-button--primary" to="/organizer/events/new">Create event</Link>}
        description="Start with the details you know. You can save a draft before publishing."
        status="empty"
        title="No events yet"
      />
    )
  }

  return (
    <section aria-labelledby="organizer-events-title" className="events-index">
      <div className="events-index__header">
        <div>
          <p className="organizer-eyebrow">Organizer console</p>
          <h1 id="organizer-events-title">Your events</h1>
          <p>Draft, preview, and publish the places you are putting on.</p>
        </div>
        <Link className="ui-button ui-button--primary" to="/organizer/events/new">Create event</Link>
      </div>
      <ul className="event-list">
        {eventsQuery.data.map((event) => {
          const title = event.title?.trim() || 'Untitled event'
          const status = organizerEventStatus(event)
          return (
            <li className="event-list__item" key={event.id}>
              <Link aria-label={`${title}, ${status.label}`} to={eventDestination(event)}>
                <span className={`event-status event-status--${status.style}`}>{status.label}</span>
                <strong>{title}</strong>
                <span className="event-list__dates">
                  {event.starts_at ? <span>Starts {formatInstant(event.starts_at)}</span> : null}
                  <span>Updated {formatInstant(event.updated_at)}</span>
                </span>
                <span aria-hidden="true" className="event-list__arrow">→</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
