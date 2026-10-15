import { Link } from 'react-router-dom'
import type { EventFormValues } from './event.types'
import { MapIconSummary } from '../map-icons/MapIconSummary'

type EventReviewStepProps = { eventId?: string; organizerId?: string; values: EventFormValues }

export function EventReviewStep({ eventId, organizerId, values }: EventReviewStepProps) {
  return (
    <div className="event-step">
      <header className="event-step__header">
        <p className="organizer-eyebrow">Stage 3</p>
        <h2>Tickets and admission</h2>
        <p>Confirm how people will attend. Paid events can manage up to three ticket tiers after the event is saved.</p>
      </header>
      <dl className="event-review">
        <div><dt>Admission</dt><dd>{values.admissionType === 'free' ? 'Free' : 'Paid'}</dd></div>
        <div><dt>Capacity</dt><dd>{values.capacity === null ? 'No capacity added' : values.capacity}</dd></div>
      </dl>
      {organizerId ? <MapIconSummary organizerId={organizerId} eventId={eventId} value={values.mapIconVersionId ?? null} /> : null}
      {values.admissionType === 'paid' ? (
        <p className="event-review__notice" role="status">
          Paid events need ticket tiers and payment setup before sales can begin.{' '}
          {eventId ? <Link to={`/organizer/events/${eventId}/tickets`}>Set up paid tickets</Link> : 'Save this draft, then set up paid tickets.'}
        </p>
      ) : null}
    </div>
  )
}
