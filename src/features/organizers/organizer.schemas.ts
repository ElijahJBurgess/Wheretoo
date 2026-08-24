import { z } from 'zod'

export const organizerInputSchema = z.object({
  displayName: z.string().trim().min(2).max(100),
  organizerType: z.string().trim().max(80).optional().or(z.literal('')),
  bio: z.string().max(500).optional().or(z.literal('')),
  websiteUrl: z.string().trim().url().max(500).optional().or(z.literal('')),
  baseCity: z.string().trim().max(120).optional().or(z.literal('')),
})

export type OrganizerInput = z.infer<typeof organizerInputSchema>
