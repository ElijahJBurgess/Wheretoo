import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eventDraftSchema, eventPublishSchema, publicEventSchema } from './event.schemas'
import type { EventFormValues, NormalizedLocation } from './event.types'

const validLocation: NormalizedLocation = {
  mapboxFeatureId: 'address.verified',
  addressLine1: '1 Dr Carlton B Goodlett Place',
  addressLine2: '',
  city: 'San Francisco',
  region: 'CA',
  postalCode: '94102',
  countryCode: 'US',
  latitude: 37.7793,
  longitude: -122.4193,
}

const validValues: EventFormValues = {
  title: 'Night Market',
  description: 'An evening market featuring local food and neighborhood makers.',
  category: 'community',
  startsAt: '2026-08-24T19:00',
  endsAt: '2026-08-24T22:00',
  timezone: 'America/Los_Angeles',
  venueName: 'Civic Center Plaza',
  location: validLocation,
  admissionType: 'free',
  capacity: 250,
}

function publish(values: Partial<EventFormValues> = {}) {
  return eventPublishSchema.safeParse({ ...validValues, ...values })
}

describe('eventDraftSchema', () => {
  it('allows an incomplete draft', () => {
    expect(
      eventDraftSchema.safeParse({
        title: '',
        description: '',
        category: '',
        startsAt: '',
        endsAt: '',
        timezone: 'America/Los_Angeles',
        venueName: '',
        location: null,
        admissionType: 'free',
        capacity: null,
      }).success,
    ).toBe(true)
  })

  it('matches database trim semantics for title and venue maxima', () => {
    expect(
      eventDraftSchema.safeParse({
        ...validValues,
        title: ` ${'x'.repeat(120)} `,
        venueName: ` ${'x'.repeat(160)} `,
      }).success,
    ).toBe(true)
  })

  it.each([
    ['title', 'x'.repeat(121)],
    ['description', 'x'.repeat(5001)],
    ['venueName', 'x'.repeat(161)],
    ['category', 'sports'],
    ['timezone', 'UTC'],
    ['admissionType', 'donation'],
    ['capacity', 0],
    ['capacity', 1.5],
    ['capacity', 2_147_483_648],
    ['startsAt', 'not-a-wall-time'],
    ['endsAt', '2026-08-25'],
    ['startsAt', '2026-03-08T02:30'],
  ])('rejects database-incompatible %s values', (field, value) => {
    expect(eventDraftSchema.safeParse({ ...validValues, [field]: value }).success).toBe(false)
  })

  it.each([
    [{ latitude: 91 }, 'latitude above the world domain'],
    [{ latitude: Number.NaN }, 'non-finite latitude'],
    [{ longitude: -181 }, 'longitude below the world domain'],
    [{ longitude: Number.POSITIVE_INFINITY }, 'non-finite longitude'],
    [{ region: 'NV' }, 'a non-California normalized location'],
    [{ countryCode: 'CA' }, 'a non-US normalized location'],
  ])('rejects %s (%s)', (...args) => {
    const [locationPatch] = args
    expect(
      eventDraftSchema.safeParse({
        ...validValues,
        location: { ...validLocation, ...locationPatch },
      }).success,
    ).toBe(false)
  })
})

describe('eventPublishSchema', () => {
  beforeEach(() => vi.setSystemTime(new Date('2026-08-24T12:00:00.000Z')))
  afterEach(() => vi.useRealTimers())

  it('accepts a complete free event at the inclusive service-area boundaries', () => {
    vi.useFakeTimers()

    expect(
      publish({ location: { ...validLocation, latitude: 36.8, longitude: -123.6 } }).success,
    ).toBe(true)
    expect(
      publish({ location: { ...validLocation, latitude: 38.9, longitude: -121 } }).success,
    ).toBe(true)
  })

  it.each([
    [{ title: '  x  ' }, 'EVENT_INCOMPLETE title'],
    [{ title: ` ${'x'.repeat(121)} ` }, 'EVENT_INCOMPLETE title maximum'],
    [{ description: '  too short  ' }, 'EVENT_INCOMPLETE description'],
    [{ category: '' }, 'EVENT_INCOMPLETE category'],
    [{ location: null }, 'EVENT_INCOMPLETE location'],
    [{ location: { ...validLocation, addressLine1: '   ' } }, 'EVENT_INCOMPLETE address'],
    [{ location: { ...validLocation, city: '' } }, 'EVENT_INCOMPLETE city'],
    [{ location: { ...validLocation, postalCode: '  ' } }, 'EVENT_INCOMPLETE postal code'],
    [{ location: { ...validLocation, mapboxFeatureId: '\t' } }, 'EVENT_INCOMPLETE feature ID'],
  ])('rejects %s as %s', (...args) => {
    const [values] = args
    vi.useFakeTimers()
    expect(publish(values as Partial<EventFormValues>).success).toBe(false)
  })

  it.each([
    [{ startsAt: 'not-a-date' }, 'invalid start'],
    [{ startsAt: '2026-08-24T05:00' }, 'start equal to now'],
    [{ startsAt: '2026-08-24T04:59' }, 'past start'],
    [{ endsAt: 'not-a-date' }, 'invalid end'],
    [{ endsAt: validValues.startsAt }, 'end equal to start'],
    [{ endsAt: '2026-08-24T18:59' }, 'end before start'],
  ])('rejects %s (%s)', (...args) => {
    const [values] = args
    vi.useFakeTimers()
    expect(publish(values).success).toBe(false)
  })

  it.each([
    [{ latitude: 36.799999 }, 'south'],
    [{ latitude: 38.900001 }, 'north'],
    [{ longitude: -123.600001 }, 'west'],
    [{ longitude: -120.999999 }, 'east'],
  ])('rejects a location just outside the service area to the %s (%s)', (...args) => {
    const [locationPatch] = args
    vi.useFakeTimers()
    expect(publish({ location: { ...validLocation, ...locationPatch } }).success).toBe(false)
  })

  it('accepts complete future paid publication data while retaining paid as a draft value', () => {
    vi.useFakeTimers()
    expect(eventDraftSchema.safeParse({ ...validValues, admissionType: 'paid' }).success).toBe(true)
    expect(publish({ admissionType: 'paid' }).success).toBe(true)
  })
})

describe('publicEventSchema', () => {
  it('accepts only the narrow public RPC projection', () => {
    expect(publicEventSchema.safeParse({
      id: 'b4ee321a-bdf6-43b2-a7f4-d6478d942908', title: 'Night Market', description: 'Food and makers.', category: 'community',
      startsAt: '2026-09-01T02:00:00Z', endsAt: '2026-09-01T05:00:00Z', timezone: 'America/Los_Angeles', venueName: 'Civic Center',
      addressLine1: '1 Market St', addressLine2: null, city: 'San Francisco', region: 'CA', postalCode: '94102', countryCode: 'US',
      latitude: 37.78, longitude: -122.42, artworkPath: null, animationPreset: 'generic', admissionType: 'free', minimumAge: 'all_ages', advisories: [],
      organizer: { id: 'c9c39721-6d2c-413e-9a69-253267bd0f80', displayName: 'Bay City Arts' },
    }).success).toBe(true)
  })
})
