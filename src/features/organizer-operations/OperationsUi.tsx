import type { PropsWithChildren } from 'react'
import { Link, NavLink } from 'react-router-dom'
import type { StaffRole } from '../moderation/moderation.types'
import type { EventMetrics } from './operations.schemas'
import './organizer-operations.css'
import { dateTime, eventLabel } from './operations.format'
export function OperationsLayout(
  { children, eventId, onSignOut, staffRole }: PropsWithChildren<
    { eventId?: string; onSignOut(): void; staffRole: StaffRole | null }
  >,
) {
  return (
    <div className='operations-layout'>
      <aside className='operations-sidebar'>
        <Link className='operations-brand' to='/organizer/events'>wheretoo</Link>
        <nav aria-label='Organizer operations'>
          <NavLink to='/organizer/events' end>
            ▦ <span>My Events</span>
          </NavLink>
          {eventId && (
            <>
              <NavLink to={`/organizer/events/${eventId}/dashboard`}>
                ◫ <span>Dashboard</span>
              </NavLink>
              <NavLink to={`/organizer/events/${eventId}/orders`}>
                ▤ <span>Orders</span>
              </NavLink>
              <NavLink to={`/organizer/events/${eventId}/check-in`}>
                ⊞ <span>Check in</span>
              </NavLink>
            </>
          )}
        </nav>
        <div className='operations-sidebar__footer'>
          <Link to='/organizer/settings/payments'>Payments</Link>
          {staffRole && <Link to='/moderation'>Moderation</Link>}
          <button onClick={onSignOut} type='button'>Sign out</button>
          <span>Organizer</span>
        </div>
      </aside>
      <main className='operations-main'>{children}</main>
    </div>
  )
}
export function OperationsError({ title, retry }: { title: string; retry(): void }) {
  return (
    <section className='operations-state' role='alert'>
      <h1>{title}</h1>
      <p>Check your connection and access, then try again.</p>
      <button className='ops-button' onClick={retry}>Try again</button>
      <Link to='/organizer/events'>My Events</Link>
    </section>
  )
}
export function EventHero({ metrics }: { metrics: EventMetrics }) {
  const e = metrics.event
  // Artwork has no provisioned storage delivery contract yet; accept only existing HTTPS URLs.
  const artwork = e.artworkPath?.startsWith('https://') ? e.artworkPath : null
  return (
    <header className='operations-hero'>
      {artwork && <img alt='' className='operations-hero__image' src={artwork} />}
      <div className='operations-hero__body'>
        <span className={`ops-badge ops-badge--${e.status}`}>{eventLabel(e)}</span>
        <h1>{e.title || 'Untitled event'}</h1>
        <p>{dateTime(e.startsAt)}</p>
        <p>{[e.venueName, e.city].filter(Boolean).join(' · ') || 'Venue to be confirmed'}</p>
      </div>
    </header>
  )
}
