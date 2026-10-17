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
      date: 'Saturday, June 12, 2027',
      time: '2:00 PM – 7:00 PM PDT',
    })
  })

  it('names both dates for an event that crosses local midnight', () => {
    expect(formatEventDateTime({
      ...baseEvent,
      startsAt: '2027-06-13T06:00:00.000Z',
      endsAt: '2027-06-13T08:00:00.000Z',
    })).toEqual({
      date: 'Saturday, June 12, 2027 – Sunday, June 13, 2027',
      time: '11:00 PM – 1:00 AM PDT',
    })
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
