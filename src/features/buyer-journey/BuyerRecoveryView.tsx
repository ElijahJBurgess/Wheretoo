import type { ReactNode } from 'react'
import { BuyerHeader } from './BuyerPrimitives'
import './buyer-recovery.css'

export function BuyerRecoveryView({ title, description, action, secondaryAction, children, busy = false, tone = 'unknown', announcementRole = 'status' }: {
  title: string; description: string; action?: ReactNode; secondaryAction?: ReactNode; children?: ReactNode; busy?: boolean; tone?: 'unknown' | 'failure' | 'neutral'; announcementRole?: 'status' | 'alert'
}) {
  return <main className={`buyer-page buyer-recovery buyer-recovery--${tone}`} aria-busy={busy}>
    <BuyerHeader />
    <div className="buyer-recovery__content">
      <span className="buyer-recovery__mark" aria-hidden="true">{busy ? '…' : tone === 'neutral' ? '×' : '!'}</span>
      <h1>{title}</h1>
      <p role={announcementRole} aria-live={announcementRole === 'alert' ? 'assertive' : 'polite'}>{description}</p>
      {children}
      <div className="buyer-recovery__actions">{action}{secondaryAction}</div>
    </div>
  </main>
}
