import { Link } from 'react-router-dom'
import type { EventFormValues } from './event.types'

type EventReviewStepProps = { eventId?: string; values: EventFormValues }

export function EventReviewStep({ eventId, values }: EventReviewStepProps) {
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
      {values.admissionType === 'paid' ? (
        <p className="event-review__notice" role="status">
          Paid events need ticket tiers and payment setup before sales can begin.{' '}
          {eventId ? <Link to={`/organizer/events/${eventId}/tickets`}>Set up paid tickets</Link> : 'Save this draft, then set up paid tickets.'}
        </p>
      ) : null}
    </div>
  )
}
