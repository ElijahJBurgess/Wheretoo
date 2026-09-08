import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { TicketTierList } from './TicketTierList'
import type { PublicTicketTierTuple } from './ticket.types'

const mockTiers = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'General Admission',
    description: 'Access to event',
    unit_amount_minor: 2500,
    currency: 'usd',
    availability_status: 'available',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    name: 'VIP',
    description: 'Priority entry + exclusive lounge',
    unit_amount_minor: 6000,
    currency: 'usd',
    availability_status: 'sold_out',
  },
] satisfies PublicTicketTierTuple

export function TicketSelectionPreviewPage() {
  const [selectedTierId, setSelectedTierId] = useState(mockTiers[0].id)

  return (
    <main className="public-event-layout">
      <article aria-labelledby="preview-event-title" className="public-event">
        <div
          aria-label="Sunset Rooftop Sessions event artwork"
          className="public-event__artwork public-event__artwork--preview"
          role="img"
        >
          <div className="public-event__artwork-shade" />
          <div className="public-event__artwork-copy">
            <span>Whereto presents</span>
            <strong>Sunset Rooftop Sessions</strong>
            <small>Music</small>
          </div>
        </div>
        <div className="public-event__content">
          <header className="public-event__header">
            <p className="public-event__eyebrow">Ticket selection preview</p>
            <h1 id="preview-event-title">Sunset Rooftop Sessions</h1>
            <p>Hosted by good company</p>
          </header>
          <dl className="public-event__facts">
            <div><dt>Date</dt><dd>Sat Sep 19 · 7:00 PM</dd></div>
            <div><dt>Venue</dt><dd>Lakeview Rooftop</dd></div>
            <div><dt>Location</dt><dd>Oakland, CA</dd></div>
          </dl>
          <section aria-label="Event description" className="public-event__description">
            <p>Afro house, open-air views, skyline nights.</p>
          </section>
          <section aria-labelledby="preview-tickets-title" className="public-event__tickets">
            <div>
              <p className="public-event__eyebrow">Tickets</p>
              <h2 id="preview-tickets-title">Choose your ticket</h2>
            </div>
            <TicketTierList
              onSelect={setSelectedTierId}
              selectedTierId={selectedTierId}
              tiers={mockTiers}
            />
            <Button disabled={selectedTierId === null} onClick={() => undefined}>
              Get tickets
            </Button>
          </section>
        </div>
      </article>
    </main>
  )
}
