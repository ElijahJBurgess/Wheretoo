import { usePublicEventImages } from '../event-images/publicEventImages'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { TicketDeliveryNotice } from '../ticket-delivery/TicketDeliveryNotice'
import { CheckoutReview } from '../buyer-journey/CheckoutReview'
import { BuyerHeader, BuyerIcon } from '../buyer-journey/BuyerPrimitives'
import { BuyerRecoveryView } from '../buyer-journey/BuyerRecoveryView'
import { OrderConfirmationView } from '../buyer-journey/OrderConfirmationView'
import { AsyncState } from '../../components/ui/AsyncState'
import { ReadState } from '../../components/ui/ReadState'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { FormErrorSummary } from '../../components/ui/FormErrorSummary'
import { lowercaseRfcUuidSchema } from '../tickets/ticket.schemas'
import { clearCheckoutAttemptForConfirmation, getStoredCheckoutAttempt, getVerifiedCheckoutAssociation, isCanonicalCheckoutBearer } from './checkout.attempt'
import { isStripeCheckoutUrl } from './checkout.api'
import { checkoutSelectionPath, parseCheckoutCart } from './checkout.cart'
import { checkoutCanonicalSubmissionSchema, type CheckoutCanonicalSubmission } from './checkout.schemas'
import { useOrderConfirmation } from '../orders/order.queries'
import type { OrderConfirmation } from '../orders/order.types'
import { useCheckoutPublicEvent } from './checkout.queries'
import { cancelCheckoutAttempt, checkCheckoutAttempt, releaseRejectedCheckoutAttempt, submitCheckoutAttempt, type CheckoutRecoveryResult } from './checkout.recovery'

function assignHostedCheckout(url: string): void { window.location.assign(url) }

export function CheckoutState({ action, description, status, title, read = false, paused }: {
  paused?: boolean; read?: boolean; action?: ReactNode; description?: string; status: 'loading' | 'empty' | 'error'; title: string
}) {
  const State = read ? ReadState : AsyncState
  return <main className="buyer-page buyer-state"><BuyerHeader /><h1 className="checkout-state__title">{title}</h1>
    <State {...(read ? { paused } : {})} skeleton={read ? "detail-fields" : undefined} action={action} description={description} status={status} title={status === 'loading' ? 'Please wait' : 'What you can do'} />
  </main>
}

type CheckoutPageProps = { assignCheckout?: (checkoutUrl: string) => void }

export function CheckoutPage(props: CheckoutPageProps) {
  const location = useLocation()
  const { eventId = '' } = useParams()
  // Reject the URL before mounting any attempt recovery or cancellation effects.
  if (!lowercaseRfcUuidSchema.safeParse(eventId).success) {
    return <CheckoutState status="error" title="Checkout unavailable" description="Open the original event link to continue. This checkout link is incomplete or invalid." />
  }
  return <CheckoutRoute {...props} key={`${location.pathname}:${location.search}`} />
}

function CheckoutRoute({ assignCheckout = assignHostedCheckout }: CheckoutPageProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { eventId: routeEventId = '' } = useParams()
  const eventIdResult = lowercaseRfcUuidSchema.safeParse(routeEventId)
  const eventId = eventIdResult.success ? eventIdResult.data : ''
  const cancelToken = new URLSearchParams(location.search).get('cancel')
  const eventQuery = useCheckoutPublicEvent(eventId)
  const images = usePublicEventImages(eventId ? [eventId] : [])
  const verifiedEventId = eventQuery.data?.event.id === eventId ? eventId : null
  const routeItems = parseCheckoutCart(location.search)
  const [buyerName, setBuyerName] = useState('')
  const [buyerEmail, setBuyerEmail] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ buyerName?: string; buyerEmail?: string }>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(cancelToken !== null)
  const [recovery, setRecovery] = useState<CheckoutRecoveryResult | null>(() => {
    if (!eventId || cancelToken !== null) return null
    try {
      const stored = getStoredCheckoutAttempt(eventId)
      return stored && stored.lifecycle !== 'prepared' ? { kind: stored.lifecycle === 'rejected' ? stored.rejectionKind ?? 'stock' : 'unknown', bearer: stored.confirmationBearer } : null
    } catch { return { kind: 'unknown' } }
  })
  const [enterOriginal, setEnterOriginal] = useState(false)
  const active = useRef(true)
  const lock = useRef(false)
  const cancellation = useRef<Promise<CheckoutRecoveryResult> | null>(null)
  const [submission, setSubmission] = useState<CheckoutCanonicalSubmission | null>(null)
  const buyerNameRef = useRef<HTMLInputElement>(null)
  const buyerEmailRef = useRef<HTMLInputElement>(null)
  const [savedAssociation, setSavedAssociation] = useState(() => {
    const bearer = cancelToken ?? recovery?.bearer
    return bearer ? getVerifiedCheckoutAssociation(bearer) : null
  })
  const association = savedAssociation ?? (recovery?.bearer ? getVerifiedCheckoutAssociation(recovery.bearer) : null)
  const items = routeItems ?? (cancelToken && association ? parseCheckoutCart(association.selectionPath.split('?')[1] ?? '') : null)
  const eventPath = association ? `/events/${association.eventId}` : verifiedEventId ? `/events/${verifiedEventId}` : null
  const selectionPath = association?.selectionPath ?? (verifiedEventId && items ? checkoutSelectionPath(verifiedEventId, items) : null)

  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useLayoutEffect(() => {
    if (fieldErrors.buyerName) buyerNameRef.current?.focus()
    else if (fieldErrors.buyerEmail) buyerEmailRef.current?.focus()
  }, [fieldErrors])
  useEffect(() => {
    if (cancelToken === null) return
    cancellation.current ??= isCanonicalCheckoutBearer(cancelToken) ? cancelCheckoutAttempt(cancelToken) : Promise.resolve({ kind: 'unknown' })
    let current = true
    void cancellation.current.then((result) => { if (current) { setRecovery(result); setBusy(false) } })
    return () => { current = false }
  }, [cancelToken])

  async function run(operation: () => Promise<CheckoutRecoveryResult>) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setServerError(null)
    if (association) setSavedAssociation(association)
    try {
      const result = await operation()
      if (!active.current) return
      if (result.bearer) {
        const confirmedAssociation = getVerifiedCheckoutAssociation(result.bearer)
        if (confirmedAssociation) setSavedAssociation(confirmedAssociation)
      }
      if (result.kind === 'hosted' && isStripeCheckoutUrl(result.checkoutUrl)) assignCheckout(result.checkoutUrl)
      else {
        setRecovery(result.kind === 'hosted' ? { kind: 'unknown', bearer: result.bearer } : result)
        setEnterOriginal(false)
        if (result.kind === 'stock' || result.kind === 'unavailable') void eventQuery.refetch()
      }
    } catch (error) {
      if (active.current) setServerError(error instanceof Error ? error.message : 'Unable to confirm checkout. Keep your original checkout link.')
    } finally {
      lock.current = false
      if (active.current) setBusy(false)
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (lock.current || !verifiedEventId || !items) return
    const validation = checkoutCanonicalSubmissionSchema.safeParse({ eventId, buyerName, buyerEmail, items })
    if (!validation.success) {
      const errors: { buyerName?: string; buyerEmail?: string } = {}
      for (const issue of validation.error.issues) {
        if (issue.path[0] === 'buyerName') errors.buyerName = 'Enter your name'
        if (issue.path[0] === 'buyerEmail') errors.buyerEmail = 'Enter a valid email address'
      }
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})
    setSubmission(validation.data)
    await run(() => submitCheckoutAttempt(validation.data, verifiedEventId, enterOriginal, recovery?.bearer))
  }

  const retryStatus = recovery?.bearer ? <Button disabled={busy} onClick={() => void run(() => checkCheckoutAttempt(recovery.bearer!))} type="button">{busy ? 'Checking status…' : 'Check status'}</Button> : null
  const returnAction = eventPath ? <Link className="ui-button ui-button--secondary" to={eventPath}>Return to event</Link> : null
  if (cancelToken !== null && recovery === null) return <BuyerRecoveryView title="Cancelling checkout" description="Please wait while we confirm the result. Your checkout is still being checked." busy />
  if (recovery && !enterOriginal) {
    if (recovery.kind === 'order') {
      return <CheckoutRecoveredOrder bearer={recovery.bearer} initialOrder={recovery.order} busy={busy} error={serverError}
        canVerify={eventPath !== null} hasSubmission={submission !== null}
        onReplay={() => {
          if (submission && verifiedEventId) void run(() => submitCheckoutAttempt(submission, verifiedEventId, true, recovery.bearer))
          else setEnterOriginal(true)
        }}
        onCancel={() => void run(() => cancelCheckoutAttempt(recovery.bearer))} />
    }
    if (recovery.kind === 'cancelled') return <BuyerRecoveryView tone="neutral" title="Checkout cancelled" description="Cancellation is confirmed. You can review availability and choose tickets again." action={selectionPath ? <Link className="ui-button" to={selectionPath}>Choose tickets</Link> : returnAction} secondaryAction={selectionPath ? returnAction : null} />
    if (recovery.kind === 'stock' || recovery.kind === 'unavailable') return <BuyerRecoveryView tone={recovery.kind === 'stock' ? 'failure' : 'unknown'} title={recovery.kind === 'stock' ? 'Tickets no longer available' : 'Tickets unavailable'} description="Your selection could not be reserved. Review availability before changing your tickets." action={selectionPath ? <Button disabled={busy} onClick={() => {
      if (releaseRejectedCheckoutAttempt(recovery.bearer)) navigate(selectionPath)
      else setServerError('Unable to release this checkout. Keep your original checkout link.')
    }} type="button">Edit selection</Button> : null}>
      {items ? <ul className="buyer-recovery__selection" aria-label="Your selected tickets">{items.map((item) => <li key={item.tierId}>{eventQuery.data?.tiers.find((tier) => tier.id === item.tierId)?.name ?? 'Unavailable ticket'} × {item.quantity}</li>)}</ul> : null}
      {serverError ? <p role="alert">{serverError}</p> : null}</BuyerRecoveryView>
    return <BuyerRecoveryView title="Unable to confirm payment" description={cancelToken ? 'We could not confirm cancellation. Keep this checkout and check its status before trying anything else.' : 'We cannot confirm the result yet. Keep this checkout and check its status before trying anything else.'} busy={busy} action={retryStatus}>{serverError ? <p role="alert">{serverError}</p> : null}</BuyerRecoveryView>
  }
  if (!eventIdResult.success) return <CheckoutState status="error" title="Checkout could not load" description="This event link is invalid." />
  if ((eventQuery.isPending || eventQuery.data === undefined) && !eventQuery.isError) return <CheckoutState read paused={eventQuery.fetchStatus === 'paused'} status="loading" title="Loading checkout" />
  if (eventQuery.isError || !eventQuery.data || !verifiedEventId) return <CheckoutState status="error" title="Checkout could not load" description="Check your connection, then try again." action={<Button onClick={() => void eventQuery.refetch()} type="button">Try again</Button>} />
  const publicData = eventQuery.data
  const selected = items?.map((item) => ({ ...item, tier: publicData.tiers.find((tier) => tier.id === item.tierId) })) ?? []
  const snapshot = recovery?.kind === 'order' ? recovery.order : null
  if (!items || (!snapshot && selected.some((line) => !line.tier || line.tier.availability_status !== 'available'))) return <BuyerRecoveryView title="Review your selection" description="Availability changed. Your full selection is kept here so you can review it before making changes." action={selectionPath ? <Link className="ui-button" to={selectionPath}>Edit selection</Link> : returnAction}>
    <ul className="buyer-recovery__selection">{selected.map((line) => <li key={line.tierId}>{line.tier?.name ?? 'Unavailable ticket'} × {line.quantity}</li>)}</ul>
  </BuyerRecoveryView>
  const lines = snapshot ? snapshot.items.map((item) => ({ name: item.tierName, quantity: item.quantity, unitAmountMinor: item.unitAmountMinor })) : selected.map((line) => ({ name: line.tier!.name, quantity: line.quantity, unitAmountMinor: line.tier!.unit_amount_minor }))
  const total = snapshot?.totalMinor ?? lines.reduce((sum, line) => sum + line.quantity * line.unitAmountMinor, 0)
  const errors = [fieldErrors.buyerName, fieldErrors.buyerEmail, serverError].filter((value): value is string => Boolean(value))
  return <CheckoutReview artwork={images.data?.find(image => image.position === 1)?.url ?? null} event={eventQuery.data.event} lines={lines} totalMinor={total}
    back={returnAction ? <Link className="buyer-icon-button" aria-label="Return to event" to={eventPath!}><BuyerIcon name="back" /></Link> : null}
    editSelection={!recovery && selectionPath ? <Link to={selectionPath}>Edit selection</Link> : null}>
    <form className="buyer-checkout-form" noValidate onSubmit={(event) => void submit(event)}>
      <section className="buyer-details" aria-labelledby="buyer-details-heading"><h2 id="buyer-details-heading">{enterOriginal ? 'Re-enter the original buyer details' : 'Buyer details'}</h2>
        <FormErrorSummary errors={errors} title="Check your details" /><div className="buyer-details__fields">
          <Field error={fieldErrors.buyerName} label="Your name" name="buyer-name"><input autoComplete="name" disabled={busy} onChange={(event) => setBuyerName(event.target.value)} ref={buyerNameRef} value={buyerName} /></Field>
          <Field error={fieldErrors.buyerEmail} label="Email address" name="buyer-email"><input autoComplete="email" disabled={busy} inputMode="email" onChange={(event) => setBuyerEmail(event.target.value)} ref={buyerEmailRef} type="email" value={buyerEmail} /></Field>
        </div></section>
      <Button disabled={busy} type="submit">{busy ? 'Opening secure payment…' : enterOriginal ? 'Retry same checkout' : 'Continue to secure payment'}</Button>
    </form>
  </CheckoutReview>
}

function CheckoutRecoveredOrder({ bearer, initialOrder, busy, error, canVerify, hasSubmission, onReplay, onCancel }: {
  bearer: string; initialOrder: OrderConfirmation; busy: boolean; error: string | null; canVerify: boolean; hasSubmission: boolean; onReplay: () => void; onCancel: () => void
}) {
  const confirmation = useOrderConfirmation(bearer)
  const confirmedStatus = confirmation.data?.status
  useEffect(() => {
    if (confirmedStatus === 'paid' || confirmedStatus === 'refunded') clearCheckoutAttemptForConfirmation(bearer)
  }, [bearer, confirmedStatus])
  const checking = busy || confirmation.isFetching || confirmation.isPending
  const order = confirmation.data ?? initialOrder
  const retry = <Button disabled={checking} onClick={() => void confirmation.retry()} type="button">{checking ? 'Checking status…' : 'Check status'}</Button>
  if (confirmation.isError || confirmation.data === null) return <BuyerRecoveryView title="Unable to confirm payment" description="The latest result is unknown. Keep this checkout and check its status before trying anything else." busy={checking} action={retry} />
  return <OrderConfirmationView order={order} isTimedOut={confirmation.isTimedOut}
    deliveryNotice={order.status === 'paid' ? <TicketDeliveryNotice collectionBearer={bearer} /> : undefined}
    ticketAction={<Link className="ui-button buyer-primary" reloadDocument to={`/tickets/${encodeURIComponent(bearer)}`}>View tickets</Link>}
    retryAction={retry}
    recoveryAction={<>
      {error ? <p role="alert">{error}</p> : null}
      {order.status === 'processing' ? <>
        <Button disabled={checking} onClick={onReplay} type="button">{checking ? 'Checking status…' : hasSubmission ? 'Retry same checkout' : 'Re-enter original details'}</Button>
      </> : null}
      {canVerify && ['payment_failed', 'cancelled', 'expired'].includes(order.status) ? <Button disabled={checking} onClick={onCancel} type="button">{checking ? 'Verifying checkout…' : 'Verify before choosing tickets'}</Button> : null}
    </>} />
}
