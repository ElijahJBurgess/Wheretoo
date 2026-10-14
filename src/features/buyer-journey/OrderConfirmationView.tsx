import { formatBuyerMoney } from './format'
import type { ReactNode } from 'react'
import type { OrderConfirmation } from '../orders/order.types'
import { BuyerEventSummary, BuyerHeader, BuyerIcon, BuyerProgress } from './BuyerPrimitives'
import { downloadEventCalendar } from './calendar'

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


export function OrderConfirmationView({ order, isTimedOut = false, ticketAction, retryAction }: {
  order: OrderConfirmation; isTimedOut?: boolean; ticketAction: ReactNode; retryAction?: ReactNode
}) {
  const copy = isTimedOut && order.status === 'processing'
    ? { heading: 'Confirmation is taking longer', message: 'Payment confirmation is still processing. Check again when you are ready.', mark: '…' }
    : statusCopy[order.status]
  const paid = order.status === 'paid'
  return <main className={`buyer-page buyer-confirmation buyer-confirmation--${order.status}`}>
    <BuyerHeader />
    <BuyerProgress step={3} complete={paid} />
    <div className="buyer-content">
      <header className="buyer-confirmation__success">
        <span aria-hidden="true" className="buyer-confirmation__seal">{copy.mark}</span>
        <h1>{copy.heading}</h1><p role="status" aria-live="polite">{copy.message}</p>
      </header>
      <BuyerEventSummary title={order.event.title} schedule={formatSchedule(order.event)} venue={order.event.venueName ?? 'Venue to be announced'} />
      <section className="buyer-order-details" aria-labelledby="confirmation-items-title">
        <h2 id="confirmation-items-title">Order details</h2>
        <p className="buyer-order-number"><span>{order.orderNumber}</span> · <span>{order.quantity} admissions</span></p>
        <ul>{order.items.map((item, index) => <li key={`${item.tierName}-${index}`}><span>{item.tierName} × {item.quantity}</span><span>{formatBuyerMoney(item.subtotalMinor)}</span></li>)}</ul>
        <dl><div><dt>Subtotal</dt><dd>{formatBuyerMoney(order.subtotalMinor)}</dd></div><div><dt>Tax</dt><dd>{formatBuyerMoney(order.taxAmountMinor)}</dd></div>
          <div className="buyer-order-details__total"><dt>{paid ? 'Total paid' : 'Total'}</dt><dd className="confirmation-card__total">{formatBuyerMoney(order.totalMinor)}</dd></div></dl>
      </section>
      {paid ? <><p className="buyer-ticket-note"><BuyerIcon name="ticket" /><span>Keep your tickets close.<br /><small>Open your ticket to see its current admission status.</small></span></p>{ticketAction}
        <button className="ui-button buyer-secondary" onClick={() => downloadEventCalendar(order)} type="button"><BuyerIcon name="calendar" />Add to calendar</button></> : null}
      {isTimedOut && order.status === 'processing' ? retryAction : null}
    </div>
  </main>
}
