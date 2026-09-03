import { z } from 'zod'
import { lowercaseRfcUuidSchema } from '../tickets/ticket.schemas'

export const checkoutItemSchema = z
  .object({
    tierId: lowercaseRfcUuidSchema,
    quantity: z.number().int().min(1).max(10),
  })
  .strict()

export const checkoutItemsSchema = z
  .array(checkoutItemSchema)
  .min(1)
  .max(10)
  .superRefine((items, context) => {
    const seenTierIds = new Set<string>()
    let total = 0
    items.forEach((item, index) => {
      if (seenTierIds.has(item.tierId)) {
        context.addIssue({ code: 'custom', path: [index, 'tierId'], message: 'Ticket tiers must be unique.' })
      }
      seenTierIds.add(item.tierId)
      total += item.quantity
    })
    if (total > 10) {
      context.addIssue({ code: 'custom', message: 'A checkout can contain at most 10 tickets.' })
    }
  })
  .transform((items) => [...items].sort((left, right) => left.tierId.localeCompare(right.tierId)))

export const checkoutCanonicalSubmissionSchema = z
  .object({
    eventId: lowercaseRfcUuidSchema,
    buyerName: z.string().trim().min(1).max(120),
    buyerEmail: z.string().trim().toLowerCase().email().max(320),
    items: checkoutItemsSchema,
  })
  .strict()

export const checkoutInputSchema = checkoutCanonicalSubmissionSchema.extend({
  clientRequestId: lowercaseRfcUuidSchema,
})

export type CheckoutItem = z.output<typeof checkoutItemSchema>
export type CheckoutCanonicalSubmission = z.input<typeof checkoutCanonicalSubmissionSchema>
export type CheckoutInput = z.output<typeof checkoutInputSchema>
