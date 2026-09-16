import { useState } from 'react'
import { AsyncState, type AsyncStatus, type StateSkeleton } from '../components/ui/AsyncState'
import { ReadState } from '../components/ui/ReadState'
import { Button } from '../components/ui/Button'
import './shared-states-preview.css'

type Fixture = {
  title: string
  description: string
  status: AsyncStatus
  skeleton?: StateSkeleton
  deferred?: boolean
}

const fixtures: Fixture[] = [
  { title: 'No events yet', description: 'Create an event when you are ready to bring people together.', status: 'empty' },
  { title: 'No orders yet', description: 'Orders will appear here after a successful purchase.', status: 'empty' },
  { title: 'No matching orders', description: 'No orders match the active search or filter.', status: 'empty' },
  { title: 'Something went wrong', description: 'We could not load this information. Try the read again.', status: 'error' },
  { title: 'This page isn’t here', description: 'The page may have moved or the address may be invalid.', status: 'not-found' },
  { title: 'You don’t have access', description: 'Your account does not have permission to view this resource.', status: 'denied' },
  { title: 'Tickets unavailable', description: 'Ticket details cannot be shown right now.', status: 'unavailable' },
  { title: 'You’re offline', description: 'Check your connection. Previously loaded information may still be available.', status: 'offline' },
  { title: 'Loading events', description: 'Getting the latest event information.', status: 'loading', skeleton: 'event-cards' },
  { title: 'Loading metrics', description: 'Getting the latest summary.', status: 'loading', skeleton: 'metrics' },
  { title: 'Loading orders', description: 'Getting the latest orders.', status: 'loading', skeleton: 'order-rows' },
  { title: 'Loading details', description: 'Getting the latest details.', status: 'loading', skeleton: 'detail-fields' },
  { title: 'No events on map', description: 'Nothing is visible in this area or with these filters.', status: 'empty', deferred: true },
  { title: 'Location permission denied', description: 'Location access is unavailable. The map may still be browsed manually.', status: 'denied', deferred: true },
  { title: 'Map failed to load', description: 'Map data could not load. Try again later.', status: 'error', deferred: true },
]

export function SharedStatesPreview() {
  const [readCount, setReadCount] = useState(0)
  return (
    <main className="shared-states-preview">
      <header className="shared-states-preview__intro">
        <p>Development-only · Spec 12</p>
        <h1>Clear moments. Better experiences.</h1>
        <p>Shared presentation states use synthetic copy and contain no private, payment, or admission data.</p>
      </header>

      <section aria-labelledby="shared-state-gallery">
        <h2 id="shared-state-gallery">State gallery</h2>
        <div className="shared-states-preview__grid">
          {fixtures.map((fixture, index) => (
            <article className="shared-states-preview__card" key={`${fixture.title}-${fixture.skeleton ?? fixture.status}`}>
              <div className="shared-states-preview__label">
                <span>{String(index + 1).padStart(2, '0')}</span>
                <p>{fixture.deferred ? 'DEFERRED — MAP OWNER' : fixture.status}</p>
              </div>
              <AsyncState
                headingAs="h3"
                status={fixture.status}
                skeleton={fixture.skeleton}
                title={fixture.title}
                description={fixture.description}
                action={!fixture.skeleton ? <Button onClick={() => setReadCount(value => value + 1)}>{fixture.status === 'empty' ? 'View options' : 'Try again'}</Button> : undefined}
                secondaryAction={!fixture.skeleton && index === 3 ? <Button variant="secondary" onClick={() => setReadCount(0)}>Reset preview</Button> : undefined}
              />
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="passive-read-state" className="shared-states-preview__read">
        <h2 id="passive-read-state">Passive read connectivity</h2>
        <ReadState headingAs="h3" paused status="loading" skeleton="detail-fields" title="Loading event" />
        <output aria-live="polite">Preview actions used: {readCount}</output>
      </section>
    </main>
  )
}
