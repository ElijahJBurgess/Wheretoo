import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AsyncState } from '../../components/ui/AsyncState'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { FormErrorSummary } from '../../components/ui/FormErrorSummary'
import { lowercaseRfcUuidSchema } from '../tickets/ticket.schemas'
import { cancelCheckout, createCheckout, isStripeCheckoutUrl } from './checkout.api'
import type { CheckoutApiErrorCode } from './checkout.api'
import { checkoutInputSchema } from './checkout.schemas'
import { useCheckoutPublicEvent } from './checkout.queries'

const cancellationTokenPattern = /^[A-Za-z0-9_-]{43}$/

const checkoutErrorCopy: Record<CheckoutApiErrorCode, string> = {
  CHECKOUT_EXPIRED: 'This checkout window expired. Choose your ticket again.',
  CHECKOUT_NOT_FOUND: 'This checkout is no longer available. Choose your ticket again.',
  CHECKOUT_UNAVAILABLE: 'Secure checkout is unavailable right now. Try again.',
  CONNECT_ACTION_REQUIRED: 'Ticket sales are temporarily unavailable. Try again later.',
  CONNECT_NOT_READY: 'Ticket sales are temporarily unavailable. Try again later.',
  EVENT_NOT_FOUND: 'This event is no longer available.',
  EVENT_NOT_SELLABLE: 'Tickets are currently unavailable for this event.',
  RATE_LIMITED: 'Too many checkout attempts. Wait a moment, then try again.',
  TIER_NOT_ACTIVE: 'This ticket is no longer available. Choose another ticket.',
  TIER_NOT_FOUND: 'This ticket is no longer available. Choose another ticket.',
  TIER_SOLD_OUT: 'This ticket just sold out. Choose another ticket.',
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    const code = error.code as CheckoutApiErrorCode
    if (Object.hasOwn(checkoutErrorCopy, code)) return checkoutErrorCopy[code]
  }
  return checkoutErrorCopy.CHECKOUT_UNAVAILABLE
}

function shouldRefreshAvailability(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null
  return code === 'TIER_SOLD_OUT' || code === 'TIER_NOT_ACTIVE' || code === 'TIER_NOT_FOUND' ||
    code === 'EVENT_NOT_SELLABLE' || code === 'EVENT_NOT_FOUND' || code === 'CONNECT_NOT_READY' ||
    code === 'CONNECT_ACTION_REQUIRED' || code === 'RATE_LIMITED' || code === 'CHECKOUT_EXPIRED'
}

function formatMinorUsd(minor: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100)
}

function publicEventPath(eventId: string): string {
  return `/events/${eventId}`
}

function assignHostedCheckout(checkoutUrl: string): void {
  window.location.assign(checkoutUrl)
}

type CheckoutStateProps = {
  action: ReactNode
  description?: string
  status: 'loading' | 'empty' | 'error'
  title: string
}

export function CheckoutState({ action, description, status, title }: CheckoutStateProps) {
  return (
    <main className="checkout-layout">
      <h1 className="checkout-state__title">{title}</h1>
      <AsyncState
        action={action}
        description={description}
        status={status}
        title={status === 'loading' ? 'Please wait' : 'What you can do'}
      />
    </main>
  )
}

type CheckoutPageProps = {
  assignCheckout?: (checkoutUrl: string) => void
}

export function CheckoutPage({ assignCheckout = assignHostedCheckout }: CheckoutPageProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { eventId: routeEventId = '' } = useParams()
  const eventIdResult = lowercaseRfcUuidSchema.safeParse(routeEventId)
  const eventId = eventIdResult.success ? eventIdResult.data : ''
  const cancelToken = new URLSearchParams(location.search).get('cancel')
  const tierIdResult = lowercaseRfcUuidSchema.safeParse(new URLSearchParams(location.search).get('tier') ?? '')
  const tierId = tierIdResult.success ? tierIdResult.data : ''
  const eventQuery = useCheckoutPublicEvent(eventId)
  const [buyerName, setBuyerName] = useState('')
  const [buyerEmail, setBuyerEmail] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ buyerName?: string; buyerEmail?: string }>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const mountedRef = useRef(false)
  const submissionLockRef = useRef(false)
  const focusInvalidRef = useRef(false)
  const buyerNameRef = useRef<HTMLInputElement>(null)
  const buyerEmailRef = useRef<HTMLInputElement>(null)
  const routeKeyRef = useRef(location.key)
  const cancellationRef = useRef<{ token: string; promise: Promise<void> } | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useLayoutEffect(() => {
    routeKeyRef.current = location.key
  }, [location.key])

  useLayoutEffect(() => {
    if (!focusInvalidRef.current) return
    if (fieldErrors.buyerName) buyerNameRef.current?.focus()
    else if (fieldErrors.buyerEmail) buyerEmailRef.current?.focus()
    focusInvalidRef.current = false
  }, [fieldErrors])

  useEffect(() => {
    if (cancelToken === null) return
    if (!eventIdResult.success) {
      navigate('/', { replace: true })
      return
    }

    const token = cancelToken
    const cancellation = cancellationRef.current?.token === token
      ? cancellationRef.current
      : {
        token,
        promise: cancellationTokenPattern.test(token) ? cancelCheckout(token) : Promise.resolve(),
      }
    cancellationRef.current = cancellation
    void cancellation.promise.catch(() => undefined)
    navigate(publicEventPath(eventId), { replace: true })
  }, [cancelToken, eventId, eventIdResult.success, navigate])

  useEffect(() => {
    if (cancelToken !== null || !eventIdResult.success) return
    if (!tierIdResult.success || (eventQuery.data !== undefined && (
      eventQuery.data === null || !eventQuery.data.tiers.some((tier) => tier.id === tierId && tier.availability_status === 'available')
    ))) {
      navigate(eventId ? publicEventPath(eventId) : '/', { replace: true })
    }
  }, [cancelToken, eventId, eventIdResult.success, eventQuery.data, navigate, tierId, tierIdResult.success])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submissionLockRef.current || !eventIdResult.success || !tierIdResult.success) return
    const validation = checkoutInputSchema.omit({ clientRequestId: true }).safeParse({
      eventId,
      tierId,
      buyerName,
      buyerEmail,
      quantity: 1,
    })
    if (!validation.success) {
      const errors: { buyerName?: string; buyerEmail?: string } = {}
      for (const issue of validation.error.issues) {
        if (issue.path[0] === 'buyerName') errors.buyerName = 'Enter your name'
        if (issue.path[0] === 'buyerEmail') errors.buyerEmail = 'Enter a valid email address'
      }
      focusInvalidRef.current = true
      setFieldErrors(errors)
      setServerError(null)
      return
    }

    submissionLockRef.current = true
    const routeKey = location.key
    const clientRequestId = crypto.randomUUID().toLowerCase()
    setFieldErrors({})
    setServerError(null)
    setIsSubmitting(true)
    try {
      const checkoutUrl = await createCheckout({ ...validation.data, clientRequestId })
      if (!mountedRef.current || routeKeyRef.current !== routeKey || !isStripeCheckoutUrl(checkoutUrl)) return
      assignCheckout(checkoutUrl)
    } catch (error) {
      if (mountedRef.current && routeKeyRef.current === routeKey) {
        setServerError(errorMessage(error))
        if (shouldRefreshAvailability(error)) void eventQuery.refetch()
      }
    } finally {
      if (mountedRef.current && routeKeyRef.current === routeKey) setIsSubmitting(false)
      submissionLockRef.current = false
    }
  }

  if (cancelToken !== null) {
    return <CheckoutState action={<Link className="ui-button ui-button--secondary" to={eventId ? publicEventPath(eventId) : '/'}>Return to event</Link>} status="loading" title="Cancelling checkout" />
  }
  if (!eventIdResult.success || !tierIdResult.success || (eventQuery.isPending || eventQuery.data === undefined) && !eventQuery.isError) {
    return <CheckoutState action={<Link className="ui-button ui-button--secondary" to={eventId ? publicEventPath(eventId) : '/'}>Return to event</Link>} status="loading" title="Loading checkout" />
  }
  if (eventQuery.isError || eventQuery.data === null) {
    return <CheckoutState action={<Link className="ui-button ui-button--secondary" to={publicEventPath(eventId)}>Return to event</Link>} description="Check your connection, then return to the event and try again." status="error" title="Checkout could not load" />
  }

  const selectedTier = eventQuery.data.tiers.find((tier) => tier.id === tierId && tier.availability_status === 'available')
  if (selectedTier === undefined) {
    return <CheckoutState action={<Link className="ui-button ui-button--secondary" to={publicEventPath(eventId)}>Return to event</Link>} description="Choose an available ticket to continue." status="empty" title="This ticket is unavailable" />
  }

  const errors = [fieldErrors.buyerName, fieldErrors.buyerEmail, serverError].filter((value): value is string => value !== undefined && value !== null)
  const disabled = isSubmitting

  return (
    <main className="checkout-layout">
      <section aria-labelledby="checkout-title" className="checkout-page">
        <header className="checkout-page__header">
          <p className="public-event__eyebrow">Guest checkout</p>
          <h1 id="checkout-title">Review your ticket</h1>
          <p>Secure payment is completed with Stripe.</p>
        </header>
        <section aria-label="Ticket summary" className="checkout-summary">
          <p className="checkout-summary__event">{eventQuery.data.event.title}</p>
          <dl>
            <div><dt>Ticket</dt><dd>{selectedTier.name}</dd></div>
            <div><dt>Quantity</dt><dd>1</dd></div>
            <div><dt>Total</dt><dd>{formatMinorUsd(selectedTier.unit_amount_minor)}</dd></div>
          </dl>
        </section>
        <form className="checkout-form" noValidate onSubmit={(event) => void submit(event)}>
          <FormErrorSummary errors={errors} title="Check your details" />
          <Field error={fieldErrors.buyerName} label="Your name" name="buyer-name">
            <input autoComplete="name" disabled={disabled} onChange={(event) => setBuyerName(event.target.value)} ref={buyerNameRef} value={buyerName} />
          </Field>
          <Field error={fieldErrors.buyerEmail} label="Email address" name="buyer-email">
            <input autoComplete="email" disabled={disabled} inputMode="email" onChange={(event) => setBuyerEmail(event.target.value)} ref={buyerEmailRef} type="email" value={buyerEmail} />
          </Field>
          <Button disabled={disabled} type="submit">{disabled ? 'Opening secure payment…' : 'Continue to secure payment'}</Button>
        </form>
      </section>
    </main>
  )
}
