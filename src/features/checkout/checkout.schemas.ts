import { z } from 'zod'

export const checkoutInputSchema = z
  .object({
    eventId: z.uuid(),
    tierId: z.uuid(),
    buyerName: z.string().trim().min(1).max(120),
    buyerEmail: z.string().trim().toLowerCase().email().max(320),
    clientRequestId: z.uuid(),
    quantity: z.literal(1),
  })
  .strict()

export type CheckoutInput = z.output<typeof checkoutInputSchema>
