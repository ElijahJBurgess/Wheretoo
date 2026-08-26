import { lazy, Suspense } from 'react'
import { AsyncState } from '../../components/ui/AsyncState'
import type { ConnectAccountSession } from './payment.api'

type ConnectEmbeddedPanelProps = {
  initialSession: ConnectAccountSession
  mode: 'onboarding' | 'management'
  onExit: () => void
  onLoadError: () => void
  refreshAccountSession: () => Promise<ConnectAccountSession>
}

// Stripe Connect is intentionally split from the organizer app entry so its SDK only loads once an
// organizer chooses to manage payment setup.
const StripeConnectEmbedded = lazy(() => import('./StripeConnectEmbedded'))

export function ConnectEmbeddedPanel(props: ConnectEmbeddedPanelProps) {
  return (
    <section aria-label="Stripe payment setup" className="payments-panel__embedded">
      <Suspense fallback={<AsyncState status="loading" title="Loading secure payment setup" />}>
        <StripeConnectEmbedded {...props} />
      </Suspense>
    </section>
  )
}
