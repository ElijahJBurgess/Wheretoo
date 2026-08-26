export type PaidSalesErrorCode =
  | 'CONNECT_ACTION_REQUIRED'
  | 'CONNECT_NOT_READY'
  | 'EVENT_INCOMPLETE'
  | 'EVENT_LOCATION_INVALID'
  | 'EVENT_MODERATION_BLOCKED'
  | 'EVENT_NOT_FOUND'
  | 'EVENT_NOT_SELLABLE'
  | 'EVENT_OUTSIDE_SERVICE_AREA'
  | 'EVENT_TIME_INVALID'
  | 'FEE_RULE_NOT_CONFIGURED'
  | 'TIER_INVALID'
  | 'TIER_LIMIT_EXCEEDED'
  | 'TIER_LOCKED_AFTER_SALE'
  | 'TIER_NOT_ACTIVE'
  | 'TIER_NOT_FOUND'

export const paidSalesErrorCopy: Record<PaidSalesErrorCode, string> = {
  CONNECT_ACTION_REQUIRED: 'Finish payment setup before activating paid ticket sales.',
  CONNECT_NOT_READY: 'Finish payment setup before activating paid ticket sales.',
  EVENT_INCOMPLETE: 'Complete every required event detail before activating paid ticket sales.',
  EVENT_LOCATION_INVALID: 'Choose a verified California address before activating paid ticket sales.',
  EVENT_MODERATION_BLOCKED: 'This event cannot accept paid ticket sales in its current moderation state.',
  EVENT_NOT_FOUND: 'This event could not be found.',
  EVENT_NOT_SELLABLE: 'This event is not available for ticket changes.',
  EVENT_OUTSIDE_SERVICE_AREA: 'Choose a location inside the current Bay Area service area.',
  EVENT_TIME_INVALID: 'Choose a future start time and an end time after it.',
  FEE_RULE_NOT_CONFIGURED: 'Paid ticket sales are not available right now. Try again later.',
  TIER_INVALID: 'Check each ticket tier and try again.',
  TIER_LIMIT_EXCEEDED: 'An event can have up to three ticket tiers.',
  TIER_LOCKED_AFTER_SALE: 'This tier already has ticket activity, so its capacity cannot be reduced.',
  TIER_NOT_ACTIVE: 'Add at least one active ticket tier before activating paid ticket sales.',
  TIER_NOT_FOUND: 'One of these ticket tiers is no longer available. Refresh and try again.',
}

function isPaidSalesErrorCode(value: unknown): value is PaidSalesErrorCode {
  return typeof value === 'string' && Object.hasOwn(paidSalesErrorCopy, value)
}

export function getPaidSalesErrorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    isPaidSalesErrorCode(error.message)
  ) {
    return paidSalesErrorCopy[error.message]
  }

  return 'Ticket setup could not be updated. Try again.'
}
