import { useState } from 'react'
import { EventSalesSummary } from '../organizer-operations/EventSalesSummary'
import { EventArtwork } from '../organizer-operations/EventArtwork'
import { Link } from 'react-router-dom'
import { ReadState } from '../../components/ui/ReadState'
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
  if (event.status === 'draft') return `/organizer/events/${event.id}/edit?resume=1`
  if (event.admission_type === 'paid') return `/organizer/events/${event.id}/dashboard`
  return `/organizer/events/${event.id}`
}

function organizerEventStatus(event: EventRow): { label: string; style: string } {
  if (event.status === 'cancelled') return { label: 'Cancelled', style: 'cancelled' }
  if (event.status === 'draft') return { label: 'Draft', style: 'draft' }
  if (event.moderation_status === 'blocked') return { label: 'Blocked', style: 'blocked' }
  if (event.moderation_status === 'removed') return { label: 'Removed', style: 'removed' }
  if (
    event.moderation_status === 'under_review' ||
    event.moderation_status === 'not_evaluated' ||
    event.moderated_revision !== event.content_revision
  ) {
    return { label: 'Under review', style: 'under-review' }
  }
  if (event.admission_type === 'paid' && event.ends_at && Date.parse(event.ends_at) <= Date.now()) {
    return { label: 'Ended', style: 'draft' }
  }
  return { label: event.admission_type === 'paid' ? 'Live' : 'Published', style: 'published' }
}

export function OrganizerEventsPage() {
  const [filter, setFilter] = useState('All')
  const [visible, setVisible] = useState(12)
  const sessionState = useSession()
  const organizerId = sessionState.status === 'authenticated' ? sessionState.user.id : ''
  const eventsQuery = useOwnedEvents(organizerId)

  if (eventsQuery.isPending || sessionState.status !== 'authenticated') {
    return <ReadState headingAs="h1" paused={eventsQuery.fetchStatus === 'paused'} status='loading' skeleton='event-cards' title='Loading your events' />
  }

  if (eventsQuery.isError || !Array.isArray(eventsQuery.data)) {
    return (
      <ReadState headingAs="h1"
        action={<Button onClick={() => void eventsQuery.refetch()}>Try again</Button>}
        description='Check your connection, then try again.'
        status='error'
        title='Your events could not load'
      />
    )
  }

  if (eventsQuery.data.length === 0) {
    return (
      <ReadState headingAs="h1"
        action={
          <Link className='ui-button ui-button--primary' to='/organizer/events/new'>
            Create your first event
          </Link>
        }
        description='Start with the details you know. You can save a draft before publishing.'
        status='empty'
        title='No events yet'
      />
    )
  }

  return (
    <section aria-labelledby='organizer-events-title' className='events-index'>
      <div className='events-index__header'>
        <div>
          <p className='organizer-eyebrow'>Organizer console</p>
          <h1 id='organizer-events-title'>My Events</h1>
          <p>Manage your events and track performance.</p>
        </div>
        <Link className='ui-button ui-button--primary' to='/organizer/events/new'>
          Create event
        </Link>
      </div>
      <div className='ops-event-filters' aria-label='Event status'>
        {['All', 'Live', 'Draft', 'Ended', 'Cancelled'].map((label) => (
          <button
            type='button'
            className='ops-button'
            aria-pressed={filter === label}
            key={label}
            onClick={() => {
              setFilter(label)
              setVisible(12)
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <ul className='event-list'>
        {eventsQuery.data.filter((event) =>
          filter === 'All' || organizerEventStatus(event).label === filter
        ).slice(0, visible).map((event) => {
          const title = event.title?.trim() || 'Untitled event'
          const status = organizerEventStatus(event)
          return (
            <li className='event-list__item' key={event.id}>
              <Link
                className={event.admission_type === 'paid' ? 'ops-event-row' : undefined}
                aria-label={`${title}, ${status.label}`}
                to={eventDestination(event)}
              >
                {event.admission_type === 'paid' && (
                  <EventArtwork source={event.artwork_path} className='ops-event-art' />
                )}
                <span className={`event-status event-status--${status.style}`}>{status.label}</span>
                <strong>{title}</strong>
                <span className='event-list__dates'>
                  {event.starts_at ? <span>Starts {formatInstant(event.starts_at)}</span> : null}
                  <span>Updated {formatInstant(event.updated_at)}</span>
                </span>
                {event.admission_type === 'paid' && (
                  <>
                    <span className='ops-event-venue'>
                      {[event.venue_name, event.city].filter(Boolean).join(' · ') ||
                        'Venue to be confirmed'}
                    </span>
                    <EventSalesSummary ownerId={organizerId} eventId={event.id} />
                  </>
                )}
                <span aria-hidden='true' className='event-list__arrow'>→</span>
              </Link>
            </li>
          )
        })}
      </ul>
      {eventsQuery.data.filter((event) =>
            filter === 'All' || organizerEventStatus(event).label === filter
          ).length === 0 && <ReadState status='empty' title='No matching events' description='Try another event status.' action={<Button onClick={() => { setFilter('All'); setVisible(12) }}>Clear filter</Button>} />}
      {eventsQuery.data.filter((event) =>
            filter === 'All' || organizerEventStatus(event).label === filter
          ).length > visible && (
        <button
          className='ops-button'
          onClick={() => setVisible((value) => value + 12)}
        >
          Show more events
        </button>
      )}
    </section>
  )
}
