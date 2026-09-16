import { supabase } from '../../lib/supabase/client'
import type { Database } from '../../lib/supabase/database.types'
import { instantToLosAngelesWallTime, losAngelesWallTimeToIso } from './event.time'
import { eventCategories } from './event.types'
import type { EventCategory, EventFormValues, EventRow, NormalizedLocation } from './event.types'

type EventInsert = Database['public']['Tables']['events']['Insert']
type EventUpdate = Database['public']['Tables']['events']['Update']

type EventDraftPayload = Pick<
  EventUpdate,
  | 'title'
  | 'description'
  | 'category'
  | 'starts_at'
  | 'ends_at'
  | 'timezone'
  | 'venue_name'
  | 'address_line1'
  | 'address_line2'
  | 'city'
  | 'region'
  | 'postal_code'
  | 'country_code'
  | 'mapbox_feature_id'
  | 'latitude'
  | 'longitude'
  | 'admission_type'
  | 'capacity'
>

function optionalText(value: string): string | null {
  return value.trim() === '' ? null : value
}

function wallTimeToDatabase(value: string): string | null {
  if (value.trim() === '') {
    return null
  }

  const instant = losAngelesWallTimeToIso(value)
  if (instant === null) {
    throw new Error('Event date must be a valid America/Los_Angeles wall time')
  }

  return instant
}

function isEventCategory(value: string | null): value is EventCategory {
  return value !== null && eventCategories.some((category) => category === value)
}

function rowLocation(event: EventRow): NormalizedLocation | null {
  if (
    event.mapbox_feature_id === null ||
    event.address_line1 === null ||
    event.city === null ||
    event.region !== 'CA' ||
    event.postal_code === null ||
    event.country_code !== 'US' ||
    event.latitude === null ||
    event.longitude === null ||
    !Number.isFinite(event.latitude) ||
    !Number.isFinite(event.longitude) ||
    event.latitude < -90 ||
    event.latitude > 90 ||
    event.longitude < -180 ||
    event.longitude > 180
  ) {
    return null
  }

  return {
    mapboxFeatureId: event.mapbox_feature_id,
    addressLine1: event.address_line1,
    addressLine2: event.address_line2 ?? '',
    city: event.city,
    region: 'CA',
    postalCode: event.postal_code,
    countryCode: 'US',
    latitude: event.latitude,
    longitude: event.longitude,
  }
}

export function draftPayload(values: EventFormValues): EventDraftPayload {
  const location = values.location

  return {
    title: optionalText(values.title),
    description: optionalText(values.description),
    category: optionalText(values.category),
    starts_at: wallTimeToDatabase(values.startsAt),
    ends_at: wallTimeToDatabase(values.endsAt),
    timezone: values.timezone,
    venue_name: optionalText(values.venueName),
    address_line1: location === null ? null : optionalText(location.addressLine1),
    address_line2: location === null ? null : optionalText(location.addressLine2),
    city: location === null ? null : optionalText(location.city),
    region: location?.region ?? null,
    postal_code: location === null ? null : optionalText(location.postalCode),
    country_code: location?.countryCode ?? 'US',
    mapbox_feature_id: location === null ? null : optionalText(location.mapboxFeatureId),
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    admission_type: values.admissionType,
    capacity: values.capacity,
  }
}

export async function listOwnedEvents(organizerId: string): Promise<EventRow[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('organizer_id', organizerId)
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }

  if (!Array.isArray(data)) throw new Error('Event list unavailable')
  return data
}

export async function getOwnedEvent(
  eventId: string,
  organizerId: string,
): Promise<EventRow | null> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .eq('organizer_id', organizerId)
    .maybeSingle()

  if (error && error.code !== 'PGRST116') {
    throw error
  }

  return data ?? null
}

export function eventRowToFormValues(event: EventRow): EventFormValues {
  return {
    title: event.title ?? '',
    description: event.description ?? '',
    category: isEventCategory(event.category) ? event.category : '',
    startsAt: event.starts_at === null ? '' : instantToLosAngelesWallTime(event.starts_at),
    endsAt: event.ends_at === null ? '' : instantToLosAngelesWallTime(event.ends_at),
    timezone: 'America/Los_Angeles',
    venueName: event.venue_name ?? '',
    location: rowLocation(event),
    admissionType: event.admission_type === 'paid' ? 'paid' : 'free',
    capacity: event.capacity,
  }
}

export async function saveEventDraft(input: {
  eventId: string | null
  organizerId: string
  values: EventFormValues
}): Promise<EventRow> {
  const payload = draftPayload(input.values)
  const result =
    input.eventId === null
      ? await supabase
          .from('events')
          .insert({ ...payload, organizer_id: input.organizerId } satisfies EventInsert)
          .select('*')
          .single()
      : await supabase
          .from('events')
          .update(payload)
          .eq('id', input.eventId)
          .eq('organizer_id', input.organizerId)
          .select('*')
          .single()

  if (result.error) {
    throw result.error
  }

  if (!result.data) {
    throw new Error('Saved event was not returned')
  }

  return result.data
}

export async function saveEventRevision(input: {
  eventId: string
  organizerId: string
  values: EventFormValues
}): Promise<EventRow> {
  const { data, error } = await supabase.rpc('save_owned_event_revision', {
    p_event_id: input.eventId,
    p_event: draftPayload(input.values),
  })

  if (error) throw error
  if (!data) throw new Error('Saved event revision was not returned')
  return data
}

export async function publishEvent(eventId: string): Promise<EventRow> {
  const { data, error } = await supabase.rpc('publish_event', { p_event_id: eventId })

  if (error) {
    throw error
  }

  if (!data) {
    throw new Error('Published event was not returned')
  }

  return data
}

export async function cancelOwnedEvent(eventId: string): Promise<EventRow> {
  const { data, error } = await supabase.rpc('cancel_owned_event', { p_event_id: eventId })
  if (error) throw error
  if (!data) throw new Error('Cancelled event was not returned')
  return data
}
