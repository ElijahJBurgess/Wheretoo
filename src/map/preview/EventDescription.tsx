import { usePublicTicketingEvent } from '../../features/tickets/publicTicketing.queries'

export function EventDescription({ eventId }: { eventId: string }) {
  const eventQuery = usePublicTicketingEvent(eventId)
  const description = eventQuery.data?.event.description.trim()

  return <section className="event-invitation__description" aria-label="About this event">
    <h3>About this event</h3>
    {eventQuery.isPending ? <p role="status">Loading description…</p>
      : eventQuery.isError ? <div className="event-invitation__description-error">
        <p>Description could not load.</p>
        <button type="button" onClick={() => void eventQuery.refetch()}>Retry description</button>
      </div>
        : <p>{description || 'No description available.'}</p>}
  </section>
}
