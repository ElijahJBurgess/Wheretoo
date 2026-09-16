import { useState } from 'react'
import type { Organizer } from '../organizers/organizer.api'
import type { TicketTierRow } from '../tickets/ticket.types'
import type { EventRow } from './event.types'
import { EventSummary } from './EventSummary'

export function EventAttendeePreview({ event, organizer, tiers }: { event: EventRow; organizer: Organizer; tiers: TicketTierRow[] }) {
  const [tab, setTab] = useState<'event' | 'tickets'>('event')
  return <div className="creation-preview">
    {event.admission_type === 'paid' ? <div aria-label="Preview views" className="creation-preview__tabs">
      <button aria-pressed={tab === 'event'} onClick={() => setTab('event')} type="button">Event Page</button>
      <button aria-pressed={tab === 'tickets'} onClick={() => setTab('tickets')} type="button">Ticket Selection</button>
    </div> : null}
    {tab === 'event' || event.admission_type !== 'paid' ? <>
      <EventSummary event={event} organizer={organizer} />
    </> : <section className="creation-preview__tickets" aria-label="Ticket selection preview">
      <h2>Choose your tickets</h2><p>Preview only. Tickets cannot be purchased or reserved here.</p>
      {tiers.filter((tier) => event.status === 'draft' ? tier.status !== 'archived' : tier.status === 'active').map((tier) => <article key={tier.id} className="creation-preview__tier">
        <h3>{tier.name}</h3><p>{tier.description}</p>
        <strong>{new Intl.NumberFormat('en-US', { style: 'currency', currency: tier.currency }).format(tier.unit_amount_minor / 100)}</strong>
        <p>{tier.quantity_total} tickets configured</p>
      </article>)}
    </section>}
  </div>
}
