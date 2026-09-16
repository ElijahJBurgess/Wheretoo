import { useOrganizer } from '../organizers/organizer.queries'
import { useOwnedTicketTiers } from '../tickets/ticket.queries'
import type { EventRow } from './event.types'
export function EventCompositionSummary({ event }: { event: EventRow }) {
  const organizer = useOrganizer(event.organizer_id)
  const tiers = useOwnedTicketTiers(event.organizer_id, event.admission_type === 'paid' ? event.id : '')
  const retained = tiers.data?.filter(tier => tier.status !== 'archived')
  return <dl className="event-review">
    <div><dt>Organizer</dt><dd>{organizer.data?.display_name ?? (organizer.isError ? 'Organizer details unavailable' : 'Loading organizer…')}</dd></div>
    <div><dt>Category</dt><dd>{event.category?.replaceAll('_', ' & ') ?? 'Not selected'}</dd></div>
    <div><dt>When</dt><dd>{event.starts_at ? new Intl.DateTimeFormat('en-US', { dateStyle:'medium', timeStyle:'short', timeZone:'America/Los_Angeles' }).format(new Date(event.starts_at)) : 'Date not added'}</dd></div>
    <div><dt>Where</dt><dd>{event.venue_name}<br />{[event.address_line1,event.city,event.region].filter(Boolean).join(', ')}</dd></div>
    <div><dt>Admission</dt><dd>{event.admission_type === 'paid' ? retained ? `${retained.length} ticket ${retained.length === 1 ? 'tier' : 'tiers'}` : tiers.isError ? 'Ticket details unavailable' : 'Loading tickets…' : 'Free RSVP'}</dd></div>
  </dl>
}
