import type { PropsWithChildren } from 'react'
import { Link } from 'react-router-dom'
import './eventCreation.css'

const steps = ['Details', 'When & Where', 'Admission', 'Review']
export function EventCreationLayout({ title, step, children, onBack, backTo }: PropsWithChildren<{
  title: string; step: number; admissionType?: 'free' | 'paid'; onBack?: () => void; backTo?: string
}>) {
  const currentStage = step <= 3 ? step : step === 4 ? 3 : 4
  return <section className="event-creation" aria-label={title}>
    <header className="event-creation__header">
      {onBack ? <button type="button" className="event-creation__back" onClick={onBack} aria-label="Back">‹</button>
        : <Link className="event-creation__back" to={backTo ?? '/organizer/events'} aria-label="Back to my events">‹</Link>}
      <p>{title}</p><Link className="event-creation__brand" to="/organizer/events">wheretoo</Link>
    </header>
    <nav aria-label="Event creation progress" className="event-creation__progress">
      <ol>{steps.map((label, index) => <li key={label} aria-current={index + 1 === currentStage ? 'step' : undefined} className={index + 1 < currentStage ? 'is-complete' : ''}>
        <span aria-hidden="true">{index + 1}</span><span>{label}</span>
      </li>)}</ol>
    </nav>
    <div className="event-creation__body">{children}</div>
  </section>
}
