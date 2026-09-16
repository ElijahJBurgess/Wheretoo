import { expect, it } from 'vitest'
import type { OrderConfirmation } from '../orders/order.types'
import { createEventCalendar } from './calendar'

const order: OrderConfirmation = {
  status: 'paid', orderNumber: 'WT-CALENDAR', quantity: 1, currency: 'usd', subtotalMinor: 2500, taxAmountMinor: 0, totalMinor: 2500,
  items: [{ tierName: 'Entry', quantity: 1, unitAmountMinor: 2500, subtotalMinor: 2500, currency: 'usd' }],
  event: { title: 'Music, art; tonight\nDoors at seven', startsAt: '2026-09-19T19:00:00-07:00', endsAt: '2026-09-19T22:00:00-07:00', timezone: 'America/Los_Angeles', venueName: 'The Roof' },
}

it('exports real event times in UTC and escapes text so it cannot inject calendar properties', () => {
  const file = createEventCalendar(order, new Date('2026-09-18T12:00:00Z'))
  expect(file).toContain('DTSTART:20260920T020000Z\r\nDTEND:20260920T050000Z')
  expect(file).toContain('SUMMARY:Music\\, art\\; tonight\\nDoors at seven')
  expect(file).toContain('DTSTAMP:20260918T120000Z')
  expect(file.match(/BEGIN:VEVENT/g)).toHaveLength(1)
})

it('folds long Unicode content at calendar line limits without corrupting the event title', () => {
  const title = 'Night 🌆 '.repeat(20)
  const file = createEventCalendar({ ...order, event: { ...order.event, title } }, new Date('2026-09-18T12:00:00Z'))
  for (const line of file.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
  expect(file.replaceAll('\r\n ', '')).toContain(`SUMMARY:${title}`)
})

it('creates an RSVP calendar entry without an order or financial fields', async () => {
 const {createAdmissionCalendar}=await import('./calendar')
 const value=createAdmissionCalendar({uid:'rsvp-registration-123',title:'Free Picnic',startsAt:'2027-01-01T18:00:00Z',endsAt:'2027-01-01T20:00:00Z',location:'City Park'},new Date('2026-01-01T00:00:00Z'))
 expect(value).toContain('UID:rsvp-registration-123@wheretoo');expect(value).toContain('SUMMARY:Free Picnic');expect(value).not.toContain('paid')
})
