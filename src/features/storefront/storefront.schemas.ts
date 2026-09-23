import { z } from 'zod'
const uuid = z.uuid()
export const storefrontCursorSchema = z.strictObject({
  handle: z.string(),
  featured: uuid.nullable(),
  start: z.string(),
  id: uuid,
})
export const storefrontEventSchema = z.strictObject({
  id: uuid,
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  timezone: z.string(),
  venue: z.string().nullable(),
  city: z.string().nullable(),
  flyerId: uuid.nullable(),
  admissionType: z.enum(['free', 'paid']),
  admission: z.strictObject({
    state: z.enum(['available', 'sold_out', 'unavailable']),
    minimumAmountMinor: z.number().int().nonnegative().nullable(),
    currency: z.string().nullable(),
  }),
})
export const storefrontDocumentSchema = z.strictObject({
  identity: z.strictObject({
    handle: z.string().nullable(),
    name: z.string(),
    bio: z.string().nullable(),
    city: z.string().nullable(),
    logoId: uuid.nullable(),
    coverId: uuid.nullable(),
    accent: z.string().nullable(),
    links: z.record(z.string(), z.string()),
    websiteUrl: z.string().nullable(),
  }),
  featured: storefrontEventSchema.nullable(),
  events: z.array(storefrontEventSchema).max(20),
  nextCursor: storefrontCursorSchema.nullable(),
  serverNow: z.string(),
  merch: z.array(
    z.strictObject({
      id: uuid,
      imageId: uuid,
      title: z.string(),
      price: z.string().nullable(),
      url: z.string(),
    }),
  ).max(3),
  storeUrl: z.string().nullable(),
})
export type StorefrontEvent = z.infer<typeof storefrontEventSchema>
export type StorefrontDocument = z.infer<typeof storefrontDocumentSchema>
export type StorefrontCursor = z.infer<typeof storefrontCursorSchema>
