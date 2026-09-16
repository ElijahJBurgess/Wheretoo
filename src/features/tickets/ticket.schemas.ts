import { z } from 'zod'
import { publicTextSchema } from '../../lib/publicText.schema'
import { eventCategories } from '../events/event.types'

export const lowercaseRfcUuidSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)

const ticketTierInputSchema = z
  .object({
    id: lowercaseRfcUuidSchema.optional(),
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

const publicTicketTierSchema = z
  .object({
    id: lowercaseRfcUuidSchema,
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(240).nullable(),
    unit_amount_minor: z.number().int().min(1).max(99_999_999),
    currency: z.literal('usd'),
    availability_status: z.enum(['available', 'sold_out']),
  })
  .strict()

export type PublicTicketTier = z.output<typeof publicTicketTierSchema>
export type PublicTicketTierTuple =
  | [PublicTicketTier]
  | [PublicTicketTier, PublicTicketTier]
  | [PublicTicketTier, PublicTicketTier, PublicTicketTier]

const publicTicketTiersSchema = z
  .array(publicTicketTierSchema)
  .min(1)
  .max(3)
  .transform((tiers): PublicTicketTierTuple => {
    const [first, second, third] = tiers
    if (first === undefined) {
      throw new Error('At least one public ticket tier is required.')
    }
    if (second === undefined) {
      return [first]
    }
    if (third === undefined) {
      return [first, second]
    }
    return [first, second, third]
  })

const publicEventProjectionSchema = z
  .object({
    id: lowercaseRfcUuidSchema,
    title: publicTextSchema(3, 120),
    description: publicTextSchema(20, 5_000),
    category: z.enum(eventCategories),
    starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }),
    timezone: z.string(),
    venue_name: publicTextSchema(0, 160).nullable(),
    address_line1: z.string().trim().min(1),
    address_line2: z.string().nullable(),
    city: z.string().trim().min(1),
    region: z.literal('CA'),
    postal_code: z.string().trim().min(1),
    country_code: z.literal('US'),
    latitude: z.number().finite().min(36.8).max(38.9),
    longitude: z.number().finite().min(-123.6).max(-121),
    artwork_path: z.string().trim().min(1).nullable(),
    animation_preset: z.string().trim().min(1),
    minimum_age: z.enum(['all_ages', '18_plus', '21_plus']),
    advisories: z.array(z.enum(['alcohol', 'cannabis', 'mature_content'])),
    organizer: z
      .object({
        id: lowercaseRfcUuidSchema,
        display_name: publicTextSchema(2, 100),
      })
      .strict(),
  })
  .strict()

export const publicPaidTicketingEventSchema = z
  .object({
    event: publicEventProjectionSchema.extend({ admission_type: z.literal('paid') }),
    tiers: publicTicketTiersSchema,
  })
  .strict()

export const publicFreeEventSchema = publicEventProjectionSchema.extend({
  admission_type: z.literal('free'),
})

const publicFreeEventShellSchema = z
  .object({
    event: publicFreeEventSchema,
    tiers: z.tuple([]),
  })
  .strict()

export const publicTicketingEventSchema = z.union([
  publicPaidTicketingEventSchema,
  publicFreeEventShellSchema,
])
