import type { Database } from '../../lib/supabase/database.types'

export const eventCategories = [
  'food_drink',
  'music',
  'fitness',
  'art_culture',
  'shopping',
  'community',
  'nightlife',
  'other',
] as const

export type EventCategory = (typeof eventCategories)[number]

export type PublishEventErrorCode =
  | 'EVENT_NOT_FOUND'
  | 'EVENT_NOT_OWNED'
  | 'EVENT_INCOMPLETE'
  | 'EVENT_TIME_INVALID'
  | 'EVENT_LOCATION_INVALID'
  | 'EVENT_OUTSIDE_SERVICE_AREA'
  | 'PAID_PUBLISHING_NOT_AVAILABLE'
  | 'EVENT_MODERATION_BLOCKED'

export type EventRow = Database['public']['Tables']['events']['Row']

export type NormalizedLocation = {
  mapboxFeatureId: string
  addressLine1: string
  addressLine2: string
  city: string
  region: 'CA'
  postalCode: string
  countryCode: 'US'
  latitude: number
  longitude: number
}

export type EventFormValues = {
  title: string
  description: string
  category: EventCategory | ''
  startsAt: string
  endsAt: string
  timezone: 'America/Los_Angeles'
  venueName: string
  location: NormalizedLocation | null
  admissionType: 'free' | 'paid'
  capacity: number | null
}

export type PublicEvent = {
  id: string
  title: string
  description: string
  category: EventCategory
  startsAt: string
  endsAt: string
  timezone: 'America/Los_Angeles'
  venueName: string
  addressLine1: string
  addressLine2: string | null
  city: string
  region: 'CA'
  postalCode: string
  countryCode: 'US'
  latitude: number
  longitude: number
  artworkPath: string | null
  animationPreset: string
  admissionType: 'free' | 'paid'
  minimumAge: 'all_ages' | '18_plus' | '21_plus'
  advisories: Array<'alcohol' | 'cannabis' | 'mature_content'>
  organizer: { id: string; displayName: string }
}
