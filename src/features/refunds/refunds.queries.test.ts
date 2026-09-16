import { expect, it } from 'vitest'
import { refundPollInterval } from './refunds.queries'
import { RefundAccessError } from './refunds.api'
import { refundFixture } from './refunds.fixtures'
import type { RefundStatus } from './refunds.schemas'
it('polls only uncertain progress and immediately stops on authorization loss', () => {
 for (const state of ['submitting', 'processing', 'unknown'] as const) {
  const data: RefundStatus = { ...refundFixture, state, action: 'none' }
  expect(refundPollInterval(data, null)).toBe(5000)
  expect(refundPollInterval(data, new RefundAccessError(true))).toBe(false)
 }
 for (const state of ['eligible', 'failed', 'review', 'completed', 'ineligible'] as const) expect(refundPollInterval({ ...refundFixture, state }, null)).toBe(false)
 expect(refundPollInterval(undefined, null)).toBe(false)
})
