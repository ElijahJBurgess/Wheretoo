import { describe, expect, it } from 'vitest'
import { checkoutInputSchema } from './checkout.schemas'

const validCheckout = {
  eventId: '6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe',
  buyerName: 'Avery Stone',
  buyerEmail: 'avery@example.com',
  clientRequestId: '900a9142-9111-4f87-84d5-b8545a94c7fb',
  items: [
    { tierId: 'eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f', quantity: 2 },
    { tierId: '10823f25-2860-4b63-968c-749e8047561d', quantity: 1 },
  ],
}

describe('checkoutInputSchema', () => {
  it('accepts exact request keys, normalizes identity, and sorts canonical items', () => {
    expect(
      checkoutInputSchema.parse({
        ...validCheckout,
        buyerName: '  Avery Stone  ',
        buyerEmail: '  AVERY@EXAMPLE.COM  ',
      }),
    ).toEqual({
      ...validCheckout,
      buyerEmail: 'avery@example.com',
      items: [...validCheckout.items].reverse(),
    })
  })

  it.each([
    ['eventId', 'not-a-uuid'],
    ['clientRequestId', 'not-a-uuid'],
    ['buyerName', ' '],
    ['buyerName', 'x'.repeat(121)],
    ['buyerEmail', 'not-an-email'],
    ['buyerEmail', `guest@${'x'.repeat(315)}.com`],
  ])('rejects invalid %s values', (field, value) => {
    expect(checkoutInputSchema.safeParse({ ...validCheckout, [field]: value }).success).toBe(false)
  })

  const invalidItems: unknown[] = [
    [],
    [{ tierId: validCheckout.items[0].tierId, quantity: 0 }],
    [{ tierId: validCheckout.items[0].tierId, quantity: 11 }],
    [{ tierId: validCheckout.items[0].tierId, quantity: 1.5 }],
    [{ tierId: 'not-a-uuid', quantity: 1 }],
    [{ tierId: validCheckout.items[0].tierId, quantity: 1 }, { tierId: validCheckout.items[0].tierId, quantity: 1 }],
    [{ tierId: validCheckout.items[0].tierId, quantity: 7 }, { tierId: validCheckout.items[1].tierId, quantity: 4 }],
  ]

  it.each(invalidItems)('rejects invalid or aggregate-overflow items: %j', (items) => {
    expect(checkoutInputSchema.safeParse({ ...validCheckout, items }).success).toBe(false)
  })

  it.each([
    ['unitAmountMinor', 2_500],
    ['subtotalMinor', 2_500],
    ['applicationFeeAmountMinor', 175],
    ['currency', 'usd'],
    ['stripeAccountId', 'acct_testdestination'],
    ['destination', 'acct_testdestination'],
    ['confirmationBearer', 'secret'],
    ['ticketId', 'internal'],
  ])('rejects browser-supplied %s financial or destination data', (field, value) => {
    expect(checkoutInputSchema.safeParse({ ...validCheckout, [field]: value }).success).toBe(false)
  })
})
