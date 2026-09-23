import { EventExportControl } from './EventExportControl'
import { useOwnedEvent } from '../events/event.queries'
import { isOperationsAccessDenied } from './operations.errors'
import { ReadState } from '../../components/ui/ReadState'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useSession } from '../auth/SessionProvider'
import { dateTime, statusLabel } from './operations.format'
import { useFreeAdmissions } from './freeOperations.queries'
import '../ticket-delivery/ticket-delivery.css'
export function OrganizerRegistrationLookup() {
  const { eventId = '' } = useParams()
  const session = useSession()
  const ownerId = session.status === 'authenticated' ? session.user.id : ''
  return <RegistrationLookup key={`${ownerId}:${session.identityVersion ?? 0}:${eventId}`} ownerId={ownerId} identityVersion={session.identityVersion ?? 0} eventId={eventId} />
}
function RegistrationLookup({ ownerId, identityVersion, eventId }: { ownerId: string; identityVersion: number; eventId: string }) {
  const event = useOwnedEvent(eventId, ownerId, { revalidateOnMount: true })
  const verifiedEvent = event.isFetchedAfterMount && !event.isError ? event.data : undefined
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const query = useFreeAdmissions(ownerId, eventId, identityVersion, search)
  const failedRead = query.isError && (!query.isFetchNextPageError || isOperationsAccessDenied(query.error))
  const registrations = query.isFetchedAfterMount && !failedRead ? [...new Map(query.data?.pages.flatMap(page => page.admissions).map(row => [row.registrationId, row])).values()] : []
  return <section className='operations-page'>
    <Link className='ops-back' to={`/organizer/events/${eventId}/dashboard`}>← Event dashboard</Link>
    <h1>Find a registration</h1><p className='ops-muted'>Find a free RSVP to view its tickets or resend access to the recorded email.</p>
    {verifiedEvent?.admission_type === 'free' && <EventExportControl eventId={eventId} source='free' eventStatus={verifiedEvent.status} />}
    <form className='registration-search' onSubmit={event => { event.preventDefault(); setSearch(draft.trim()) }}>
      <label htmlFor='registration-search'>Name or email</label><input id='registration-search' maxLength={320} value={draft} onChange={event => setDraft(event.target.value)} />
      <button className='ops-button ops-button--primary' disabled={!draft.trim()}>Find registration</button>
    </form>
    {!search && <p className='ops-note'>Enter a guest’s name or complete email address.</p>}
    {search && (query.isPending || !query.isFetchedAfterMount) && <ReadState status='loading' paused={query.fetchStatus === 'paused'} skeleton='order-rows' title='Finding registrations…' />}
    {search && failedRead && <ReadState status='unavailable' title='Search unavailable' description='Registrations could not load. Check your connection and organizer access.' action={<button className='ops-button' onClick={() => void query.refetch()}>Try again</button>} />}
    {search && query.isFetchedAfterMount && !query.isError && query.data && !registrations.length && <ReadState status='empty' title='No matching registrations' description='Try another name or email address.' action={<button className='ops-button' onClick={() => { setDraft(''); setSearch(''); document.getElementById('registration-search')?.focus() }}>Clear search</button>} />}
    <ul className='registration-results'>{registrations.map(row => <li key={row.registrationId}><Link className='ops-panel' to={`/organizer/events/${eventId}/registrations/${row.registrationId}`}>
      <strong>{row.registrantName}</strong><span>{row.registrantEmail}</span><span className='ops-muted'>{row.ticketTotal} admissions · {statusLabel(row.registrationStatus)} · {dateTime(row.createdAt)}</span>
    </Link></li>)}</ul>
    {search && query.isFetchNextPageError && !failedRead && <ReadState status='unavailable' title='More registrations could not load' description='Showing the loaded results. Open a registration to confirm its current status.' />}
    {query.hasNextPage && !failedRead && <button className='ops-button' disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? 'Loading…' : query.isFetchNextPageError ? 'Retry loading registrations' : 'Load more registrations'}</button>}
  </section>
}
