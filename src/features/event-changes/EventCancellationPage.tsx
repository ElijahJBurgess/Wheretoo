import { Link, useParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { ReadState } from '../../components/ui/ReadState'
import { Button } from '../../components/ui/Button'
import { useSession } from '../auth/SessionProvider'
import { useOwnedEvent } from '../events/event.queries'
import { CancellationPanel } from './CancellationPanel'
import { CancellationSummary } from './CancellationSummary'
import { EventNoticePanel } from './EventNoticePanel'
import './event-changes.css'
export function ConfirmedEventCancellation({ eventId, ownerId }: { eventId: string; ownerId: string }) {
 const statusRef = useRef<HTMLParagraphElement>(null)
 useEffect(() => { statusRef.current?.focus() }, [])
 return <section className="event-changes"><header><p className="organizer-eyebrow">Event status</p><h1>Event cancelled</h1><p ref={statusRef} tabIndex={-1} role="status">Cancellation confirmed. Unused admissions are stopped. Used admissions retain their check-in history. Payments have not been automatically refunded; email has not been automatically sent.</p></header><CancellationSummary eventId={eventId} ownerId={ownerId} /><EventNoticePanel key={eventId} eventId={eventId} ownerId={ownerId} purpose="event_cancellation" /><Link to="/organizer/events">Back to events</Link></section>
}
export function EventCancellationPage() {
 const { eventId = '' } = useParams()
 const session = useSession()
 const ownerId = session.status === 'authenticated' ? session.user.id : ''
 return <CancellationRoute key={`${ownerId}:${eventId}`} eventId={eventId} ownerId={ownerId} />
}
function CancellationRoute({ eventId, ownerId }: { eventId: string; ownerId: string }) {
 const query = useOwnedEvent(eventId, ownerId, { revalidateOnMount: true })
 const [confirmed, setConfirmed] = useState(false)
 const [hasVerifiedPublished, setHasVerifiedPublished] = useState(false)
 const fresh = query.isFetchedAfterMount && !query.isFetching && !query.isError
 const event = fresh && query.data?.id === eventId && query.data.organizer_id === ownerId ? query.data : null
 const canCancel = event?.status === 'published'
 const eligibilityRevision = `${query.dataUpdatedAt}:${query.errorUpdatedAt}:${query.fetchStatus}`
 // Keep an existing operation mounted through refresh failures. This flag only preserves
 // recovery UI; a fresh read or the domain's reconciliation must authorize cancellation.
 if (canCancel && !hasVerifiedPublished) setHasVerifiedPublished(true)
 if (confirmed || event?.status === 'cancelled') return <ConfirmedEventCancellation eventId={eventId} ownerId={ownerId} />
 const loading = !query.isError && (query.isPending || !query.isFetchedAfterMount || query.isFetching)
 return <section className="event-changes">
  {event ? <><h1>Cancellation</h1><p>{event.title ?? 'Untitled event'}</p>{event.status !== 'published' && <p>This event is not published.</p>}</>
   : loading ? <ReadState headingAs="h1" paused={query.fetchStatus === 'paused'} status="loading" skeleton="detail-fields" title="Loading event status" />
   : <ReadState headingAs="h1" status="unavailable" title="Cancellation status unavailable" description="Current event details and eligibility could not be confirmed." action={<Button onClick={() => void query.refetch()}>Check event status</Button>} />}
  {hasVerifiedPublished && <CancellationPanel canCancel={canCancel} eligibilityRevision={eligibilityRevision} eventId={eventId} ownerId={ownerId} onConfirmed={() => setConfirmed(true)} />}
  <Link to="/organizer/events">Back to events</Link>
 </section>
}
