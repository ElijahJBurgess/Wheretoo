import { z } from 'zod'

const validUrlSchema = z.string().url()

export const organizerInputSchema = z.object({
  displayName: z.string().trim().min(2).max(100),
  organizerType: z.string().trim().max(80).optional().or(z.literal('')),
  bio: z.string().max(500).optional().or(z.literal('')),
  websiteUrl: z
    .string()
    .trim()
    .max(500)
    .refine((value) => value === '' || validUrlSchema.safeParse(value).success, 'Invalid URL')
    .refine(
      (value) => value === '' || /^https?:\/\//.test(value),
      'Website must start with lowercase http:// or https://',
    )
    .optional(),
  baseCity: z.string().trim().max(120).optional().or(z.literal('')),
})

export type OrganizerInput = z.infer<typeof organizerInputSchema>
