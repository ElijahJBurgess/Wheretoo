import { useCallback, useLayoutEffect, useRef, useState } from 'react'
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
import { OnboardingIcon, OnboardingLayout, OnboardingProgress, StripeArtwork, type OnboardingIconKind } from '../organizer-onboarding/OnboardingLayout'
import { getExpressLoginUrl, type ConnectAccountSession } from './payment.api'
import { ConnectEmbeddedPanel } from './ConnectEmbeddedPanel'
import { useConnectAccountSession, useConnectStatus } from './payment.queries'
import type { ConnectStatus } from './payment.types'

type JourneyStep = 'overview' | 'transition' | 'interrupted'
type ActionError = 'session' | 'embedded' | 'express' | 'status'

const statusCopy = {
  pending: { label: 'Verification Pending', title: 'Stripe is reviewing your details', description: 'Your payment setup is pending with Stripe. Paid ticket sales will be available once verification is complete and your account is ready.', icon: 'clock', tone: 'pending' },
  action_required: { label: 'Action Required', title: 'Action required in Stripe', description: 'Stripe needs more information to complete your account setup. Review your details securely with Stripe to continue.', icon: 'alert', tone: 'danger' },
  restricted: { label: 'Action Required', title: 'Payment setup needs an update', description: 'Your Stripe account needs attention before you can sell paid tickets. Open Stripe to review and update your details.', icon: 'alert', tone: 'danger' },
  ready: { label: 'Payouts Connected', title: 'You’re all set!', description: 'Stripe is connected and your payouts are ready.', icon: 'check', tone: 'success' },
  interrupted: { label: 'Onboarding Interrupted', title: 'Setup not completed', description: 'You started setting up your payouts with Stripe but didn’t finish. Pick up where you left off to start accepting payments.', icon: 'pause', tone: 'neutral' },
  error: { label: 'Stripe Connection Error', title: 'Something went wrong', description: 'We couldn’t connect to Stripe. Check your connection and try again.', icon: 'error', tone: 'danger' },
} satisfies Record<string, { label: string; title: string; description: string; icon: OnboardingIconKind; tone: string }>

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
    : <Link className="onboarding__text-link" to="/organizer/events">Do this later</Link>

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
  const pageTitle = embeddedSession ? 'Secure Stripe Setup'
    : isTransition ? 'Continue to Stripe' : copy?.label ?? 'Set Up Payouts'
  const retry = () => {
    if (actionError === 'express') void openExpressLogin()
    else if (actionError === 'embedded' || actionError === 'session') void openEmbeddedPanel()
    else void refreshOverview()
  }

  return (
    <OnboardingLayout
      backTo={isTransition ? undefined : returnPath}
      onBack={isTransition ? () => { setStep('overview'); restoreFocus.current = true } : undefined}
      title={pageTitle}
      wide={embeddedSession !== null}
    >
      {connectQuery.isPending || (eventId !== undefined && connectQuery.isFetching) || busy === 'refresh' ? (
        <AsyncState status="loading" title={busy === 'refresh' ? 'Checking your Stripe status' : 'Loading payment setup'} />
      ) : embeddedSession ? (
        <div className="onboarding-stripe">
          <p className="onboarding__intro">Complete your details securely with Stripe.</p>
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
      ) : copy ? (
        <section aria-labelledby="payout-status-title" className={`onboarding-status onboarding-status--${copy.tone}`}>
          <div aria-hidden="true" className="onboarding-status__symbol"><OnboardingIcon kind={copy.icon} /></div>
          <div aria-live="polite" role={hasError ? 'alert' : undefined}>
            <h1 id="payout-status-title">{copy.title}</h1>
            <p className="onboarding__intro">{copy.description}</p>
          </div>
          {!hasError && status?.status === 'ready' ? (
            <ul className="onboarding-status__checks">
              {['Payments enabled', 'Payouts configured', 'Ready to sell tickets'].map(label => <li key={label}><OnboardingIcon kind="check" />{label}</li>)}
            </ul>
          ) : !hasError && status?.status === 'pending' ? (
            <p className="onboarding__trust"><OnboardingIcon kind="lock" />Payments and payouts become available once Stripe confirms your account is ready.</p>
          ) : null}
          <div className="onboarding__actions">
            {hasError ? <Button disabled={busy !== null} onClick={retry} ref={actionRef}>{busy === 'session' ? 'Opening secure setup…' : busy === 'express' ? 'Opening Stripe Express…' : 'Try again'}</Button>
              : status?.status === 'ready' ? <>
                {eventId ? <Button disabled={busy !== null} onClick={() => void returnToEvent()}>Return to event</Button> : <Link className="ui-button ui-button--primary" to="/organizer/events/new">Create your first event</Link>}
                <Link className="onboarding__text-link" to="/organizer/events">Go to dashboard</Link>
                <div className="onboarding__management">
                  <Button disabled={busy !== null} onClick={() => void openEmbeddedPanel()} ref={actionRef} variant="secondary">{busy === 'session' ? 'Opening secure setup…' : 'Manage payment details'}</Button>
                  <Button disabled={busy !== null} onClick={() => void openExpressLogin()} variant="secondary">{busy === 'express' ? 'Opening Stripe Express…' : 'Open Stripe Express'}</Button>
                </div>
              </> : status?.status === 'pending' ? <>
                <Button disabled={busy !== null} onClick={() => void refreshOverview()} ref={actionRef}>Refresh status</Button>
                <Button disabled={busy !== null} onClick={() => void openEmbeddedPanel()} variant="secondary">{busy === 'session' ? 'Opening secure setup…' : 'Continue with Stripe'}</Button>
                {eventId ? laterAction : <Link className="onboarding__text-link" to="/organizer/events">Go to dashboard</Link>}
              </> : <>
                <Button disabled={busy !== null} onClick={() => void openEmbeddedPanel(isInterrupted)} ref={actionRef}>{busy === 'session' ? 'Opening secure setup…' : isInterrupted ? 'Continue setup' : 'Review with Stripe'}</Button>
                {laterAction}
              </>}
            {hasError ? <Link className="onboarding__text-link" to="/organizer/events">Go to dashboard</Link> : null}
          </div>
        </section>
      ) : isTransition ? (
        <section aria-labelledby="stripe-transition-title" className="onboarding-payouts onboarding-payouts--transition">
          <StripeArtwork transition />
          <h1 id="stripe-transition-title">You’re almost there</h1>
          <p className="onboarding__intro">Continue to secure Stripe onboarding to complete your payout setup. Stripe collects your business details, verifies your identity, and sets up how you get paid.</p>
          <p className="onboarding__trust"><OnboardingIcon kind="lock" />Your sensitive information is handled securely by Stripe.</p>
          <Button disabled={busy !== null} onClick={() => void openEmbeddedPanel()} ref={actionRef}>{busy === 'session' ? 'Opening secure setup…' : 'Continue with Stripe'}</Button>
        </section>
      ) : (
        <section aria-labelledby="payouts-intro-title" className="onboarding-payouts">
          <OnboardingProgress step={3} />
          <StripeArtwork />
          <h1 id="payouts-intro-title">Secure payouts<br /> with Stripe</h1>
          <ul className="onboarding-payouts__benefits">
            {['Accept payments for your events', 'Get paid securely', 'Stripe handles sensitive payment information'].map(label => <li key={label}><OnboardingIcon kind="check" />{label}</li>)}
          </ul>
          <p className="onboarding__intro">wheretoo partners with Stripe to handle payments and payouts securely.</p>
          <div className="onboarding__actions">
            <Button onClick={() => { setStep('transition'); restoreFocus.current = true }} ref={actionRef}>Set up payouts</Button>
            {laterAction}
          </div>
          <p className="onboarding__note">You can create drafts and free events while you finish setting up payouts.</p>
        </section>
      )}
    </OnboardingLayout>
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
    return <OnboardingLayout title="Set Up Payouts"><AsyncState status="loading" title="Loading payment setup" /></OnboardingLayout>
  }
  if (eventId !== null) {
    if (!z.uuid().safeParse(eventId).success) return <AsyncState status="empty" title="Event unavailable" action={<Link to="/organizer/events">My events</Link>} />
    return <OwnedEventPayments key={`${sessionState.user.id}:${sessionState.identityVersion ?? 0}:${eventId}`} userId={sessionState.user.id} eventId={eventId} />
  }
  // Remount local journey state on identity changes so neither secrets nor late
  // asynchronous results can cross between organizers.
  return <OrganizerPaymentsJourney key={`${sessionState.user.id}:${sessionState.identityVersion ?? 0}`} userId={sessionState.user.id} />
}
