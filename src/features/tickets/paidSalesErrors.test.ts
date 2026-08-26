import { describe, expect, it } from 'vitest'
import { getPaidSalesErrorMessage, paidSalesErrorCopy } from './paidSalesErrors'

describe('paid sales error copy', () => {
  it.each(Object.entries({
    EVENT_NOT_FOUND: 'This event could not be found.',
    TIER_LOCKED_AFTER_SALE: 'This tier already has ticket activity, so its capacity cannot be reduced.',
    CONNECT_NOT_READY: 'Finish payment setup before activating paid ticket sales.',
  }))('maps %s to safe organizer guidance', (code, copy) => {
    expect(paidSalesErrorCopy).toHaveProperty(code, copy)
    expect(getPaidSalesErrorMessage({ message: code, details: 'private database detail' })).toBe(copy)
  })

  it('suppresses unknown database details', () => {
    expect(getPaidSalesErrorMessage({ message: 'permission denied for table orders' })).toBe(
      'Ticket setup could not be updated. Try again.',
    )
  })
})
