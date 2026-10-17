import { describe, expect, it } from 'vitest'
import type { WheretooMapEvent } from '../data/wheretooMapEvents'
import { formatEventDateTime, formatEventPrice, resolvePublicArtworkUrl } from './eventPreviewFormatting'

const baseEvent: WheretooMapEvent = {
  mapIconVersionId: null,
  id: '9f4fcafa-4c56-4e81-a447-c3c639686d77',
  title: 'Day Party',
  category: 'nightlife',
  startsAt: '2027-06-12T21:00:00.000Z',
  endsAt: '2027-06-13T02:00:00.000Z',
  timezone: 'America/Los_Angeles',
  latitude: 37.807,
  longitude: -122.259,
  animationPreset: 'generic',
  venueLabel: 'Lake Merritt Patio',
  admissionType: 'paid',
  minimumPriceMinor: 2000,
  minimumAge: '21_plus',
  advisories: [],
  artworkReference: null,
}

describe('event preview formatting', () => {
  it('formats fixed timestamps in the event timezone instead of the browser timezone', () => {
    expect(formatEventDateTime(baseEvent)).toEqual({
      date: 'Sat, Jun 12',
      time: '2:00 PM – 7:00 PM PDT',
    })
  })

  it('names both dates for an event that crosses local midnight', () => {
    expect(formatEventDateTime({
      ...baseEvent,
      startsAt: '2027-06-13T06:00:00.000Z',
      endsAt: '2027-06-13T08:00:00.000Z',
    })).toEqual({
      date: 'Jun 12 – 13',
      time: '11:00 PM – 1:00 AM PDT',
    })
  })

  it('keeps both months in a compact overnight range', () => {
    expect(formatEventDateTime({ ...baseEvent, startsAt: '2027-07-01T06:00:00Z', endsAt: '2027-07-01T08:00:00Z' }).date).toBe('Jun 30 – Jul 1')
  })

  it('keeps years when the event crosses a year boundary', () => {
    expect(formatEventDateTime({ ...baseEvent, startsAt: '2026-12-31T23:00:00-08:00', endsAt: '2027-01-01T01:00:00-08:00' })).toEqual({ date: 'Dec 31, 2026 – Jan 1, 2027', time: '11:00 PM – 1:00 AM PST' })
  })

  it('distinguishes free, known paid, and unavailable paid prices', () => {
    expect(formatEventPrice({ ...baseEvent, admissionType: 'free', minimumPriceMinor: null })).toBe('Free')
    expect(formatEventPrice(baseEvent, { status: 'available', minimumPriceMinor: 2000 })).toBe('From $20')
    expect(formatEventPrice({ ...baseEvent, minimumPriceMinor: null })).toBe('Availability unknown')
  })

  it('accepts public HTTPS artwork but rejects executable or local protocols', () => {
    expect(resolvePublicArtworkUrl('https://images.example.com/event.jpg')).toBe('https://images.example.com/event.jpg')
    expect(resolvePublicArtworkUrl('javascript:alert(1)')).toBeNull()
    expect(resolvePublicArtworkUrl('file:///private/event.jpg')).toBeNull()
    expect(resolvePublicArtworkUrl(null)).toBeNull()
  })
})
