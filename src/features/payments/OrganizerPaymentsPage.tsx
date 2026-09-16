import { useCallback, useLayoutEffect, useRef, useState, type PropsWithChildren } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { getOwnedEvent } from '../events/event.api'
import { eventKeys } from '../events/event.queries'
import { AsyncState } from '../../components/ui/AsyncState'
import { Button } from '../../components/ui/Button'
import { useSession } from '../auth/SessionProvider'
import { captureIdentityLifetime } from '../auth/identityLifetime'
import { useOptionalSignOut } from '../auth/SignOutProvider'
import { OnboardingIcon } from '../organizer-onboarding/OnboardingLayout'
import { getExpressLoginUrl, type ConnectAccountSession } from './payment.api'
import { ConnectEmbeddedPanel } from './ConnectEmbeddedPanel'
import { useConnectAccountSession, useConnectStatus } from './payment.queries'
import type { ConnectStatus } from './payment.types'
import './organizer-payments.css'

type JourneyStep = 'overview' | 'transition' | 'interrupted'
type ActionError = 'session' | 'embedded' | 'express' | 'status'

const statusCopy = {
  pending: { title: 'Stripe is reviewing your details', description: 'Your payment setup is pending with Stripe. Paid ticket sales will be available once verification is complete and your account is ready.', tone: 'pending' },
  action_required: { title: 'Action required in Stripe', description: 'Stripe needs more information to complete your account setup. Review your details securely with Stripe to continue.', tone: 'danger' },
  restricted: { title: 'Payment setup needs an update', description: 'Your Stripe account needs attention before you can sell paid tickets. Open Stripe to review and update your details.', tone: 'danger' },
  ready: { title: 'You’re all set!', description: 'Stripe is connected and your payouts are ready.', tone: 'success' },
  interrupted: { title: 'Setup not completed', description: 'You started setting up your payouts with Stripe but didn’t finish. Pick up where you left off to start accepting payments.', tone: 'neutral' },
  error: { title: 'Something went wrong', description: 'We couldn’t connect to Stripe. Check your connection and try again.', tone: 'danger' },
} satisfies Record<string, { title: string; description: string; tone: string }>

function PaymentsSettingsPanel({ children }: PropsWithChildren) {
  return <section className="payments-settings" aria-labelledby="payments-settings-title">
    <header className="payments-settings__header">
      <h2 id="payments-settings-title">Payments &amp; Payouts</h2>
      <p>Connect Stripe to accept payments for your events and receive payouts.</p>
    </header>
    {children}
  </section>
}

function OrganizerPaymentsJourney({ userId, eventId, verifyEvent }: { userId: string; eventId?: string; verifyEvent?: () => Promise<void> }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const connectQuery = useConnectStatus(userId, { fresh: eventId !== undefined })
  const returnPath = eventId ? `/organizer/events/${eventId}/preview` : '/organizer/events'
  const accountSessionMutation = useConnectAccountSession()
  const [step, setStep] = useState<JourneyStep>('overview')
  const [embeddedSession, setEmbeddedSession] = useState<ConnectAccountSession | null>(null)
  const [actionError, setActionError] = useState<ActionError | null>(null)
  const [busy, setBusy] = useState<'session' | 'refresh' | 'express' | null>(null)
  const mounted = useRef(false)
  const inFlight = useRef(false)
  const restoreFocus = useRef(false)
  const actionRef = useCallback((node: HTMLButtonElement | null) => {
    if (node && restoreFocus.current) {
      node.focus()
      restoreFocus.current = false
    }
  }, [])

  useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  async function refreshStatus(): Promise<ConnectStatus> {
    const result = await connectQuery.refetch()
    if (result.isError || !result.data) throw new Error('Status unavailable')
    return result.data
  }

  async function refreshOverview(interrupted = false) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy('refresh')
    setEmbeddedSession(null)
    setActionError(null)
    restoreFocus.current = true
    try {
      await refreshStatus()
      if (mounted.current) setStep(interrupted ? 'interrupted' : 'overview')
    } catch {
      if (mounted.current) setActionError('status')
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(null)
    }
  }

  async function openEmbeddedPanel(recheckInterrupted = false) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy('session')
    setActionError(null)
    let failure: ActionError = recheckInterrupted ? 'status' : 'session'
    try {
      // An exit is local UX only. Stripe may have moved to a canonical state
      // while the organizer was away; show it before starting another session.
      if (recheckInterrupted) {
        const status = await refreshStatus()
        if (!mounted.current) return
        if (status.status !== 'not_started') {
          setStep('overview')
          restoreFocus.current = true
          return
        }
      }
      failure = 'session'
      const session = await accountSessionMutation.mutateAsync(userId)
      if (mounted.current) setEmbeddedSession(session)
    } catch {
      if (mounted.current) {
        setActionError(failure)
        restoreFocus.current = true
      }
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(null)
    }
  }

  const handleEmbeddedLoadError = useCallback(() => {
    setEmbeddedSession(null)
    setActionError('embedded')
    restoreFocus.current = true
    void connectQuery.refetch()
  }, [connectQuery])

  async function returnToEvent() {
    if (inFlight.current || !eventId) return
    inFlight.current = true
    setBusy('refresh')
    setActionError(null)
    try {
      await refreshStatus()
      if (!mounted.current) return
      await verifyEvent?.()
      if (mounted.current) void navigate(returnPath)
    } catch {
      if (mounted.current) setActionError('status')
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(null)
    }
  }

  const laterAction = eventId
    ? <Button disabled={busy !== null} onClick={() => void returnToEvent()} variant="secondary">Do this later</Button>
    : <Link className="payments-settings__link" to="/organizer/events">Do this later</Link>

  async function openExpressLogin() {
    if (inFlight.current) return
    inFlight.current = true
    setActionError(null)
    setBusy('express')
    const identityIsCurrent = captureIdentityLifetime(queryClient, userId)
    const isCurrent = () => mounted.current && identityIsCurrent()
    try {
      const url = await getExpressLoginUrl(userId, isCurrent)
      if (isCurrent()) window.location.assign(url)
    } catch {
      if (isCurrent()) { setActionError('express'); restoreFocus.current = true }
    } finally {
      inFlight.current = false
      if (isCurrent()) setBusy(null)
    }
  }

  const status = connectQuery.data
  const hasError = actionError !== null || connectQuery.isError || (!connectQuery.isPending && !status)
  const isTransition = !hasError && status?.status === 'not_started' && step === 'transition'
  const isInterrupted = status?.status === 'not_started' && step === 'interrupted'
  const copy = hasError ? statusCopy.error
    : isInterrupted ? statusCopy.interrupted
      : status && status.status !== 'not_started' ? statusCopy[status.status] : null
  const accountLabel = hasError ? 'Status unavailable' : status?.status === 'ready' ? 'Ready'
    : status?.status === 'not_started' && !isInterrupted ? 'Not connected' : 'Setup incomplete'
  // The safe public projection exposes aggregate readiness, not independent
  // capability flags. Never infer either capability from incomplete setup.
  const capabilityLabel = hasError ? 'Unavailable' : status?.status === 'ready' ? 'Enabled'
    : status?.status === 'pending' ? 'Awaiting confirmation'
      : status?.status === 'not_started' ? 'Not enabled' : 'Setup incomplete'
  const retry = () => {
    if (actionError === 'express') void openExpressLogin()
    else if (actionError === 'embedded' || actionError === 'session') void openEmbeddedPanel()
    else void refreshOverview()
  }

  return (
    <PaymentsSettingsPanel>
      {connectQuery.isPending || (eventId !== undefined && connectQuery.isFetching) || busy === 'refresh' ? (
        <AsyncState status="loading" title={busy === 'refresh' ? 'Checking your Stripe status' : 'Loading payment setup'} />
      ) : embeddedSession ? (
        <div className="payments-settings__embedded">
          <p className="payments-settings__intro">Complete your details securely with Stripe.</p>
          <ConnectEmbeddedPanel
            initialSession={embeddedSession}
            mode={embeddedSession.status.status === 'ready' ? 'management' : 'onboarding'}
            onExit={() => void refreshOverview(true)}
            onLoadError={handleEmbeddedLoadError}
            refreshAccountSession={async () => {
              if (!mounted.current) throw new Error('Organizer session ended')
              const next = await accountSessionMutation.mutateAsync(userId)
              if (!mounted.current) throw new Error('Organizer session ended')
              return next
            }}
          />
        </div>
      ) : (
        <section className="payments-settings__account" aria-label="Stripe account">
          <div className="payments-settings__account-header">
            <span className="payments-settings__stripe">stripe</span>
            <span className={`payments-settings__badge${!hasError && status?.status === 'ready' ? ' payments-settings__badge--ready' : ''}`}>{accountLabel}</span>
          </div>
          <ul className="payments-settings__capabilities" aria-label="Payment capabilities">
            {['Accept payments', 'Receive payouts'].map(label => <li key={label}>
              <span>{label}</span><strong>{capabilityLabel}</strong>
            </li>)}
          </ul>
          {copy ? (
            <section aria-labelledby="payout-status-title" className={`payments-settings__status payments-settings__status--${copy.tone}`}>
              <div aria-live="polite" role={hasError ? 'alert' : undefined}>
                <h3 id="payout-status-title">{copy.title}</h3>
                <p className="payments-settings__intro">{copy.description}</p>
              </div>
              <div className="payments-settings__actions">
                {hasError ? <Button disabled={busy !== null} onClick={retry} ref={actionRef}>{busy === 'session' ? 'Opening secure setup…' : busy === 'express' ? 'Opening Stripe Express…' : 'Try again'}</Button>
                  : status?.status === 'ready' ? <>
                    <Button disabled={busy !== null} onClick={() => void openExpressLogin()}>{busy === 'express' ? 'Opening Stripe Express…' : 'Manage in Stripe'}</Button>
                    <Button disabled={busy !== null} onClick={() => void openEmbeddedPanel()} ref={actionRef} variant="secondary">{busy === 'session' ? 'Opening secure setup…' : 'Manage payment details'}</Button>
                    {eventId ? <Button disabled={busy !== null} onClick={() => void returnToEvent()} variant="secondary">Return to event</Button> : <Link className="payments-settings__link" to="/organizer/events/new">Create your first event</Link>}
                    <Link className="payments-settings__link" to="/organizer/events">Go to dashboard</Link>
                  </> : status?.status === 'pending' ? <>
                    <Button disabled={busy !== null} onClick={() => void refreshOverview()} ref={actionRef}>Refresh status</Button>
                    <Button disabled={busy !== null} onClick={() => void openEmbeddedPanel()} variant="secondary">{busy === 'session' ? 'Opening secure setup…' : 'Continue with Stripe'}</Button>
                    {eventId ? laterAction : <Link className="payments-settings__link" to="/organizer/events">Go to dashboard</Link>}
                  </> : <>
                    <Button disabled={busy !== null} onClick={() => void openEmbeddedPanel(isInterrupted)} ref={actionRef}>{busy === 'session' ? 'Opening secure setup…' : isInterrupted ? 'Continue setup' : 'Review with Stripe'}</Button>
                    {laterAction}
                  </>}
                {hasError ? <Link className="payments-settings__link" to="/organizer/events">Go to dashboard</Link> : null}
              </div>
            </section>
          ) : isTransition ? (
            <section aria-labelledby="stripe-transition-title" className="payments-settings__overview payments-settings__overview--transition">
              <button className="payments-settings__link payments-settings__back" onClick={() => { setStep('overview'); restoreFocus.current = true }} type="button">← Back to payout overview</button>
              <h3 id="stripe-transition-title">You’re almost there</h3>
              <p className="payments-settings__intro">Continue to secure Stripe onboarding to complete your payout setup. Stripe collects your business details, verifies your identity, and sets up how you get paid.</p>
              <Button disabled={busy !== null} onClick={() => void openEmbeddedPanel()} ref={actionRef}>{busy === 'session' ? 'Opening secure setup…' : 'Continue with Stripe'}</Button>
            </section>
          ) : (
            <section aria-labelledby="payouts-intro-title" className="payments-settings__overview">
              <h3 id="payouts-intro-title">Secure payouts with Stripe</h3>
              <p className="payments-settings__intro">Stripe handles your payment setup, identity verification, and bank details.</p>
              <div className="payments-settings__actions">
                <Button onClick={() => { setStep('transition'); restoreFocus.current = true }} ref={actionRef}>Set up payouts</Button>
                {laterAction}
              </div>
              <p className="payments-settings__note">You can create drafts and free events while you finish setting up payouts.</p>
            </section>
          )}
          <p className="payments-settings__trust"><OnboardingIcon kind="lock" />Your sensitive payment and bank information is handled securely by Stripe.</p>
        </section>
      )}
    </PaymentsSettingsPanel>
  )
}

function OwnedEventPayments({ userId, eventId }: { userId: string; eventId: string }) {
  const eventQuery = useQuery({
    queryKey: eventKeys.detail(userId, eventId),
    queryFn: () => getOwnedEvent(eventId, userId),
    staleTime: 0,
    refetchOnMount: 'always',
  })
  const isOwned = (event: typeof eventQuery.data) => event?.id === eventId && event.organizer_id === userId && event.status !== 'cancelled'
  if (eventQuery.isPending || eventQuery.isFetching) return <AsyncState status="loading" title="Checking your event" />
  if (eventQuery.isError) return <AsyncState status="error" title="Your event could not be checked" action={<Button onClick={() => void eventQuery.refetch()}>Try again</Button>} />
  if (!isOwned(eventQuery.data)) return <AsyncState status="empty" title="Event unavailable" action={<Link to="/organizer/events">My events</Link>} />
  return <OrganizerPaymentsJourney userId={userId} eventId={eventId} verifyEvent={async () => {
    // Recheck ownership before resuming; this never saves or publishes an event.
    const event = await getOwnedEvent(eventId, userId)
    if (!isOwned(event)) throw new Error('Event unavailable')
  }} />
}

export function OrganizerPaymentsPage() {
  const [searchParams] = useSearchParams()
  const eventId = searchParams.get('eventId')
  const sessionState = useSession()
  const signOut = useOptionalSignOut()
  if (sessionState.status !== 'authenticated' || signOut?.pending) {
    return <PaymentsSettingsPanel><AsyncState status="loading" title="Loading payment setup" /></PaymentsSettingsPanel>
  }
  if (eventId !== null) {
    if (!z.uuid().safeParse(eventId).success) return <AsyncState status="empty" title="Event unavailable" action={<Link to="/organizer/events">My events</Link>} />
    return <OwnedEventPayments key={`${sessionState.user.id}:${sessionState.identityVersion ?? 0}:${eventId}`} userId={sessionState.user.id} eventId={eventId} />
  }
  // Remount local journey state on identity changes so neither secrets nor late
  // asynchronous results can cross between organizers.
  return <OrganizerPaymentsJourney key={`${sessionState.user.id}:${sessionState.identityVersion ?? 0}`} userId={sessionState.user.id} />
}
