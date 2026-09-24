import { EventExportControl } from './EventExportControl'
import { ReadState } from '../../components/ui/ReadState'
import { Link, useParams } from 'react-router-dom'
import { useSession } from '../auth/SessionProvider'
import { useOwnedEvent } from '../events/event.queries'
import { organizerEventStatus } from '../events/organizerEventPresentation'
import { usePublicEvent } from '../moderation/moderation.queries'
import { useOperationsMetrics } from './operations.queries'
import { EventHero, OperationsError } from './OperationsUi'
import { money } from './operations.format'
import { isFreeEventAdmissionOpen } from './freeOperations.schemas'
import type { EventRow } from '../events/event.types'
import type { EventMetrics } from './operations.schemas'
import type { FreeRegistrationMetrics } from './freeOperations.schemas'
export function OrganizerDashboardPage() {
  const { eventId = '' } = useParams()
  const session = useSession()
  const ownerId = session.status === 'authenticated' ? session.user.id : ''
  const eventQuery = useOwnedEvent(eventId, ownerId, { revalidateOnMount: true })
  const publicEventQuery = usePublicEvent(eventId)
  if (
    eventQuery.isPending || eventQuery.isFetchedAfterMount === false ||
    session.status !== 'authenticated'
  ) {
    return <ReadState headingAs='h1' paused={eventQuery.fetchStatus === 'paused'} status='loading' skeleton='metrics' title='Loading event dashboard…' />
  }
  if (eventQuery.isError || !eventQuery.data) {
    return (
      <OperationsError
        title='Event unavailable'
        retry={() => void eventQuery.refetch()}
      />
    )
  }
  return <DashboardContent key={`${ownerId}:${session.identityVersion ?? 0}:${eventId}:${eventQuery.data.admission_type}`} ownerId={ownerId} identityVersion={session.identityVersion ?? 0} event={eventQuery.data} publicEventQuery={publicEventQuery} />
}

function DashboardContent({ ownerId, identityVersion, event, publicEventQuery }: {
  ownerId: string
  identityVersion: number
  event: EventRow
  publicEventQuery: ReturnType<typeof usePublicEvent>
}) {
  const eventId = event.id
  const sourceKind = event.admission_type === 'free' ? 'free_registration' : 'paid_order'
  const metricsQuery = useOperationsMetrics(ownerId, eventId, sourceKind, identityVersion)
  if (metricsQuery.isPending) return <ReadState headingAs='h1' paused={metricsQuery.fetchStatus === 'paused'} status='loading' skeleton='metrics' title='Loading event dashboard…' />
  if (metricsQuery.isError || !metricsQuery.data) {
    return <OperationsError title={sourceKind === 'free_registration' ? 'Registration metrics unavailable' : 'Event metrics unavailable'} retry={() => void metricsQuery.refetch()} />
  }
  const data = metricsQuery.data
  const checkingPublicAvailability = publicEventQuery.isPending || publicEventQuery.isFetching
  const publicEligibilityConfirmed = !checkingPublicAvailability && !publicEventQuery.isError &&
    publicEventQuery.data?.id === eventId && organizerEventStatus(event).label === 'Live'
  const admissionEligible = sourceKind === 'free_registration'
    ? isFreeEventAdmissionOpen(event)
    : (data as EventMetrics).admissionEligible
  return (
    <section className='operations-page'>
      <Link className='ops-back' to='/organizer/events'>← My Events</Link>
      <EventHero metrics={sourceKind === 'paid_order' ? data as EventMetrics : undefined} event={event} />
      <div className='ops-actions'>
        {event.admission_type === 'free' && <Link className='ops-button' to={`/organizer/events/${eventId}/registrations`}>Find registration / resend tickets</Link>}
        {admissionEligible
          ? (
            <Link
              className='ops-button ops-button--primary'
              to={`/organizer/events/${eventId}/check-in`}
            >
              Check in guests
            </Link>
          )
          : <button className='ops-button' disabled>Check-in closed</button>}
        {publicEligibilityConfirmed && (
          <Link className='ops-button' to={`/events/${eventId}`}>View event</Link>
        )}
        {event.status !== 'cancelled' ? <Link className='ops-button' to={`/organizer/events/${eventId}/edit`}>Edit event</Link> : null}
        {event.admission_type === 'paid' && <Link className='ops-button' to={`/organizer/events/${eventId}/waitlist`}>Waitlist</Link>}
        <Link className='ops-button' to={`/organizer/events/${eventId}/changes`}>Changes and notices</Link>
        <Link className='ops-button' to={`/organizer/events/${eventId}/cancellation`}>Cancellation status</Link>
      </div>
      <EventExportControl eventId={eventId} source={event.admission_type === 'free' ? 'free' : 'paid'} eventStatus={event.status} />
      {!admissionEligible && (
        <p className='ops-action-note'>
          Check-in is closed for this event. New admissions are unavailable based on the current
          event status.
        </p>
      )}
      {checkingPublicAvailability
        ? <p className='ops-public-state' role='status'>Checking public availability…</p>
        : publicEventQuery.isError
          ? (
            <div className='ops-public-state ops-public-state--error' role='alert'>
              <span>Public availability could not be confirmed.</span>
              <button type='button' onClick={() => void publicEventQuery.refetch()}>
                Check public availability again
              </button>
            </div>
          )
          : !publicEligibilityConfirmed && (
            <p className='ops-public-state'>This event is not currently publicly available.</p>
          )}
      {sourceKind === 'free_registration' ? <FreeMetrics data={data as FreeRegistrationMetrics} /> : <PaidMetrics eventId={eventId} data={data as EventMetrics} />}
    </section>
  )
}

function FreeMetrics({ data }: { data: FreeRegistrationMetrics }) {
  return <>
      <dl className='ops-metrics'>
        <div><dd>{data.registrationCount.toLocaleString()}</dd><dt>Registrations</dt></div>
        <div><dd>{data.reservedAdmissions.toLocaleString()} / {data.capacity?.toLocaleString() ?? 'Unlimited'}</dd><dt>Reserved admissions</dt></div>
        <div><dd>{data.confirmedRegistrations.toLocaleString()}</dd><dt>Confirmed registrations</dt></div>
        <div><dd>{data.checkedIn.toLocaleString()} / {data.issued.toLocaleString()}</dd><dt>Checked in</dt></div>
      </dl>
      <p className='ops-note'>{data.remaining === null ? 'This event has unlimited RSVP capacity.' : `${data.remaining.toLocaleString()} admissions remaining.`}</p>
    </>
}

function PaidMetrics({ data, eventId }: { data: EventMetrics; eventId: string }) {
  return <>
      <dl className='ops-metrics'>
        <div>
          <dd>{money(data.grossSalesMinor)}</dd>
          <dt>Gross ticket sales</dt>
        </div>
        <div>
          <dd>{data.sold.toLocaleString()} / {data.capacity?.toLocaleString() ?? '—'}</dd>
          <dt>Tickets sold</dt>
        </div>
        <div>
          <dd>{data.orderCount.toLocaleString()}</dd>
          <dt>Orders</dt>
        </div>
        <div>
          <dd>{data.checkedIn.toLocaleString()} / {data.issued.toLocaleString()}</dd>
          <dt>Checked in</dt>
        </div>
      </dl>
      <p className='ops-note'>
        Historical performance includes refunded purchases. Check-in is used tickets / all issued
        tickets.
      </p>
      <div className='ops-section-heading'>
        <h2>Ticket breakdown</h2>
        <Link to={`/organizer/events/${eventId}/orders`}>View orders</Link>
      </div>
      <div className='ops-panel'>
        {data.tiers.length
          ? data.tiers.map((tier) => (
            <div className='ops-tier' key={tier.id}>
              <div>
                <h3>
                  {tier.name}
                  {tier.status !== 'active' && <span className='ops-muted'>· {tier.status}</span>}
                </h3>
                <p>{tier.sold} sold · {tier.remaining} remaining</p>
              </div>
              <strong>{money(tier.grossSalesMinor)}</strong>
            </div>
          ))
          : <p className='operations-state'>No ticket tiers configured.</p>}
      </div>
      <p className='ops-note'>
        Remaining inventory includes active checkout reservations. Cancelled events cannot sell returned inventory.
      </p>
    </>
}
