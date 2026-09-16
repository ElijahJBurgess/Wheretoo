import { ReadState } from '../../components/ui/ReadState'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { z } from 'zod'
import { useSession } from '../auth/SessionProvider'
import { ResendTicketsDialog } from '../ticket-delivery/ResendTicketsDialog'
import { OperationsError } from './OperationsUi'
import { dateTime, statusLabel } from './operations.format'
import { useFreeRegistration } from './freeOperations.queries'
export function OrganizerRegistrationDetailPage() {
  const { eventId = '', registrationId = '' } = useParams()
  const session = useSession()
  const ownerId = session.status === 'authenticated' ? session.user.id : ''
  if (!z.uuid().safeParse(eventId).success || !z.uuid().safeParse(registrationId).success) return <OperationsError title='Registration unavailable' retry={() => undefined} />
  return <RegistrationDetail key={`${ownerId}:${session.identityVersion ?? 0}:${eventId}:${registrationId}`} ownerId={ownerId} identityVersion={session.identityVersion ?? 0} eventId={eventId} registrationId={registrationId} />
}
function RegistrationDetail({ ownerId, identityVersion, eventId, registrationId }: { ownerId: string; identityVersion: number; eventId: string; registrationId: string }) {
  const [resendOpen, setResendOpen] = useState(false)
  const query = useFreeRegistration(ownerId, eventId, identityVersion, registrationId)
  if (!query.isFetchedAfterMount || query.isPending) return <ReadState headingAs='h1' paused={query.fetchStatus === 'paused'} status='loading' skeleton='detail-fields' title='Loading registration…' />
  if (query.isError || !query.data) return <OperationsError title='Registration unavailable' retry={() => void query.refetch()} />
  const registration = query.data
  return <section className='operations-page ops-detail'>
    <Link className='ops-back' to={`/organizer/events/${eventId}/registrations`}>← Registrations</Link>
    <p className='ops-detail-event'>{registration.eventName}</p><h1>Registration details</h1>
    <div className='ops-panel ops-order-summary'>
      <div className='ops-section-heading'><h2>{registration.registrantName}</h2><span className={`ops-badge ops-badge--${registration.status}`}>{statusLabel(registration.status)}</span></div>
      <p className='ops-muted'>{registration.registrantEmail}</p>
      <dl className='ops-order-facts'><div><dt>Registered</dt><dd>{dateTime(registration.createdAt)}</dd></div><div><dt>Admissions</dt><dd>{registration.quantity}</dd></div></dl>
    </div>
    <div className='ops-actions'><button className='ops-button ops-button--primary' onClick={() => setResendOpen(true)}>Resend tickets</button></div>
    <h2>Tickets</h2><div className='ops-ticket-list'>{registration.tickets.map(ticket => <article className='ops-panel ops-ticket' key={ticket.ticketId}>
      <div className='ops-section-heading'><h3>Ticket {ticket.position} of {registration.quantity}</h3><span className={`ops-badge ops-badge--${ticket.status}`}>{statusLabel(ticket.status)}</span></div><p>{ticket.admissionLabel}</p>{ticket.usedAt && <p className='ops-note'>Checked in · {dateTime(ticket.usedAt)}</p>}
      <Link className='ops-button' to={`/organizer/events/${eventId}/check-in/find/registrations/${registrationId}/${ticket.ticketId}`} aria-label={`Open Ticket ${ticket.position} of ${registration.quantity}`}>View check-in status</Link>
    </article>)}</div>
    {resendOpen && <ResendTicketsDialog ownerId={ownerId} eventId={eventId} sourceKind='free_registration' sourceId={registrationId} onClose={() => setResendOpen(false)} />}
  </section>
}
