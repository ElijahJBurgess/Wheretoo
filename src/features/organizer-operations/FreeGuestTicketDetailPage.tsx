import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { z } from 'zod'
import { AdmissionResultView } from '../ticket-experience/scanner/OrganizerScannerView'
import { useCheckInContext } from './CheckInContext'
import { ManualAdmissionDialog } from './ManualAdmissionDialog'
import { isOperationsAccessDenied } from './operations.errors'
import { dateTime } from './operations.format'
import { useFreeRegistration } from './freeOperations.queries'
import { isFreeEventAdmissionOpen } from './freeOperations.schemas'

export function FreeGuestTicketDetailPage() {
  const { registrationId = '', ticketId = '' } = useParams()
  const context = useCheckInContext()
  if (!z.uuid().safeParse(registrationId).success || !z.uuid().safeParse(ticketId).success || context.sourceKind !== 'free_registration') {
    return <section className='find-guest'><h1>Invalid ticket selection</h1><Link className='ops-button' to='../..' relative='path'>Back to search</Link></section>
  }
  return <FreeTicketDetails key={`${context.ownerId}:${context.identityVersion}:${context.eventId}:${registrationId}:${ticketId}`} registrationId={registrationId} ticketId={ticketId} />
}

function FreeTicketDetails({ registrationId, ticketId }: { registrationId: string; ticketId: string }) {
  const { ownerId, identityVersion, eventId, event } = useCheckInContext()
  const query = useFreeRegistration(ownerId, eventId, identityVersion, registrationId)
  const [confirm, setConfirm] = useState(false)
  const base = `/organizer/events/${eventId}/check-in`
  const navigation = <div className='find-guest__actions'><Link className='ops-button ops-button--primary' to={`${base}/scan`}>Return to scanner</Link><Link className='ops-button' to={`${base}/find`}>Find another guest</Link></div>
  if (query.isPending || !query.isFetchedAfterMount) return <p role='status'>Loading guest…</p>
  if (!query.data || (query.isError && isOperationsAccessDenied(query.error))) {
    return <section className='find-guest' role='alert'><h1>Guest unavailable</h1><p>Your access and selected registration could not be confirmed.</p><Link className='ops-button' to={`${base}/find`}>Back to search</Link></section>
  }
  const registration = query.data
  const ticket = registration.tickets.find(value => value.ticketId === ticketId)
  if (!ticket) {
    return <section className='find-guest'><AdmissionResultView source='manual' timeZone={event.timezone} result={{ outcome: 'invalid' }}>{navigation}</AdmissionResultView></section>
  }
  const canAdmit = !query.isError && registration.status === 'confirmed' && ticket.status === 'valid' && isFreeEventAdmissionOpen(event)
  if (!confirm && !query.isError && ticket.status !== 'valid') {
    return <section className='find-guest'><Link className='ops-back' to={`${base}/find`}>← Back to search</Link><AdmissionResultView source='manual' timeZone={event.timezone} result={{ outcome: ticket.status === 'used' ? 'already_used' : 'cancelled', attendeeLabel: registration.registrantName, admissionLabel: ticket.admissionLabel, ...(ticket.usedAt ? { usedAt: ticket.usedAt } : {}) }}>{navigation}</AdmissionResultView></section>
  }
  return <section className='find-guest'>
    <Link className='ops-back' to={`${base}/find`}>← Back to search</Link>
    <h1>Guest Details</h1>
    <h2>{registration.registrantName}</h2>
    <p>{registration.registrantEmail}</p>
    <p className='ops-note'>Free registration · Ticket {ticket.position} of {registration.quantity}</p>
    <dl className='find-guest__facts'>
      <div><dt>Ticket type</dt><dd>{ticket.admissionLabel}</dd></div>
      <div><dt>Event</dt><dd>{event.title}</dd></div>
      <div><dt>Registration</dt><dd>{registrationId.slice(-8)}</dd></div>
      <div><dt>Ticket status</dt><dd><span className={`ops-badge ops-badge--${ticket.status}`}>{ticket.status === 'valid' ? 'Valid' : ticket.status}</span></dd></div>
      {ticket.usedAt && <div><dt>Original check-in</dt><dd>{dateTime(ticket.usedAt, event.timezone)}</dd></div>}
    </dl>
    {query.isError && <p role='alert'>Ticket status could not refresh. Check-in is unavailable until confirmed. <button className='ops-button' onClick={() => void query.refetch()}>Refresh ticket</button></p>}
    {canAdmit && <button className='ops-button ops-button--primary' onClick={() => setConfirm(true)}>Check in guest</button>}
    {!confirm && ticket.status === 'valid' && !canAdmit && <p role='alert'>Check-in closed. This ticket cannot currently be admitted.</p>}
    {confirm && <ManualAdmissionDialog
      ownerId={ownerId}
      identityVersion={identityVersion}
      eventId={eventId}
      orderId={registrationId}
      sourceKind='free_registration'
      timeZone={event.timezone}
      buyerName={registration.registrantName}
      eventName={event.title ?? registration.eventName}
      ticketNumber={ticket.position}
      ticket={{ id: ticket.ticketId, admissionLabel: ticket.admissionLabel, status: ticket.status, usedAt: ticket.usedAt }}
      canAdmit={canAdmit}
      onClose={() => setConfirm(false)}
      journey
      resultActions={navigation}
    />}
  </section>
}
