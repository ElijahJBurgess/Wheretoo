import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { AsyncState } from '../../components/ui/AsyncState'
import { Button } from '../../components/ui/Button'
import { useSession } from '../auth/SessionProvider'
import { getExpressLoginUrl, type ConnectAccountSession } from './payment.api'
import { ConnectEmbeddedPanel } from './ConnectEmbeddedPanel'
import { useConnectAccountSession, useConnectStatus } from './payment.queries'
import type { ConnectStatus } from './payment.types'

type PaymentCopy = {
  action: string
  description: string
  title: string
}

type EmbeddedConnectSession = {
  session: ConnectAccountSession
  userId: string
}

const paymentCopy: Record<ConnectStatus['status'], PaymentCopy> = {
  not_started: {
    title: 'Set up payments',
    description: 'Complete secure Stripe setup before you sell paid tickets.',
    action: 'Set up payments',
  },
  pending: {
    title: 'Payment setup is in progress',
    description: 'Stripe still needs a few details before paid ticket sales can begin.',
    action: 'Continue payment setup',
  },
  action_required: {
    title: 'Payment setup needs your attention',
    description: 'Review your secure Stripe setup to continue preparing paid ticket sales.',
    action: 'Review payment setup',
  },
  restricted: {
    title: 'Payment setup needs an update',
    description: 'Update your secure Stripe setup before paid ticket sales can begin.',
    action: 'Update payment details',
  },
  ready: {
    title: 'Payments are ready',
    description: 'Your organization can prepare paid ticket sales for eligible events.',
    action: 'Manage payment details',
  },
}

function paymentMode(status: ConnectStatus['status']): 'onboarding' | 'management' {
  return status === 'ready' ? 'management' : 'onboarding'
}

export function OrganizerPaymentsPage() {
  const sessionState = useSession()
  const userId = sessionState.status === 'authenticated' ? sessionState.user.id : ''
  const connectQuery = useConnectStatus(userId)
  const accountSessionMutation = useConnectAccountSession()
  const refreshConnectStatus = connectQuery.refetch
  const mutateAccountSession = accountSessionMutation.mutateAsync
  const restoreActionFocusRef = useRef(false)
  const currentUserIdRef = useRef(userId)
  const actionRef = useCallback((node: HTMLButtonElement | null) => {
    if (node !== null && restoreActionFocusRef.current) {
      node.focus()
      restoreActionFocusRef.current = false
    }
  }, [])
  const [embeddedSession, setEmbeddedSession] = useState<EmbeddedConnectSession | null>(null)
  const [embeddedMode, setEmbeddedMode] = useState<'onboarding' | 'management'>('onboarding')
  const [actionError, setActionError] = useState<string | null>(null)
  const [accountSessionOwnerId, setAccountSessionOwnerId] = useState<string | null>(null)
  const [expressLoginOwnerId, setExpressLoginOwnerId] = useState<string | null>(null)

  useLayoutEffect(() => {
    currentUserIdRef.current = userId
  }, [userId])

  const refreshAccountSession = useCallback(async (initiatingUserId: string) => {
    const session = await mutateAccountSession(initiatingUserId)
    return session
  }, [mutateAccountSession])

  const resetEmbeddedPanel = useCallback((errorMessage: string | null) => {
    setEmbeddedSession(null)
    setActionError(errorMessage)
    restoreActionFocusRef.current = true
    void Promise.resolve(refreshConnectStatus())
  }, [refreshConnectStatus])

  const closeEmbeddedPanel = useCallback(() => {
    resetEmbeddedPanel(null)
  }, [resetEmbeddedPanel])

  const handleEmbeddedLoadError = useCallback(() => {
    resetEmbeddedPanel('Secure payment setup could not load. Try again.')
  }, [resetEmbeddedPanel])

  async function openEmbeddedPanel() {
    const initiatingUserId = userId
    setActionError(null)
    setAccountSessionOwnerId(initiatingUserId)
    try {
      const session = await refreshAccountSession(initiatingUserId)
      if (currentUserIdRef.current !== initiatingUserId) return
      setEmbeddedMode(paymentMode(session.status.status))
      setEmbeddedSession({ session, userId: initiatingUserId })
    } catch {
      if (currentUserIdRef.current === initiatingUserId) {
        setActionError('Payment setup could not be opened. Try again.')
      }
    } finally {
      if (currentUserIdRef.current === initiatingUserId) {
        setAccountSessionOwnerId(null)
      }
    }
  }

  async function openExpressLogin() {
    const initiatingUserId = userId
    setActionError(null)
    setExpressLoginOwnerId(initiatingUserId)
    try {
      const url = await getExpressLoginUrl()
      if (currentUserIdRef.current !== initiatingUserId) return
      window.location.assign(url)
    } catch {
      if (currentUserIdRef.current === initiatingUserId) {
        setActionError('Stripe Express could not be opened. Try again.')
      }
    } finally {
      if (currentUserIdRef.current === initiatingUserId) {
        setExpressLoginOwnerId(null)
      }
    }
  }

  if (sessionState.status !== 'authenticated' || connectQuery.isPending) {
    return <AsyncState status="loading" title="Loading payment setup" />
  }

  if (connectQuery.isError || !connectQuery.data) {
    return (
      <AsyncState
        action={<Button onClick={() => void connectQuery.refetch()}>Try again</Button>}
        description="Check your connection, then try again."
        status="error"
        title="Payment setup could not load"
      />
    )
  }

  const status = connectQuery.data
  const copy = paymentCopy[status.status]
  const activeEmbeddedSession = embeddedSession?.userId === userId ? embeddedSession.session : null
  const isOpeningAccountSession = accountSessionMutation.isPending && accountSessionOwnerId === userId
  const isOpeningExpress = expressLoginOwnerId === userId

  return (
    <section aria-labelledby="organizer-payments-title" className="payments-page">
      <header className="payments-page__header">
        <p className="organizer-eyebrow">Organizer settings</p>
        <h1 id="organizer-payments-title">Payments</h1>
        <p>Set up the secure details needed to accept paid ticket sales.</p>
      </header>

      <section className="payments-panel" aria-live="polite">
        <div className="payments-panel__status">
          <p className={`payments-status payments-status--${status.status}`}>
            {status.status === 'ready' ? 'Ready for paid sales' : 'Payment setup'}
          </p>
          <h2>{copy.title}</h2>
          <p>{copy.description}</p>
        </div>

        {actionError ? <p className="payments-panel__error" role="alert">{actionError}</p> : null}

        {activeEmbeddedSession ? (
          <ConnectEmbeddedPanel
            initialSession={activeEmbeddedSession}
            mode={embeddedMode}
            onExit={closeEmbeddedPanel}
            onLoadError={handleEmbeddedLoadError}
            refreshAccountSession={() => refreshAccountSession(userId)}
          />
        ) : (
          <div className="payments-panel__actions">
            <Button
              disabled={isOpeningAccountSession}
              onClick={() => void openEmbeddedPanel()}
              ref={actionRef}
            >
              {isOpeningAccountSession ? 'Opening secure setup…' : copy.action}
            </Button>
            {status.status === 'ready' ? (
              <Button disabled={isOpeningExpress} onClick={() => void openExpressLogin()} variant="secondary">
                {isOpeningExpress ? 'Opening Stripe Express…' : 'Open Stripe Express'}
              </Button>
            ) : null}
          </div>
        )}
      </section>
    </section>
  )
}
