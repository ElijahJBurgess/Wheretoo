import { Button } from '../../components/ui/Button'
import { AsyncState } from '../../components/ui/AsyncState'
import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { clearCheckoutAttemptForConfirmation } from '../checkout/checkout.attempt'
import type { OrderConfirmation } from './order.types'
import { useOrderConfirmation } from './order.queries'

type ConfirmationStatus = OrderConfirmation['status']

const statusCopy: Record<ConfirmationStatus, { heading: string; message: string; mark: string }> = {
  processing: {
    heading: 'Confirming your payment',
    message: 'Waiting for secure payment confirmation. Keep this page open.',
    mark: '…',
  },
  paid: {
    heading: "You're all set",
    message: 'Payment confirmed. Your order is ready.',
    mark: '✓',
  },
  payment_failed: {
    heading: 'Payment could not be confirmed',
    message: 'No ticket was issued. Check your payment details before trying again.',
    mark: '!',
  },
  cancelled: {
    heading: 'Checkout cancelled',
    message: 'No payment was completed. Choose tickets again from the event page.',
    mark: '×',
  },
  expired: {
    heading: 'Checkout expired',
    message: 'Choose a ticket again from the event page.',
    mark: '×',
  },
  refunded: {
    heading: 'This order was refunded',
    message: 'This ticket is no longer valid.',
    mark: '↺',
  },
  requires_review: {
    heading: 'Order needs review',
    message: 'We are reviewing this order. Keep this confirmation link for updates.',
    mark: '!',
  },
}

const terminalStatuses = new Set<ConfirmationStatus>([
  'paid',
  'payment_failed',
  'cancelled',
  'expired',
  'refunded',
])

function formatMinorUsd(minor: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100)
}

function formatSchedule(event: OrderConfirmation['event']): string {
  const start = new Date(event.startsAt)
  const end = new Date(event.endsAt)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return 'Schedule unavailable'
  try {
    const date = new Intl.DateTimeFormat('en-US', {
      timeZone: event.timezone,
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    })
    const time = new Intl.DateTimeFormat('en-US', {
      timeZone: event.timezone,
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    })
    const startDate = date.format(start)
    const endDate = date.format(end)
    return startDate === endDate
      ? `${startDate}, ${time.format(start)}–${time.format(end)}`
      : `${startDate}, ${time.format(start)}–${endDate}, ${time.format(end)}`
  } catch {
    return 'Schedule unavailable'
  }
}

function StandaloneState({
  action,
  description,
  status,
  title,
}: {
  action?: React.ReactNode
  description: string
  status: 'loading' | 'error'
  title: string
}) {
  return (
    <main className="confirmation-layout">
      <h1 className="confirmation-state__title">{title}</h1>
      <AsyncState action={action} description={description} status={status} title="Order status" />
    </main>
  )
}

function OrderConfirmationRoute({ confirmationToken }: { confirmationToken: string }) {
  const confirmation = useOrderConfirmation(confirmationToken)
  const status = confirmation.data?.status

  useEffect(() => {
    if (status !== undefined && terminalStatuses.has(status)) {
      clearCheckoutAttemptForConfirmation(confirmationToken)
    }
  }, [confirmationToken, status])

  if (confirmation.isPending) {
    return <StandaloneState description="Checking the latest persisted order status." status="loading" title="Loading order" />
  }
  if (confirmation.isError) {
    return (
      <StandaloneState
        action={<Button onClick={() => void confirmation.retry()} type="button">Try again</Button>}
        description="Check your connection, then try again."
        status="error"
        title="Order could not load"
      />
    )
  }
  if (confirmation.data === null || confirmation.data === undefined) {
    return <StandaloneState description="This confirmation link is invalid or unavailable." status="error" title="Order not found" />
  }

  const confirmedStatus = confirmation.data.status
  const copy = confirmation.isTimedOut && confirmedStatus === 'processing'
    ? {
      heading: 'Confirmation is taking longer',
      message: 'Payment confirmation is still processing. Check again when you are ready.',
      mark: '…',
    }
    : statusCopy[confirmedStatus]

  return (
    <main className={`confirmation-layout confirmation-layout--${confirmedStatus}`}>
      <article className="confirmation-card">
        <header className="confirmation-card__header">
          <p className="public-event__eyebrow">Order status</p>
          <span aria-hidden="true" className="confirmation-card__seal">{copy.mark}</span>
          <h1>{copy.heading}</h1>
          <p aria-live="polite" role="status">{copy.message}</p>
        </header>

        <section aria-labelledby="confirmation-event-title" className="confirmation-card__event">
          <p className="confirmation-card__label">Event</p>
          <h2 id="confirmation-event-title">{confirmation.data.event.title}</h2>
          <p>{formatSchedule(confirmation.data.event)}</p>
          <p>{confirmation.data.event.venueName ?? 'Venue to be announced'}</p>
        </section>

        <section aria-labelledby="confirmation-items-title" className="confirmation-card__event">
          <p className="confirmation-card__label">Tickets</p>
          <h2 id="confirmation-items-title">Your order</h2>
          <ul>
            {confirmation.data.items.map((item) => (
              <li key={item.tierName}>
                <span>{item.tierName} × {item.quantity}</span>{' '}
                <span>{formatMinorUsd(item.subtotalMinor)}</span>
              </li>
            ))}
          </ul>
        </section>

        <dl className="confirmation-card__facts">
          <div><dt>Quantity</dt><dd>{confirmation.data.quantity} admissions</dd></div>
          <div><dt>Subtotal</dt><dd>{formatMinorUsd(confirmation.data.subtotalMinor)}</dd></div>
          <div><dt>Tax</dt><dd>{formatMinorUsd(confirmation.data.taxAmountMinor)}</dd></div>
          <div><dt>Total</dt><dd className="confirmation-card__total">{formatMinorUsd(confirmation.data.totalMinor)}</dd></div>
          <div><dt>Order</dt><dd>{confirmation.data.orderNumber}</dd></div>
        </dl>

        {confirmedStatus === 'paid'
          ? <Link className="ui-button ui-button--primary" to={`/tickets/${encodeURIComponent(confirmationToken)}`}>View tickets</Link>
          : null}
        {confirmation.isTimedOut && confirmedStatus === 'processing'
          ? <Button onClick={() => void confirmation.retry()} type="button">Check again</Button>
          : null}
      </article>
    </main>
  )
}

export function OrderConfirmationPage() {
  const { confirmationToken = '' } = useParams()
  return <OrderConfirmationRoute confirmationToken={confirmationToken} key={confirmationToken} />
}
