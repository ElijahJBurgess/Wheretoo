import { Link, Navigate, useParams } from 'react-router-dom'
import { AsyncState } from '../../components/ui/AsyncState'
import { Button } from '../../components/ui/Button'
import { useSession } from '../auth/SessionProvider'
import { useOrganizer } from '../organizers/organizer.queries'
import { useOwnedEvent } from './event.queries'
import { EventSummary } from './EventSummary'

const publishedAtFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function formatPublishedAt(value: string | null): string {
  if (value === null) return 'Publication time unavailable'
  const instant = new Date(value)
  return Number.isNaN(instant.getTime())
    ? 'Publication time unavailable'
    : `Published ${publishedAtFormatter.format(instant)}`
}

export function PublishedEventPage() {
  const { eventId = '' } = useParams()
  const sessionState = useSession()
  const authenticatedOrganizerId = sessionState.status === 'authenticated' ? sessionState.user.id : ''
  const eventQuery = useOwnedEvent(eventId, authenticatedOrganizerId)
  const persistedOrganizerId = eventQuery.data?.organizer_id ?? ''
  const organizerQuery = useOrganizer(persistedOrganizerId)

  if (
    sessionState.status !== 'authenticated' ||
    ((eventQuery.isPending || eventQuery.data === undefined) && !eventQuery.isError)
  ) {
    return <AsyncState status="loading" title="Loading published event" />
  }
  if (eventQuery.isError) {
    return <AsyncState action={<Button onClick={() => void eventQuery.refetch()}>Try again</Button>} description="Check your connection, then try again." status="error" title="Published event could not load" />
  }
  const event = eventQuery.data
  if (event === null) {
    return <AsyncState action={<Link className="ui-button ui-button--secondary" to="/organizer/events">Back to events</Link>} description="The event may no longer be available." status="empty" title="Event not found" />
  }
  if (event.status === 'draft') {
    return <Navigate replace to={`/organizer/events/${event.id}/edit`} />
  }
  if ((organizerQuery.isPending || organizerQuery.data === undefined) && !organizerQuery.isError) {
    return <AsyncState status="loading" title="Loading organizer details" />
  }
  if (organizerQuery.isError) {
    return <AsyncState action={<Button onClick={() => void organizerQuery.refetch()}>Try again</Button>} description="Check your connection, then try again." status="error" title="Organizer details could not load" />
  }
  const organizer = organizerQuery.data
  if (organizer === null) {
    return <AsyncState action={<Link className="ui-button ui-button--secondary" to="/organizer/events">Back to events</Link>} description="The organizer profile may no longer be available." status="empty" title="Organizer details unavailable" />
  }

  const isPublished = event.status === 'published'
  const isPublic = isPublished && (event.moderation_status === 'clear' || event.moderation_status === 'flagged')
  const operational = event.moderation_status === 'blocked'
    ? { label: 'Blocked', copy: 'This event is blocked from public discovery.' }
    : event.moderation_status === 'removed'
      ? { label: 'Removed', copy: 'This event has been removed from public discovery.' }
      : null
  const heading = isPublished ? 'Published' : event.status === 'cancelled' ? 'Cancelled' : 'Event unavailable'
  const canSetUpPaidTickets = isPublic && event.admission_type === 'free'

  return (
    <section aria-labelledby="published-event-title" className="published-event">
      <header className="published-event__status">
        <div>
          <p className="organizer-eyebrow">Event status</p>
          <h1 id="published-event-title">{heading}</h1>
          {isPublished ? <p>{formatPublishedAt(event.published_at)}</p> : null}
        </div>
        {operational ? <strong className="event-operational-state">{operational.label}</strong> : null}
      </header>
      <div aria-live="polite" className={`published-event__notice${isPublic ? ' published-event__notice--public' : ''}`}>
        {isPublic
          ? <p>This event is publicly available.</p>
          : operational
            ? <p>{operational.copy}</p>
            : <p>This event is not publicly available.</p>}
      </div>
      <EventSummary event={event} organizer={organizer} />
      <footer className="published-event__actions">
        {canSetUpPaidTickets ? <Link className="ui-button ui-button--primary" to={`/organizer/events/${event.id}/tickets`}>Set up paid tickets</Link> : null}
        <Link className="ui-button ui-button--secondary" to="/organizer/events">Back to events</Link>
      </footer>
    </section>
  )
}
