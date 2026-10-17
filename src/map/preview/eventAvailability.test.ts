import { describe, expect, it } from 'vitest'
import { formatEventPrice } from './eventPreviewFormatting'
import { getDevelopmentMapEvents } from '../data/developmentMapEvents'

const paid = getDevelopmentMapEvents()[0]
describe('preview availability pricing', () => {
  it('does not advertise a cached tier price as available', () => {
    expect(formatEventPrice(paid)).toBe('Availability unknown')
  })
  it('shows only the lowest authoritatively available price', () => {
    expect(formatEventPrice(paid, { status: 'available', minimumPriceMinor: 3000 })).toBe('From $30')
    expect(formatEventPrice(paid, { status: 'sold_out', minimumPriceMinor: null })).toBe('Sold out')
    expect(formatEventPrice(paid, null)).toBe('Currently unavailable')
  })
})
