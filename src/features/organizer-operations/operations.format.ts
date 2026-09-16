import type { EventMetrics } from './operations.schemas'
export const money = (minor: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: minor % 100 ? 2 : 0,
  }).format(minor / 100)
export function dateTime(value: string | null, timezone = 'America/Los_Angeles') {
  if (!value) return 'Date to be confirmed'
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime())) return 'Date unavailable'
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(instant)
  } catch {
    return 'Date unavailable'
  }
}
export function timeZoneLabel(timezone: string) {
  try {
    const part = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longGeneric',
    }).formatToParts(new Date('2026-01-15T12:00:00Z')).find(({ type }) => type === 'timeZoneName')
    return part?.value ?? timezone
  } catch {
    return 'Timezone unavailable'
  }
}
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
