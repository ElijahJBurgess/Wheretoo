import { describe, expect, it } from 'vitest'
import { getPublishErrorMessage, publishErrorCopy } from './publishErrors'

describe('publish error copy', () => {
  it.each(Object.entries({
    EVENT_NOT_FOUND: 'This event could not be found.',
    EVENT_NOT_OWNED: 'This event is not available to this organizer.',
    EVENT_INCOMPLETE: 'Complete every required event detail before publishing.',
    EVENT_TIME_INVALID: 'Choose a future start time and an end time after it.',
    EVENT_LOCATION_INVALID: 'Choose a verified California address.',
    EVENT_OUTSIDE_SERVICE_AREA: 'Choose a location inside the current Bay Area service area.',
    PAID_PUBLISHING_NOT_AVAILABLE: 'Paid event publishing is not available in this milestone. Choose Free to publish.',
    EVENT_MODERATION_BLOCKED: 'This event cannot be published in its current moderation state.',
    EVENT_DISCLOSURES_REQUIRED: 'Complete the event requirements before publishing.',
    EVENT_POLICY_ACCEPTANCE_REQUIRED:
      'Review and accept the current Organizer Terms and Event Policy before publishing.',
    EVENT_PUBLIC_HISTORY_UNKNOWN: 'This event needs moderation review before it can be published.',
    POLICY_ENVIRONMENT_UNCONFIGURED: 'Publishing is temporarily unavailable. Try again later.',
    POLICY_REQUIREMENTS_INVALID: 'Publishing is temporarily unavailable. Try again later.',
  }))('maps exact server code %s', (message, copy) => {
    expect(publishErrorCopy).toHaveProperty(message, copy)
    expect(getPublishErrorMessage({ message, details: 'private database detail' })).toBe(copy)
  })

  it.each([
    null,
    undefined,
    new Error('connection exploded'),
    { message: 'EVENT_NOT_FOUND: internal table public.events' },
    { message: 'event_not_found' },
    { message: 42 },
  ])('suppresses unknown backend details for %j', (error) => {
    expect(getPublishErrorMessage(error)).toBe('Publishing failed. Try again.')
  })
})
