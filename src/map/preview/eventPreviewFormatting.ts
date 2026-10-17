import type { WheretooMapEvent } from '../data/wheretooMapEvents'

const dateFormatter = (timeZone: string, withYear = false) => new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' as const } : {}), timeZone,
})

const timeFormatter = (timeZone: string, withZone: boolean) => new Intl.DateTimeFormat('en-US', {
  hour: 'numeric', minute: '2-digit', timeZone,
  ...(withZone ? { timeZoneName: 'short' as const } : {}),
})

export function formatEventDateTime(event: WheretooMapEvent) {
  const startsAt = new Date(event.startsAt)
  const endsAt = new Date(event.endsAt)
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return { date: 'Date unavailable', time: 'Time unavailable' }
  }
  const years = new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: event.timezone })
  const withYear = years.format(startsAt) !== years.format(endsAt)
  const dates = dateFormatter(event.timezone, withYear)
  const range = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' as const } : {}), timeZone: event.timezone,
  })
  const startDate = dates.format(startsAt)
  const endDate = dates.format(endsAt)
  return {
    date: startDate === endDate ? startDate : range.formatRange(startsAt, endsAt).replace(/\s+/g, ' '),
    time: `${timeFormatter(event.timezone, false).format(startsAt)} – ${timeFormatter(event.timezone, true).format(endsAt)}`,
  }
}

export type PreviewAvailability = { status: 'available' | 'sold_out'; minimumPriceMinor: number | null }

export function formatEventPrice(event: WheretooMapEvent, availability?: PreviewAvailability | null) {
  if (event.admissionType === 'free') return 'Free'
  if (availability === undefined) return 'Availability unknown'
  if (availability === null) return 'Currently unavailable'
  if (availability.status === 'sold_out') return 'Sold out'
  const amount = availability.minimumPriceMinor
  if (amount === null || !Number.isSafeInteger(amount) || amount < 0) return 'Availability unknown'
  return `From ${new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: amount % 100 === 0 ? 0 : 2,
  }).format(amount / 100)}`
}

export function resolvePublicArtworkUrl(reference: string | null) {
  if (!reference) return null
  try {
    const url = new URL(reference)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}
