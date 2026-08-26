import { Component, lazy, Suspense, useCallback, useState, type ComponentType, type ReactNode } from 'react'
import { AsyncState } from '../../components/ui/AsyncState'
import { Button } from '../../components/ui/Button'
import type { ConnectAccountSession } from './payment.api'

type ConnectEmbeddedPanelProps = {
  initialSession: ConnectAccountSession
  mode: 'onboarding' | 'management'
  onExit: () => void
  onLoadError: () => void
  refreshAccountSession: () => Promise<ConnectAccountSession>
  loadEmbedded?: ConnectEmbeddedLoader
}

type StripeConnectEmbeddedProps = Omit<ConnectEmbeddedPanelProps, 'loadEmbedded'>
type ConnectEmbeddedLoader = () => Promise<{ default: ComponentType<StripeConnectEmbeddedProps> }>

// Stripe Connect is intentionally split from the organizer app entry so its SDK only loads once an
// organizer chooses to manage payment setup.
const loadStripeConnectEmbedded: ConnectEmbeddedLoader = () => import('./StripeConnectEmbedded')

type ConnectChunkErrorBoundaryProps = {
  children: ReactNode
  onRetry: () => void
}

type ConnectChunkErrorBoundaryState = { hasError: boolean }

class ConnectChunkErrorBoundary extends Component<
  ConnectChunkErrorBoundaryProps,
  ConnectChunkErrorBoundaryState
> {
  state: ConnectChunkErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ConnectChunkErrorBoundaryState {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <AsyncState
          action={<Button onClick={this.props.onRetry}>Retry secure setup</Button>}
          description="Check your connection, then try again."
          status="error"
          title="Secure payment setup could not load"
        />
      )
    }

    return this.props.children
  }
}

export function ConnectEmbeddedPanel({ loadEmbedded = loadStripeConnectEmbedded, ...props }: ConnectEmbeddedPanelProps) {
  const [attempt, setAttempt] = useState(0)
  const [StripeConnectEmbedded, setStripeConnectEmbedded] = useState(() => lazy(loadEmbedded))
  const retryLoading = useCallback(() => {
    setStripeConnectEmbedded(() => lazy(loadEmbedded))
    setAttempt((value) => value + 1)
  }, [loadEmbedded])

  return (
    <section aria-label="Stripe payment setup" className="payments-panel__embedded">
      <ConnectChunkErrorBoundary key={attempt} onRetry={retryLoading}>
        <Suspense fallback={<AsyncState status="loading" title="Loading secure payment setup" />}>
          <StripeConnectEmbedded {...props} />
        </Suspense>
      </ConnectChunkErrorBoundary>
      {props.mode === 'management' ? (
        <div className="payments-panel__embedded-actions">
          <Button onClick={props.onExit} variant="secondary">Done managing payments</Button>
        </div>
      ) : null}
    </section>
  )
}
