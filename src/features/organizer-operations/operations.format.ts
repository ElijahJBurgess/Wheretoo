import type { EventMetrics } from './operations.schemas'
export const money = (minor: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: minor % 100 ? 2 : 0,
  }).format(minor / 100)
export const dateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'America/Los_Angeles',
    }).format(new Date(value))
    : 'Date to be confirmed'
export function eventLabel(event: EventMetrics['event']) {
  if (event.status === 'cancelled') return 'Cancelled'
  if (event.status === 'draft') return 'Draft'
  return event.endsAt && Date.parse(event.endsAt) <= Date.now() ? 'Ended' : 'Live'
}
export const statusLabel = (status: string) =>
  ({
    paid: 'Paid',
    refunded: 'Refunded',
    requires_review: 'Needs review',
    partially_refunded: 'Partially refunded',
    creating_checkout: 'Checkout starting',
    checkout_open: 'Awaiting payment',
    payment_processing: 'Processing',
    payment_failed: 'Payment failed',
    expired: 'Expired',
    cancelled: 'Cancelled',
  })[status] ?? status
