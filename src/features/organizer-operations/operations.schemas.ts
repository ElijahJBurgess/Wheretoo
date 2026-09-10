import { z } from 'zod'
const count = z.number().int().nonnegative().safe()
export const operationEventSchema = z.strictObject({
  id: z.uuid(), title: z.string().nullable(), startsAt: z.iso.datetime({ offset: true }).nullable(),
  endsAt: z.iso.datetime({ offset: true }).nullable(), venueName: z.string().nullable(),
  city: z.string().nullable(), status: z.enum(['draft', 'published', 'cancelled']), artworkPath: z.string().nullable(),
})
export const metricsSchema = z.strictObject({
  event: operationEventSchema, grossSalesMinor: count, sold: count, orderCount: count,
  issued: count, checkedIn: count, capacity: count.nullable(), admissionEligible: z.boolean(),
  tiers: z.array(z.strictObject({
    id: z.uuid(), name: z.string(), status: z.enum(['active', 'draft', 'archived']),
    capacity: count, sold: count, remaining: count, grossSalesMinor: count,
  })),
}).refine((value) => value.checkedIn <= value.issued)
export type EventMetrics = z.infer<typeof metricsSchema>
