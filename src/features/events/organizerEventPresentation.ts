import type { EventRow } from './event.types'

export const organizerEventFilters = ['All', 'Live', 'Draft', 'Ended', 'Cancelled'] as const
export type OrganizerEventFilter = (typeof organizerEventFilters)[number]

export type OrganizerEventStatus = {
  label: Exclude<OrganizerEventFilter, 'All'> | 'Blocked' | 'Removed' | 'Under review'
  style: 'published' | 'draft' | 'cancelled' | 'blocked' | 'removed' | 'under-review'
}

export function organizerEventDestination(event: EventRow): string {
  if (event.status === 'draft') return `/organizer/events/${event.id}/edit`
  if (event.admission_type === 'paid') return `/organizer/events/${event.id}/dashboard`
  return `/organizer/events/${event.id}`
}

export function organizerEventStatus(event: EventRow, now = Date.now()): OrganizerEventStatus {
  if (event.status === 'cancelled') return { label: 'Cancelled', style: 'cancelled' }
  if (event.status === 'draft') return { label: 'Draft', style: 'draft' }
  if (event.moderation_status === 'blocked') return { label: 'Blocked', style: 'blocked' }
  if (event.moderation_status === 'removed') return { label: 'Removed', style: 'removed' }
  if (
    event.moderation_status === 'under_review' ||
    event.moderation_status === 'not_evaluated' ||
    event.moderated_revision !== event.content_revision
  ) {
    return { label: 'Under review', style: 'under-review' }
  }
  if (event.ends_at && Date.parse(event.ends_at) <= now) {
    return { label: 'Ended', style: 'draft' }
  }
  return { label: 'Live', style: 'published' }
}

export function organizerEventLocation(event: Pick<
  EventRow,
  'address_line1' | 'address_line2' | 'city' | 'region' | 'postal_code'
>): string {
  const street = [event.address_line1, event.address_line2]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(', ')
  const cityRegion = [event.city, event.region]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(', ')
  const locality = [cityRegion, event.postal_code?.trim()].filter(Boolean).join(' ')
  return [street, locality].filter(Boolean).join(', ') || 'Location not added'
}
