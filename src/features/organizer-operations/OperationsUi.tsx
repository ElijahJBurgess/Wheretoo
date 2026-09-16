import { ReadState } from '../../components/ui/ReadState'
import type { PropsWithChildren } from 'react'
import { Link, NavLink } from 'react-router-dom'
import type { StaffRole } from '../moderation/moderation.types'
import type { EventRow } from '../events/event.types'
import { organizerEventLocation, organizerEventStatus } from '../events/organizerEventPresentation'
import type { EventMetrics } from './operations.schemas'
import './organizer-operations.css'
import { EventArtwork } from './EventArtwork'
import { dateTime, eventLabel, timeZoneLabel } from './operations.format'
function NavigationIcon({ kind }: { kind: 'events' | 'dashboard' | 'orders' | 'registrations' | 'scan' }) {
  const paths = {
    events: 'M5 3v4m10-4v4M3 9h14M4 5h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
    dashboard: 'M3 3h5v6H3zm9 0h5v4h-5zM3 13h5v4H3zm9-2h5v6h-5z',
    orders: 'M4 3h12v14l-3-2-3 2-3-2-3 2V3Zm3 4h6m-6 4h6',
    registrations: 'M4 3h12v14l-3-2-3 2-3-2-3 2V3Zm3 4h6m-6 4h6',
    scan: 'M3 7V3h4m6 0h4v4m0 6v4h-4m-6 0H3v-4m3-7h3v3H6zm5 0h3v3h-3zm-5 5h3v3H6zm5 0h3v3h-3z',
  }
  return <svg aria-hidden='true' width='16' height='16' viewBox='0 0 20 20' fill='none' stroke='currentColor' strokeWidth='1.25' strokeLinecap='round' strokeLinejoin='round'><path d={paths[kind]} /></svg>
}
export function OperationsLayout(
  { children, eventId, admissionType = null, onSignOut, staffRole, signOutPending = false }: PropsWithChildren<
    { eventId?: string; admissionType?: 'paid' | 'free' | null; signOutPending?: boolean; onSignOut(): void; staffRole: StaffRole | null }
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
              {admissionType === 'paid' && <NavLink to={`/organizer/events/${eventId}/orders`}>
                <NavigationIcon kind='orders' /> <span>Orders</span>
              </NavLink>}
              {admissionType === 'free' && <NavLink to={`/organizer/events/${eventId}/registrations`}>
                <NavigationIcon kind='registrations' /> <span>Registrations</span>
              </NavLink>}
              <NavLink to={`/organizer/events/${eventId}/check-in`}>
                <NavigationIcon kind='scan' /> <span>Check in</span>
              </NavLink>
            </>
          )}
          <NavLink to='/organizer/settings'><span aria-hidden='true'>⚙</span> <span>Settings</span></NavLink>
        </nav>
        <div className='operations-sidebar__footer'>
          <Link to='/organizer/settings/payments'>Payments</Link>
          {staffRole && <Link to='/moderation'>Moderation</Link>}
          <button disabled={signOutPending} onClick={onSignOut} type='button'>{signOutPending ? 'Signing out…' : 'Sign out'}</button>
          <span>Organizer</span>
        </div>
      </aside>
      <main className='operations-main'>{children}</main>
    </div>
  )
}
export function OperationsError({ title, retry, headingAs = 'h1' }: { title: string; retry(): void; headingAs?: 'h1' | 'h2' }) {
  return (
    <ReadState headingAs={headingAs} status='unavailable' title={title}
      description='We could not confirm this information. Try this read again.'
      action={<button className='ops-button' onClick={retry}>Try again</button>}
      secondaryAction={<Link to='/organizer/events'>My Events</Link>} />
  )
}
export function EventHero({ metrics, event }: { metrics?: EventMetrics; event?: EventRow }) {
  const metricsEvent = metrics?.event
  if (!event && !metricsEvent) return null
  const status = event ? organizerEventStatus(event) : {
    label: eventLabel(metricsEvent!),
    style: metricsEvent!.status === 'published' ? 'published' : metricsEvent!.status,
  }
  const title = event?.title ?? metricsEvent?.title
  const startsAt = event?.starts_at ?? metricsEvent?.startsAt ?? null
  const venue = event?.venue_name ?? metricsEvent?.venueName
  const artwork = event?.artwork_path ?? metricsEvent?.artworkPath
  const location = event ? organizerEventLocation(event) : [metricsEvent?.venueName, metricsEvent?.city].filter(Boolean).join(' · ')
  return (
    <header className='operations-hero'>
      <EventArtwork source={artwork ?? null} className='operations-hero__image' eager />
      <div className='operations-hero__body'>
        <span className={`ops-badge ops-badge--${status.style}`}>{status.label}</span>
        <h1>{title?.trim() || 'Untitled event'}</h1>
        <p>{dateTime(startsAt, event?.timezone)}{event ? ` · ${timeZoneLabel(event.timezone)}` : ''}</p>
        <p>{venue?.trim() || 'Venue to be confirmed'}</p>
        {event && <p>{location}</p>}
      </div>
    </header>
  )
}
