import type { PropsWithChildren } from 'react'
import type { StaffRole } from '../../features/moderation/moderation.types'

type OrganizerLayoutProps = PropsWithChildren<{
  signOutPending?: boolean
  onSignOut?: () => void
  staffRole?: StaffRole | null
}>

export function OrganizerLayout({ children, onSignOut, signOutPending = false, staffRole = null }: OrganizerLayoutProps) {
  return (
    <div className="organizer-layout">
      <header className="organizer-layout__header">
        <a className="product-mark" href="/organizer/events">
          whereto
        </a>
        <nav aria-label="Organizer">
          <div className="organizer-layout__nav">
            <a href="/organizer/events">Events</a>
            <a href="/organizer/settings/payments">Payments</a>
            <a href="/organizer/settings">Settings</a>
            {staffRole ? <a href="/moderation">Moderation</a> : null}
            {staffRole === 'admin' ? <a href="/moderation/event-imports">CSV imports</a> : null}
            <button disabled={signOutPending} className="organizer-layout__sign-out" onClick={onSignOut} type="button">
              {signOutPending ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </nav>
      </header>
      <main className="organizer-layout__main">{children}</main>
    </div>
  )
}
