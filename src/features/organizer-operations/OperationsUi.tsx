import type { PropsWithChildren } from 'react'
import { Link, NavLink } from 'react-router-dom'
import type { StaffRole } from '../moderation/moderation.types'
import type { EventMetrics } from './operations.schemas'
import './organizer-operations.css'
import { EventArtwork } from './EventArtwork'
import { dateTime, eventLabel } from './operations.format'
function NavigationIcon({ kind }: { kind: 'events' | 'dashboard' | 'orders' | 'scan' }) {
  const paths = {
    events: 'M5 3v4m10-4v4M3 9h14M4 5h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
    dashboard: 'M3 3h5v6H3zm9 0h5v4h-5zM3 13h5v4H3zm9-2h5v6h-5z',
    orders: 'M4 3h12v14l-3-2-3 2-3-2-3 2V3Zm3 4h6m-6 4h6',
    scan: 'M3 7V3h4m6 0h4v4m0 6v4h-4m-6 0H3v-4m3-7h3v3H6zm5 0h3v3h-3zm-5 5h3v3H6zm5 0h3v3h-3z',
  }
  return <svg aria-hidden='true' width='16' height='16' viewBox='0 0 20 20' fill='none' stroke='currentColor' strokeWidth='1.25' strokeLinecap='round' strokeLinejoin='round'><path d={paths[kind]} /></svg>
}
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
            <NavigationIcon kind='events' /> <span>My Events</span>
          </NavLink>
          {eventId && (
            <>
              <NavLink to={`/organizer/events/${eventId}/dashboard`}>
                <NavigationIcon kind='dashboard' /> <span>Dashboard</span>
              </NavLink>
              <NavLink to={`/organizer/events/${eventId}/orders`}>
                <NavigationIcon kind='orders' /> <span>Orders</span>
              </NavLink>
              <NavLink to={`/organizer/events/${eventId}/check-in`}>
                <NavigationIcon kind='scan' /> <span>Check in</span>
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
  return (
    <header className='operations-hero'>
      <EventArtwork source={e.artworkPath} className='operations-hero__image' eager />
      <div className='operations-hero__body'>
        <span className={`ops-badge ops-badge--${e.status}`}>{eventLabel(e)}</span>
        <h1>{e.title || 'Untitled event'}</h1>
        <p>{dateTime(e.startsAt)}</p>
        <p>{[e.venueName, e.city].filter(Boolean).join(' · ') || 'Venue to be confirmed'}</p>
      </div>
    </header>
  )
}
