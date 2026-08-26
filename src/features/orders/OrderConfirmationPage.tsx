import { Button } from '../../components/ui/Button'
import { AsyncState } from '../../components/ui/AsyncState'
import { useParams } from 'react-router-dom'
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
  failed: {
    heading: 'Payment could not be confirmed',
    message: 'No ticket was issued. Check your payment details before trying again.',
    mark: '!',
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

  const status = confirmation.data.status
  const copy = confirmation.isTimedOut && status === 'processing'
    ? {
      heading: 'Confirmation is taking longer',
      message: 'Payment confirmation is still processing. Check again when you are ready.',
      mark: '…',
    }
    : statusCopy[status]

  return (
    <main className={`confirmation-layout confirmation-layout--${status}`}>
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

        <dl className="confirmation-card__facts">
          <div><dt>Ticket</dt><dd>{confirmation.data.tier.name}</dd></div>
          <div><dt>Order</dt><dd>{confirmation.data.orderNumber}</dd></div>
        </dl>

        {confirmation.isTimedOut && status === 'processing'
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
