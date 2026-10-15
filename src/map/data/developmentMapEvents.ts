import type { WheretooMapEvent } from './wheretooMapEvents'
import type { EventPreviewNavigation } from '../preview/eventPreviewNavigation'

const developmentMapEvents: readonly WheretooMapEvent[] = [
  {
    id: 'oakland-day-party', title: 'Day Party', category: 'nightlife',
    startsAt: '2027-06-12T21:00:00.000Z', endsAt: '2027-06-13T02:00:00.000Z', timezone: 'America/Los_Angeles',
    latitude: 37.807, longitude: -122.259, animationPreset: 'generic', mapIconVersionId: '8d94a4cf-e61b-480a-9f1f-8b5497620dfa', venueLabel: 'Lake Merritt Patio',
    admissionType: 'paid', minimumPriceMinor: 2000, minimumAge: '21_plus', advisories: ['alcohol'], artworkReference: null,
  },
  {
    id: 'oakland-vinyl-night', title: 'Vinyl Night', category: 'music',
    startsAt: '2027-06-13T02:00:00.000Z', endsAt: '2027-06-13T06:00:00.000Z', timezone: 'America/Los_Angeles',
    latitude: 37.811, longitude: -122.268, animationPreset: 'generic', mapIconVersionId: null, venueLabel: 'Uptown Listening Room',
    admissionType: 'paid', minimumPriceMinor: 1500, minimumAge: '21_plus', advisories: ['alcohol'], artworkReference: null,
  },
  {
    id: 'oakland-taco-social', title: 'Taco Social', category: 'food_drink',
    startsAt: '2027-06-13T19:00:00.000Z', endsAt: '2027-06-13T23:00:00.000Z', timezone: 'America/Los_Angeles',
    latitude: 37.798, longitude: -122.276, animationPreset: 'generic', mapIconVersionId: null, venueLabel: 'Jack London Courtyard',
    admissionType: 'free', minimumPriceMinor: null, minimumAge: 'all_ages', advisories: [], artworkReference: null,
  },
  {
    id: 'oakland-outdoor-cinema', title: 'Outdoor Cinema', category: 'art_culture',
    startsAt: '2027-06-14T03:00:00.000Z', endsAt: '2027-06-14T05:30:00.000Z', timezone: 'America/Los_Angeles',
    latitude: 37.803, longitude: -122.272, animationPreset: 'generic', mapIconVersionId: null, venueLabel: 'Old Oakland Yard',
    admissionType: 'paid', minimumPriceMinor: 1200, minimumAge: 'all_ages', advisories: [], artworkReference: null,
  },
  {
    id: 'oakland-morning-run-club', title: 'Morning Run Club', category: 'fitness',
    startsAt: '2027-06-14T15:00:00.000Z', endsAt: '2027-06-14T17:00:00.000Z', timezone: 'America/Los_Angeles',
    latitude: 37.812, longitude: -122.2525, animationPreset: 'generic', mapIconVersionId: null, venueLabel: 'Grand Lake Meeting Point',
    admissionType: 'free', minimumPriceMinor: null, minimumAge: 'all_ages', advisories: [], artworkReference: null,
  },
]

const categories = ['food_drink', 'music', 'fitness', 'art_culture', 'shopping', 'community', 'nightlife', 'other'] as const
const denseCenters = [[-122.259, 37.807], [-122.268, 37.811], [-122.276, 37.798], [-122.2525, 37.812], [-122.272, 37.803]] as const

function denseEvents(): WheretooMapEvent[] {
  return Array.from({ length: 45 }, (_, index) => {
    const center = denseCenters[index % denseCenters.length]
    const ring = Math.floor(index / denseCenters.length)
    const free = index % 3 === 0
    return {
      id: `map-dense-event-${String(index + 1).padStart(2, '0')}`, title: `Oakland Fixture Event ${index + 1}`,
      category: categories[index % categories.length],
      startsAt: new Date(Date.UTC(2027, 5, 15 + Math.floor(index / 9), 17 + (index % 6))).toISOString(),
      endsAt: new Date(Date.UTC(2027, 5, 15 + Math.floor(index / 9), 19 + (index % 6))).toISOString(), timezone: 'America/Los_Angeles',
      longitude: center[0] + ((ring % 3) - 1) * 0.00028, latitude: center[1] + (Math.floor(ring / 3) - 1) * 0.00024,
      animationPreset: 'generic', mapIconVersionId: null, venueLabel: `Oakland Proof Venue ${index % 9 + 1}`,
      admissionType: free ? 'free' : 'paid', minimumPriceMinor: free ? null : 800 + index * 50,
      minimumAge: 'all_ages', advisories: [], artworkReference: null,
    }
  })
}

const colocatedEvents: readonly WheretooMapEvent[] = [
  { ...developmentMapEvents[0], id: 'map-colocated-rooftop-jazz', title: 'Rooftop Jazz Session', category: 'music', startsAt: '2027-06-12T22:00:00.000Z', endsAt: '2027-06-13T00:00:00.000Z', animationPreset: 'generic', mapIconVersionId: null, admissionType: 'free', minimumPriceMinor: null },
  { ...developmentMapEvents[0], id: 'map-colocated-supper-club', title: 'Patio Supper Club', category: 'food_drink', startsAt: '2027-06-13T01:00:00.000Z', endsAt: '2027-06-13T03:00:00.000Z', animationPreset: 'generic', mapIconVersionId: null, minimumPriceMinor: 2800 },
  { ...developmentMapEvents[0], id: 'map-colocated-art-social', title: 'Late Art Social', category: 'art_culture', startsAt: '2027-06-13T03:00:00.000Z', endsAt: '2027-06-13T05:00:00.000Z', animationPreset: 'generic', mapIconVersionId: null, admissionType: 'free', minimumPriceMinor: null },
]

export function getDevelopmentMapEvents(search = ''): WheretooMapEvent[] {
  const fixture = new URLSearchParams(search).get('mapFixture')
  const extras = fixture === 'dense' ? denseEvents() : fixture === 'colocated' ? colocatedEvents : []
  return [...developmentMapEvents, ...extras].map((event) => ({ ...event, advisories: [...event.advisories] }))
}

export function getDevelopmentEventPreviewNavigation(): EventPreviewNavigation {
  return {
    kind: 'disabled',
    indication: 'Demo event',
    explanation: 'Demo event — full event page not connected yet.',
  }
}
