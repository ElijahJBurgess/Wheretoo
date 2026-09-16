import type { ReactNode } from 'react'
import './buyer.css'
import '../ticket-delivery/ticket-delivery.css'

export function BuyerIcon({ name, className = '' }: { name: 'back' | 'close' | 'arrow' | 'calendar' | 'pin' | 'ticket' | 'lock' | 'check'; className?: string }) {
  const paths = {
    back: 'm14 6-6 6 6 6', close: 'm6 6 12 12M18 6 6 18', arrow: 'M4 12h16m-6-6 6 6-6 6',
    calendar: 'M7 3v4m10-4v4M4 10h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z',
    pin: 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0ZM14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
    ticket: 'm9 3 3 3a3 3 0 0 0 4 4l3 3-6 6-3-3a3 3 0 0 0-4-4l-3-3 6-6Z',
    lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5ZM12 14v3',
    check: 'm5 12 4 4L19 6',
  }
  return <svg aria-hidden="true" className={`buyer-icon ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>
}

export function BuyerHeader({ back }: { back?: ReactNode }) {
  return <header className="buyer-header"><div className="buyer-header__back">{back}</div><span className="buyer-wordmark">wheretoo</span></header>
}

export function BuyerProgress({ step, complete = false }: { step: 1 | 2 | 3; complete?: boolean }) {
  return <ol className="buyer-progress" aria-label="Purchase progress">{['Tickets', 'Checkout', 'Confirmation'].map((label, index) => {
    const done = complete || index + 1 < step
    return <li key={label} className={done || index + 1 === step ? 'is-active' : ''} aria-current={!complete && index + 1 === step ? 'step' : undefined}>
      <span className="buyer-progress__dot">{done ? <BuyerIcon name="check" /> : index + 1}</span><span>{label}</span>
    </li>
  })}</ol>
}

export function BuyerEventSummary({ title, schedule, venue, artwork, organizer, location }: {
  title: string; schedule: string; venue: string; artwork?: string | null; organizer?: string; location?: string
}) {
  return <section className={`buyer-event-summary${artwork ? ' buyer-event-summary--artwork' : ''}`} aria-label="Event summary">
    {artwork ? <img src={artwork} alt="" /> : null}
    <div><h2>{title}</h2>{organizer ? <p className="buyer-event-summary__organizer">Hosted by {organizer}</p> : null}
      <p><BuyerIcon name="calendar" /><span>{schedule}</span></p>
      <p><BuyerIcon name="pin" /><span>{venue}{location ? <><br />{location}</> : null}</span></p>
    </div>
  </section>
}
