import { z } from 'zod'
export const imageRecordSchema = z.object({ id: z.string().uuid(), eventId: z.string().uuid(), path: z.string(), position: z.number().int().min(1).max(3), owned: z.boolean().nullable() })
export type EventImage = z.infer<typeof imageRecordSchema> & { url: string }
