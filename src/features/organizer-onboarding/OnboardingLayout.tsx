import type { PropsWithChildren, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import './onboarding.css'

type OnboardingLayoutProps = PropsWithChildren<{
  title?: string
  backTo?: string
  onBack?: () => void
  hero?: boolean
  wide?: boolean
  headerAction?: ReactNode
}>

export function OnboardingLayout({ children, title, backTo, onBack, hero = false, wide = false, headerAction }: OnboardingLayoutProps) {
  return (
    <div className="onboarding">
      <div className={`onboarding__frame${hero ? ' onboarding__frame--hero' : ''}${wide ? ' onboarding__frame--wide' : ''}`}>
        <header className="onboarding__header">
          {onBack ? <button aria-label="Back" className="onboarding__back" onClick={onBack} type="button"><OnboardingIcon kind="back" /></button>
            : backTo ? <Link aria-label="Back to events" className="onboarding__back" to={backTo}><OnboardingIcon kind="back" /></Link> : null}
          {title ? <p className="onboarding__page-title">{title}</p> : <Link className="onboarding__brand" to="/auth/sign-up">wheretoo</Link>}
          {headerAction}
        </header>
        <main className="onboarding__main">{children}</main>
      </div>
      <p className="onboarding__signature">Good events. Better operations.</p>
    </div>
  )
}

export function OnboardingProgress({ step }: { step: 2 | 3 }) {
  return (
    <ol aria-label="Organizer onboarding progress" className="onboarding-progress">
      {['Account', 'Profile', 'Payouts'].map((label, index) => (
        <li aria-current={index + 1 === step ? 'step' : undefined} className={index + 1 < step ? 'is-complete' : ''} key={label}>
          <span aria-hidden="true" className="onboarding-progress__number">{index + 1 < step ? <OnboardingIcon kind="check" /> : index + 1}</span>
          <span>{label}{index + 1 < step ? <span className="onboarding__sr-only"> complete</span> : null}</span>
        </li>
      ))}
    </ol>
  )
}

export type OnboardingIconKind = 'check' | 'clock' | 'alert' | 'pause' | 'error' | 'lock' | 'back' | 'arrow' | 'mail'

export function OnboardingIcon({ kind }: { kind: OnboardingIconKind }) {
  const paths: Record<OnboardingIconKind, ReactNode> = {
    check: <path d="m5 12 4 4L19 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 3" /></>,
    alert: <><path d="M12 5v9" /><circle cx="12" cy="18" r=".6" /></>,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    error: <path d="m6 6 12 12M6 18 18 6" />,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3" /></>,
    back: <path d="m14 5-7 7 7 7" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 6 9 7 9-7" /></>,
  }
  return <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24">{paths[kind]}</svg>
}

export function StripeArtwork({ transition = false }: { transition?: boolean }) {
  return <div aria-hidden="true" className={`stripe-artwork${transition ? ' stripe-artwork--transition' : ''}`}>
    {transition ? <><span className="stripe-artwork__w">W</span><OnboardingIcon kind="arrow" /><span className="stripe-artwork__word">stripe</span></>
      : <><span className="stripe-artwork__card"><i /><i /><i /></span><span className="stripe-artwork__badge">stripe</span></>}
  </div>
}
