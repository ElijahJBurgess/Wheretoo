import { describe, expect, it } from 'vitest'
import {
  MAX_CHECKOUT_QUANTITY,
  encodeCheckoutCart,
  parseCheckoutCart,
} from './checkout.cart'

const gaTierId = '900a9142-9111-4f87-84d5-b8545a94c7fb'
const vipTierId = '6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe'

describe('checkout cart URL codec', () => {
  it('round trips one admission and sorts multiple tiers by canonical UUID', () => {
    const search = encodeCheckoutCart([
      { tierId: gaTierId, quantity: 2 },
      { tierId: vipTierId, quantity: 1 },
    ])

    expect(search).toBe(`item=${vipTierId}%3A1&item=${gaTierId}%3A2`)
    expect(parseCheckoutCart(`?${search}`, [gaTierId, vipTierId])).toEqual([
      { tierId: vipTierId, quantity: 1 },
      { tierId: gaTierId, quantity: 2 },
    ])
    expect(parseCheckoutCart(`?item=${gaTierId}%3A1`, [gaTierId])).toEqual([
      { tierId: gaTierId, quantity: 1 },
    ])
  })

  it('accepts exactly ten admissions across multiple tiers', () => {
    expect(parseCheckoutCart(
      `?item=${gaTierId}%3A6&item=${vipTierId}%3A4`,
      [gaTierId, vipTierId],
    )).toEqual([
      { tierId: vipTierId, quantity: 4 },
      { tierId: gaTierId, quantity: 6 },
    ])
    expect(MAX_CHECKOUT_QUANTITY).toBe(10)
  })

  it.each([
    ['', [gaTierId]],
    [`?item=${gaTierId}%3A1&item=${gaTierId}%3A2`, [gaTierId]],
    [`?item=${vipTierId}%3A1`, [gaTierId]],
    ['?item=not-a-uuid%3A1', [gaTierId]],
    [`?item=${gaTierId}%3A0`, [gaTierId]],
    [`?item=${gaTierId}%3A1.5`, [gaTierId]],
    [`?item=${gaTierId}%3A11`, [gaTierId]],
    [`?item=${gaTierId}%3A7&item=${vipTierId}%3A4`, [gaTierId, vipTierId]],
    [`?item=${gaTierId}%3A1&price=2500`, [gaTierId]],
  ])('rejects a missing, duplicate, unknown, malformed, overflow, or non-public cart: %s', (search, knownTierIds) => {
    expect(parseCheckoutCart(search, knownTierIds)).toBeNull()
  })
})
