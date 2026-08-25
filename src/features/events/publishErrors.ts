import type { PublishEventErrorCode } from './event.types'

export const publishErrorCopy: Record<PublishEventErrorCode, string> = {
  EVENT_NOT_FOUND: 'This event could not be found.',
  EVENT_NOT_OWNED: 'This event is not available to this organizer.',
  EVENT_INCOMPLETE: 'Complete every required event detail before publishing.',
  EVENT_TIME_INVALID: 'Choose a future start time and an end time after it.',
  EVENT_LOCATION_INVALID: 'Choose a verified California address.',
  EVENT_OUTSIDE_SERVICE_AREA: 'Choose a location inside the current Bay Area service area.',
  PAID_PUBLISHING_NOT_AVAILABLE:
    'Paid event publishing is not available in this milestone. Choose Free to publish.',
  EVENT_MODERATION_BLOCKED: 'This event cannot be published in its current moderation state.',
}

function isPublishEventErrorCode(message: unknown): message is PublishEventErrorCode {
  return typeof message === 'string' && Object.hasOwn(publishErrorCopy, message)
}

export function getPublishErrorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    isPublishEventErrorCode(error.message)
  ) {
    return publishErrorCopy[error.message]
  }

  return 'Publishing failed. Try again.'
}
