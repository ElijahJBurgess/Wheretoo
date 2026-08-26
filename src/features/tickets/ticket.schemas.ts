import { z } from 'zod'

const ticketTierInputSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(80),
    description: z
      .string()
      .trim()
      .max(240)
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .optional(),
    unitAmountMinor: z.number().int().min(1).max(99_999_999),
    currency: z.literal('usd'),
    quantityTotal: z.number().int().min(1).max(2_147_483_647),
    sortOrder: z.number().int().min(1).max(3),
  })
  .strict()

export const ticketTiersInputSchema = z
  .array(ticketTierInputSchema)
  .min(1)
  .max(3)
  .superRefine((tiers, context) => {
    const names = new Set<string>()
    const sortOrders = new Set<number>()

    tiers.forEach((tier, index) => {
      const normalizedName = tier.name.toLocaleLowerCase('en-US')
      if (names.has(normalizedName)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'name'],
          message: 'Ticket tier names must be unique.',
        })
      }
      names.add(normalizedName)

      if (sortOrders.has(tier.sortOrder)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'sortOrder'],
          message: 'Ticket tier positions must be unique.',
        })
      }
      sortOrders.add(tier.sortOrder)
    })
  })
