import type { Organizer } from '../organizers/organizer.api'
import type { TicketTierRow } from '../tickets/ticket.types'
import type { EventRow } from './event.types'

function formatInstant(value: string | null) {
  if (!value || Number.isNaN(Date.parse(value))) return 'Time not added'
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function EventPublishConfirmation({ event, organizer, tiers }: { event: EventRow; organizer: Organizer; tiers: TicketTierRow[] }) {
  const activeTiers = tiers.filter((tier) => event.status === 'draft' ? tier.status !== 'archived' : tier.status === 'active')
  const capacity = event.admission_type === 'paid' ? activeTiers.reduce((sum, tier) => sum + tier.quantity_total, 0) : event.capacity
  return <div className="creation-confirmation">
    {event.artwork_path && /^https?:\/\//i.test(event.artwork_path) ? <img alt={`${event.title ?? 'Event'} artwork`} className="creation-preview__artwork" src={event.artwork_path} /> : null}
    <h2>{event.title}</h2>
    <p>Hosted by {organizer.display_name}</p>
    <p>{formatInstant(event.starts_at)} – {formatInstant(event.ends_at)} · Pacific time</p>
    <p>{[event.venue_name, event.address_line1, event.address_line2, event.city, event.region, event.postal_code].filter(Boolean).join(', ')}</p>
    <dl className="creation-confirmation__facts">
      <div><dt>Admission type</dt><dd>{event.admission_type === 'paid' ? 'Paid Tickets' : 'Free RSVP'}</dd></div>
      {event.admission_type === 'paid' ? <div><dt>Ticket tiers</dt><dd>{activeTiers.length}</dd></div> : null}
      <div><dt>Capacity</dt><dd>{capacity ?? 'Not specified'}</dd></div>
    </dl>
    <p>Review your saved event before submitting it for publication. Public availability depends on review.</p>
  </div>
}
