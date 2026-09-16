import type { PropsWithChildren } from 'react'
import { Link } from 'react-router-dom'
import './eventCreation.css'

const steps = ['Basics', 'Date & Location', 'Ticket Type', 'Ticket Tiers', 'Event Details', 'Preview', 'Publish Confirmation', 'Publication Outcome']
export function EventCreationLayout({ title, step, admissionType, children, onBack, backTo }: PropsWithChildren<{
  title: string; step: number; admissionType?: 'free' | 'paid'; onBack?: () => void; backTo?: string
}>) {
  return <section className="event-creation" aria-label={title}>
    <header className="event-creation__header">
      {onBack ? <button type="button" className="event-creation__back" onClick={onBack} aria-label="Back">‹</button>
        : <Link className="event-creation__back" to={backTo ?? '/organizer/events'} aria-label="Back to my events">‹</Link>}
      <p>{title}</p><Link className="event-creation__brand" to="/organizer/events">wheretoo</Link>
    </header>
    <nav aria-label="Event creation progress" className="event-creation__progress">
      <ol>{steps.map((label, index) => admissionType === 'free' && index === 3 ? null : <li key={label} aria-current={index + 1 === step ? 'step' : undefined} className={index + 1 < step ? 'is-complete' : ''}>
        <span aria-hidden="true" /><span className="event-creation__sr">{label}</span>
      </li>)}</ol>
      <p>{steps[step - 1]}</p>
    </nav>
    <div className="event-creation__body">{children}</div>
  </section>
}
