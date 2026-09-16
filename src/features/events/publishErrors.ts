import type { PublishEventErrorCode } from './event.types'

type ModerationPublishErrorCode =
  | PublishEventErrorCode
  | 'CONNECT_NOT_READY'
  | 'CONNECT_ACTION_REQUIRED'
  | 'TIER_NOT_ACTIVE'
  | 'TIER_INVALID'
  | 'TIER_LIMIT_EXCEEDED'
  | 'EVENT_DISCLOSURES_REQUIRED'
  | 'EVENT_POLICY_ACCEPTANCE_REQUIRED'
  | 'EVENT_PUBLIC_HISTORY_UNKNOWN'
  | 'POLICY_ENVIRONMENT_UNCONFIGURED'
  | 'POLICY_REQUIREMENTS_INVALID'

export const publishErrorCopy: Record<ModerationPublishErrorCode, string> = {
  CONNECT_NOT_READY: 'Complete Stripe setup before publishing paid tickets.',
  CONNECT_ACTION_REQUIRED: 'Update your Stripe account requirements before publishing paid tickets.',
  TIER_NOT_ACTIVE: 'Add at least one active ticket tier before publishing.',
  TIER_INVALID: 'Review your saved ticket prices and capacities before publishing.',
  TIER_LIMIT_EXCEEDED: 'Use no more than three ticket tiers.',
  EVENT_NOT_FOUND: 'This event could not be found.',
  EVENT_NOT_OWNED: 'This event is not available to this organizer.',
  EVENT_INCOMPLETE: 'Complete every required event detail before publishing.',
  EVENT_TIME_INVALID: 'Choose a future start time and an end time after it.',
  EVENT_LOCATION_INVALID: 'Choose a verified California address.',
  EVENT_OUTSIDE_SERVICE_AREA: 'Choose a location inside the current Bay Area service area.',
  PAID_PUBLISHING_NOT_AVAILABLE:
    'Paid event publishing is not available in this milestone. Choose Free to publish.',
  EVENT_MODERATION_BLOCKED: 'This event cannot be published in its current moderation state.',
  EVENT_DISCLOSURES_REQUIRED: 'Complete the event requirements before publishing.',
  EVENT_POLICY_ACCEPTANCE_REQUIRED:
    'Review and accept the current Organizer Terms and Event Policy before publishing.',
  EVENT_PUBLIC_HISTORY_UNKNOWN: 'This event needs moderation review before it can be published.',
  POLICY_ENVIRONMENT_UNCONFIGURED: 'Publishing is temporarily unavailable. Try again later.',
  POLICY_REQUIREMENTS_INVALID: 'Publishing is temporarily unavailable. Try again later.',
}

function isPublishEventErrorCode(message: unknown): message is ModerationPublishErrorCode {
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
