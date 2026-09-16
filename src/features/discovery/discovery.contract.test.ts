import { describe, expect, it } from 'vitest'
import { parseDiscoverySearch, serializeDiscoveryFilters, toggleDiscoveryFilter } from './discovery.filters'
import { parseDiscoveryPage } from './discovery.schemas'
import { publicFreeEventSchema } from '../tickets/ticket.schemas'

const item = {
  id: '00000000-0000-4000-8000-000000000001', title: 'A Bay Area event', category: 'music', admissionType: 'paid',
  startsAt: '2026-09-13T18:00:00Z', endsAt: '2026-09-14T04:00:00Z', timezone: 'America/Los_Angeles',
  venueName: 'The Courtyard', city: 'Oakland', artworkReference: null,
  admission: { state: 'unknown', minimumBuyerAmountMinor: null, currency: null },
}
const page = { items: [item], nextCursor: null, window: { start: '2026-09-13T07:00:00Z', end: '2026-10-13T07:00:00Z', timezone: 'America/Los_Angeles' }, serverNow: '2026-09-13T12:00:00Z' }

describe('public discovery URL state', () => {
  it('drops unknown fields and values without carrying credentials or return destinations', () => {
    const filters = parseDiscoverySearch('?when=invalid&category=private&price=zero&email=private@example.test&return=https://elsewhere.test&token=secret')
    expect(filters).toEqual({ when: 'upcoming', category: null, price: null })
    expect(serializeDiscoveryFilters(filters)).toBe('')
  })
  it('retains all canonical categories, combines dimensions, and normalizes duplicate parameters', () => {
    expect(parseDiscoverySearch('?when=today&category=fitness&price=free&price=paid')).toEqual({ when: 'today', category: 'fitness', price: 'free' })
    expect(serializeDiscoveryFilters({ when: 'weekend', category: 'food_drink', price: 'paid' })).toBe('?when=weekend&category=food_drink&price=paid')
  })
  it('clears an active category and replaces the mutually exclusive admission filter', () => {
    const filters = { when: 'today', category: 'music', price: 'free' } as const
    expect(toggleDiscoveryFilter(filters, 'category', 'music')).toEqual({ when: 'today', category: null, price: 'free' })
    expect(toggleDiscoveryFilter(filters, 'price', 'paid')).toEqual({ when: 'today', category: 'music', price: 'paid' })
    expect(toggleDiscoveryFilter(filters, 'price', 'free')).toEqual({ when: 'today', category: 'music', price: null })
  })
})

describe('live discovery envelope', () => {
  it('keeps canonical Unicode character limits consistent through the public-event handoff', () => {
    const title = '🎵'.repeat(61)
    const venue = '🎪'.repeat(160)
    const result = parseDiscoveryPage({ ...page, items: [{ ...item, title: ` ${title} `, venueName: ` ${venue} ` }, null] })
    expect(result.items[0]?.title).toBe(title)
    expect(result.items[0]?.venueName).toBe(venue)
    expect(result.invalidItemCount).toBe(1)
    expect(publicFreeEventSchema.shape.title.parse(` ${title} `)).toBe(title)
    expect(publicFreeEventSchema.shape.venue_name.parse(` ${venue} `)).toBe(venue)
    expect(() => parseDiscoveryPage({ ...page, items: [{ ...item, title: 'a'.repeat(121) }] })).toThrow()
  })
  it('accepts empty successful reads and preserves unknown paid price rather than manufacturing zero', () => {
    expect(parseDiscoveryPage({ ...page, items: [] }).items).toEqual([])
    expect(parseDiscoveryPage(page).items[0]?.admission).toEqual({ state: 'unknown', minimumBuyerAmountMinor: null, currency: null })
  })
  it('quarantines individual malformed rows without losing valid results', () => {
    const parsed = parseDiscoveryPage({ ...page, items: [item, { ...item, title: '' }] })
    expect(parsed.items).toHaveLength(1)
    expect(parsed.invalidItemCount).toBe(1)
  })
  it('rejects all-invalid nonempty results, unknown fields, and unsupported live artwork/prices', () => {
    expect(() => parseDiscoveryPage({ ...page, items: [{ ...item, admissionType: 'free', buyerEmail: 'private@example.test' }] })).toThrow()
    expect(() => parseDiscoveryPage({ ...page, orderId: 'private' })).toThrow()
    expect(() => parseDiscoveryPage({ ...page, items: [{ ...item, artworkReference: 'https://image.test/photo.png' }] })).toThrow()
    expect(() => parseDiscoveryPage({ ...page, items: [{ ...item, admission: { state: 'open', minimumBuyerAmountMinor: 1000, currency: 'usd' } }] })).toThrow()
  })
  it('rejects invalid timezone, reversed intervals, oversized pages and malformed cursors', () => {
    expect(() => parseDiscoveryPage({ ...page, items: [{ ...item, timezone: 'not-a-zone' }] })).toThrow()
    expect(() => parseDiscoveryPage({ ...page, items: [{ ...item, endsAt: item.startsAt }] })).toThrow()
    expect(() => parseDiscoveryPage({ ...page, window: { ...page.window, end: page.window.start } })).toThrow()
    expect(() => parseDiscoveryPage({ ...page, items: Array.from({ length: 51 }, () => item) })).toThrow()
    expect(() => parseDiscoveryPage({ ...page, nextCursor: 'a'.repeat(1025) })).toThrow()
  })
})
