import { useOrganizer } from '../organizers/organizer.queries'
import { useOwnedTicketTiers } from '../tickets/ticket.queries'
import type { EventRow } from './event.types'
import { useEventCoverState } from '../event-images/eventImages.queries'
import './eventSchedule.css'
export function EventCompositionSummary({ event }: { event: EventRow }) {
  const organizer = useOrganizer(event.organizer_id)
  const cover = useEventCoverState(event.id)
  const image = cover.data?.images.find(image => image.position === 1)
  const tiers = useOwnedTicketTiers(event.organizer_id, event.admission_type === 'paid' ? event.id : '')
  const retained = tiers.data?.filter(tier => tier.status !== 'archived')
  return <section className="event-composition" aria-label="Event summary">
    {image ? <img className="event-composition__image" src={image.url} alt="Event image" /> : null}
    {cover.isError ? <p>Image preview unavailable. <button type="button" onClick={() => void cover.refetch()}>Retry image</button></p> : null}
    <div><h2>{event.title}</h2><p>{event.description}</p></div>
    <dl className="event-review">
    <div><dt>Organizer</dt><dd>{organizer.data?.display_name ?? (organizer.isError ? 'Organizer details unavailable' : 'Loading organizer…')}</dd></div>
    <div><dt>Category</dt><dd>{event.category?.replaceAll('_', ' & ') ?? 'Not selected'}</dd></div>
    <div><dt>When</dt><dd>{event.starts_at ? new Intl.DateTimeFormat('en-US', { dateStyle:'medium', timeStyle:'short', timeZone:'America/Los_Angeles' }).format(new Date(event.starts_at)) : 'Date not added'}</dd></div>
    <div><dt>Ends</dt><dd>{event.ends_at ? new Intl.DateTimeFormat('en-US', { dateStyle:'medium', timeStyle:'short', timeZone:'America/Los_Angeles' }).format(new Date(event.ends_at)) : 'End not added'} · Pacific Time</dd></div>
    <div><dt>Where</dt><dd>{event.venue_name}<br />{[event.address_line1,event.city,event.region].filter(Boolean).join(', ')}</dd></div>
    <div><dt>Admission</dt><dd>{event.admission_type === 'paid' ? retained ? `${retained.length} ticket ${retained.length === 1 ? 'tier' : 'tiers'}` : tiers.isError ? 'Ticket details unavailable' : 'Loading tickets…' : 'Free RSVP'}</dd></div>
  </dl></section>
}
