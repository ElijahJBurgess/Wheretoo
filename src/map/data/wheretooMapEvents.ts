import type { EventCategory } from '../../features/events/event.types'

export type WheretooMapEvent = {
  id: string
  title: string
  category: EventCategory
  startsAt: string
  endsAt: string
  timezone: 'America/Los_Angeles'
  latitude: number
  longitude: number
  animationPreset: string
  mapIconVersionId: string | null
  venueLabel: string
  admissionType: 'free' | 'paid'
  minimumPriceMinor: number | null
  minimumAge: string
  advisories: string[]
  artworkReference: string | null
}
