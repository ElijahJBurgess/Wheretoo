import { z } from 'zod'
import { lowercaseRfcUuidSchema } from '../tickets/ticket.schemas'

export const checkoutInputSchema = z
  .object({
    eventId: lowercaseRfcUuidSchema,
    tierId: lowercaseRfcUuidSchema,
    buyerName: z.string().trim().min(1).max(120),
    buyerEmail: z.string().trim().toLowerCase().email().max(320),
    clientRequestId: lowercaseRfcUuidSchema,
    quantity: z.literal(1),
  })
  .strict()

export type CheckoutInput = z.output<typeof checkoutInputSchema>
