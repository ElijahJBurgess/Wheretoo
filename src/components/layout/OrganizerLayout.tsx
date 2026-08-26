import type { PropsWithChildren } from 'react'

type OrganizerLayoutProps = PropsWithChildren<{
  onSignOut?: () => void
}>

export function OrganizerLayout({ children, onSignOut }: OrganizerLayoutProps) {
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
            <button className="organizer-layout__sign-out" onClick={onSignOut} type="button">
              Sign out
            </button>
          </div>
        </nav>
      </header>
      <main className="organizer-layout__main">{children}</main>
    </div>
  )
}
