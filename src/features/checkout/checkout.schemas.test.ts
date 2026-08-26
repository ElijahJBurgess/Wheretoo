import { describe, expect, it } from 'vitest'
import { checkoutInputSchema } from './checkout.schemas'

const validCheckout = {
  eventId: '6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe',
  tierId: 'eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f',
  buyerName: 'Avery Stone',
  buyerEmail: 'avery@example.com',
  clientRequestId: '900a9142-9111-4f87-84d5-b8545a94c7fb',
  quantity: 1,
}

describe('checkoutInputSchema', () => {
  it('accepts UUID identifiers, quantity one, and normalizes guest name and email', () => {
    expect(
      checkoutInputSchema.parse({
        ...validCheckout,
        buyerName: '  Avery Stone  ',
        buyerEmail: '  AVERY@EXAMPLE.COM  ',
      }),
    ).toEqual({ ...validCheckout, buyerEmail: 'avery@example.com' })
  })

  it.each([
    ['eventId', 'not-a-uuid'],
    ['tierId', 'not-a-uuid'],
    ['clientRequestId', 'not-a-uuid'],
    ['buyerName', ' '],
    ['buyerName', 'x'.repeat(121)],
    ['buyerEmail', 'not-an-email'],
    ['buyerEmail', `guest@${'x'.repeat(315)}.com`],
    ['quantity', 0],
    ['quantity', 2],
    ['quantity', 1.5],
  ])('rejects invalid %s values', (field, value) => {
    expect(checkoutInputSchema.safeParse({ ...validCheckout, [field]: value }).success).toBe(false)
  })

  it.each([
    ['unitAmountMinor', 2_500],
    ['subtotalMinor', 2_500],
    ['applicationFeeAmountMinor', 175],
    ['currency', 'usd'],
    ['stripeAccountId', 'acct_testdestination'],
    ['destination', 'acct_testdestination'],
  ])('rejects browser-supplied %s financial or destination data', (field, value) => {
    expect(checkoutInputSchema.safeParse({ ...validCheckout, [field]: value }).success).toBe(false)
  })
})
