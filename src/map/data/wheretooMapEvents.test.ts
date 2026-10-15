import { describe, expect, it } from 'vitest'
import { getDevelopmentMapEvents } from './developmentMapEvents'

describe('getDevelopmentMapEvents', () => {
  it('returns exactly five stable, backend-shaped Oakland fixtures in development', () => {
    const events = getDevelopmentMapEvents()

    expect(events).toHaveLength(5)
    expect(events.map(({ id, title, category, longitude, latitude }) => ({ id, title, category, longitude, latitude }))).toEqual([
      { id: 'oakland-day-party', title: 'Day Party', category: 'nightlife', longitude: -122.259, latitude: 37.807 },
      { id: 'oakland-vinyl-night', title: 'Vinyl Night', category: 'music', longitude: -122.268, latitude: 37.811 },
      { id: 'oakland-taco-social', title: 'Taco Social', category: 'food_drink', longitude: -122.276, latitude: 37.798 },
      { id: 'oakland-outdoor-cinema', title: 'Outdoor Cinema', category: 'art_culture', longitude: -122.272, latitude: 37.803 },
      { id: 'oakland-morning-run-club', title: 'Morning Run Club', category: 'fitness', longitude: -122.2525, latitude: 37.812 },
    ])
    expect(new Set(events.map((event) => event.id)).size).toBe(5)
    for (const event of events) {
      expect(Number.isFinite(event.longitude)).toBe(true)
      expect(Number.isFinite(event.latitude)).toBe(true)
      expect(event.timezone).toBe('America/Los_Angeles')
      expect(new Date(event.startsAt).getTime()).toBeGreaterThan(new Date('2026-09-08T00:00:00Z').getTime())
      expect(event).toEqual(expect.objectContaining({
        endsAt: expect.any(String), animationPreset: expect.any(String), venueLabel: expect.any(String),
        minimumAge: expect.any(String), advisories: expect.any(Array), artworkReference: null,
      }))
    }
  })

})
