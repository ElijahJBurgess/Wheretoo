import type { WheretooMapEvent } from '../data/wheretooMapEvents'

const dateFormatter = (timeZone: string) => new Intl.DateTimeFormat('en-US', {
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone,
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
  const dates = dateFormatter(event.timezone)
  const startDate = dates.format(startsAt)
  const endDate = dates.format(endsAt)
  return {
    date: startDate === endDate ? startDate : `${startDate} – ${endDate}`,
    time: `${timeFormatter(event.timezone, false).format(startsAt)} – ${timeFormatter(event.timezone, true).format(endsAt)}`,
  }
}

export function formatEventPrice(event: WheretooMapEvent) {
  if (event.admissionType === 'free') return 'Free'
  if (event.minimumPriceMinor === null || event.minimumPriceMinor < 0) return 'Price unavailable'
  return `From ${new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: event.minimumPriceMinor % 100 === 0 ? 0 : 2,
  }).format(event.minimumPriceMinor / 100)}`
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
