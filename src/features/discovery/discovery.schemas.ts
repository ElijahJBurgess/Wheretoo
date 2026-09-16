import { z } from 'zod'
import { publicTextSchema } from '../../lib/publicText.schema'
import { eventCategories } from '../events/event.types'
import type { DiscoveryPageData } from './discovery.types'

const instant = z.string().datetime({ offset: true })
const timezone = z.string().max(100).refine(value => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true } catch { return false }
})
const row = z.strictObject({
  id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
  title: publicTextSchema(3, 120), category: z.enum(eventCategories), admissionType: z.enum(['free', 'paid']),
  startsAt: instant, endsAt: instant, timezone, venueName: publicTextSchema(0, 160).nullable(), city: publicTextSchema(1, 500),
  artworkReference: z.null(),
  // P01 and artwork publication remain gated; accepting richer live facts would bypass that boundary.
  admission: z.strictObject({ state: z.literal('unknown'), minimumBuyerAmountMinor: z.null(), currency: z.null() }),
}).refine(value => Date.parse(value.startsAt) < Date.parse(value.endsAt))
const envelope = z.strictObject({
  items: z.array(z.unknown()).max(50), nextCursor: z.string().min(1).max(1024).regex(/^[A-Za-z0-9_-]+$/).nullable(),
  window: z.strictObject({ start: instant, end: instant, timezone: z.literal('America/Los_Angeles') })
    .refine(value => Date.parse(value.start) < Date.parse(value.end)),
  serverNow: instant,
})

export function parseDiscoveryPage(input: unknown): DiscoveryPageData {
  const value = envelope.parse(input)
  const items = value.items.flatMap(item => {
    const result = row.safeParse(item)
    return result.success ? [result.data] : []
  })
  if (value.items.length > 0 && items.length === 0) throw new Error('Invalid discovery response')
  return { ...value, items, invalidItemCount: value.items.length - items.length }
}
