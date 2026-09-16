import { Link } from 'react-router-dom'
import { useCheckInContext } from './CheckInContext'
import { useOperationsMetrics } from './operations.queries'
import { EventArtwork } from './EventArtwork'
import { dateTime } from './operations.format'
import { isFreeEventAdmissionOpen } from './freeOperations.schemas'
import type { EventMetrics } from './operations.schemas'
export function CheckInHomePage() {
  const { ownerId, identityVersion, eventId, event, sourceKind } = useCheckInContext()
  const metrics = useOperationsMetrics(ownerId, eventId, sourceKind, identityVersion)
  const available = metrics.isSuccess && !metrics.isError
  const data = available ? metrics.data : undefined
  return (
    <section className='find-guest check-in-home'>
      <Link className='ops-back' to={`/organizer/events/${eventId}/dashboard`}>
        ← Event dashboard
      </Link>
      <div className='check-in-home__hero'>
        <EventArtwork source={event.artwork_path} className='check-in-home__art' eager />
        <h1>{event.title}</h1>
      </div>
      <p>{dateTime(event.starts_at, event.timezone)}</p>
      <p>{[event.venue_name, event.city].filter(Boolean).join(' · ')}</p>
      {data
        ? (
          <div className='check-in-home__progress'>
            <progress
              aria-label='Guests checked in'
              max={Math.max(1, data.issued)}
              value={data.checkedIn}
            />
            <p>
              {data.checkedIn} / {data.issued} checked in{' '}
              <span>{data.issued ? Math.round(100 * data.checkedIn / data.issued) : 0}%</span>
            </p>
          </div>
        )
        : (
          <div role={metrics.isError ? 'alert' : 'status'}>
            <p>{metrics.isError ? 'Check-in count unavailable' : 'Loading check-in count…'}</p>
            {metrics.isError && (
              <button
                className='ops-button'
                onClick={() => void metrics.refetch()}
              >
                Refresh count
              </button>
            )}
          </div>
        )}
      {data && (sourceKind === 'free_registration' ? isFreeEventAdmissionOpen(event) : (data as EventMetrics).admissionEligible)
        ? <Link className='ops-button ops-button--primary' to='scan'>Scan QR</Link>
        : (
          <p role='status'>
            {data
              ? 'Check-in closed. Event history remains available.'
              : 'Confirming admission availability…'}
          </p>
        )}
      <Link className='ops-button' to='find'>Find guest manually</Link>
    </section>
  )
}
