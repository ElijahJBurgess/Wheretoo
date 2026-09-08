import { describe, expect, it } from 'vitest'
import {
  checkoutAttemptMatches,
  task18EventTitle,
  task18MapboxFeatureId,
} from '../e2e/support/ticketingFixture'

describe('Task 18 visual fixture naming', () => {
  it('uses representative human event names without runner or credential identifiers', () => {
    expect(task18EventTitle('mobile-chromium', 'purchase')).toBe('Sunset Sessions at the Ferry Building')
    expect(task18EventTitle('mobile-chromium', 'visual')).toBe('Friday Night at the Ferry Building')
    expect(task18EventTitle('desktop-chromium', 'purchase')).toBe('Night Market Live at the Ferry Building')
    expect(task18EventTitle('desktop-chromium', 'visual')).toBe('Golden Gate Rooftop Sessions')
  })

  it('keeps rerun identity in hidden verified-location metadata', () => {
    expect(task18MapboxFeatureId('task18_123456789abc', 'mobile-chromium', 'visual'))
      .toBe('task18.task18_123456789abc.mobile-chromium.visual')
  })

  it('compares retry identities without putting either value in assertion output', () => {
    const first = { clientRequestId: 'request-a', confirmationBearer: 'bearer-a' }

    expect(checkoutAttemptMatches(first, { ...first })).toBe(true)
    expect(checkoutAttemptMatches(first, { ...first, confirmationBearer: 'bearer-b' })).toBe(false)
  })
})
