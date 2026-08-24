import type { EventFormValues } from './event.types'

type EventReviewStepProps = { values: EventFormValues }

function display(value: string): string { return value.trim() || 'Not added yet' }

export function EventReviewStep({ values }: EventReviewStepProps) {
  const address = values.location
    ? `${values.location.addressLine1}, ${values.location.city}, ${values.location.region} ${values.location.postalCode}`
    : 'No verified address selected'
  return (
    <div className="event-step">
      <header className="event-step__header">
        <p className="organizer-eyebrow">Stage 3</p>
        <h2>Review the run sheet</h2>
        <p>This is your working draft. Preview will always use the version saved in Whereto.</p>
      </header>
      <dl className="event-review">
        <div><dt>Event</dt><dd>{display(values.title)}</dd></div>
        <div><dt>Category</dt><dd>{display(values.category.replace('_', ' '))}</dd></div>
        <div><dt>Starts</dt><dd>{display(values.startsAt)} · Los Angeles time</dd></div>
        <div><dt>Ends</dt><dd>{display(values.endsAt)} · Los Angeles time</dd></div>
        <div><dt>Venue</dt><dd>{display(values.venueName)}</dd></div>
        <div><dt>Address</dt><dd>{address}</dd></div>
        <div><dt>Admission</dt><dd>{values.admissionType === 'free' ? 'Free' : 'Paid'}</dd></div>
      </dl>
      {values.admissionType === 'paid' ? (
        <p className="event-review__notice" role="status">Paid event publishing is not available in this milestone. Choose Free before publishing.</p>
      ) : null}
    </div>
  )
}
