import { z } from 'zod'
export const socialLabels = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  x: 'X / Twitter',
  youtube: 'YouTube',
} as const
export function safeExternalUrl(value: string) {
  if (value.length > 2048 || /[\s\\]/.test(value)) return false
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !!url.hostname &&
      !url.username && !url.password
  } catch {
    return false
  }
}
export function validSocialUrl(key: string, value: string) {
  if (!safeExternalUrl(value)) return false
  const hosts: Record<string, string[]> = {
    instagram: ['instagram.com'],
    tiktok: ['tiktok.com'],
    x: ['x.com', 'twitter.com'],
    youtube: ['youtube.com', 'youtu.be'],
  }
  return hosts[key]?.includes(new URL(value).hostname.replace(/^www\./, '')) ??
    false
}
const nullableText = (limit: number) => z.string().max(limit).nullable()
export const editorInputSchema = z.strictObject({
  name: z.string().trim().min(2).max(100),
  bio: nullableText(500),
  city: nullableText(120),
  websiteUrl: z.string().max(500, 'Website must be 500 characters or fewer.')
    .refine(
      safeExternalUrl,
      'Use an HTTP or HTTPS URL without credentials.',
    ).nullable(),
  logoId: z.uuid().nullable(),
  coverId: z.uuid().nullable(),
  accent: z.enum(['violet', 'blue', 'rose', 'amber']).nullable(),
  links: z.record(z.string(), z.string()).refine(
    (value) =>
      Object.entries(value).every(([key, url]) => validSocialUrl(key, url)),
    'Choose an approved social link and its matching website.',
  ),
  featuredEventId: z.uuid().nullable(),
})
export const editorSchema = editorInputSchema.extend({
  handle: z.string().nullable(),
  status: z.enum(['draft', 'published']),
  updatedAt: z.string(),
  merch: z.array(
    z.strictObject({
      id: z.uuid(),
      imageId: z.uuid(),
      title: z.string(),
      price: z.string().nullable(),
      url: z.string(),
    }),
  ).max(3).default([]),
  storeUrl: z.string().nullable().default(null),
})
export type StorefrontEditor = z.infer<typeof editorSchema>
export type StorefrontInput = z.infer<typeof editorInputSchema>
export function editorInput(value: StorefrontEditor): StorefrontInput {
  return {
    name: value.name,
    bio: value.bio,
    city: value.city,
    websiteUrl: value.websiteUrl,
    logoId: value.logoId,
    coverId: value.coverId,
    accent: value.accent,
    links: value.links,
    featuredEventId: value.featuredEventId,
  }
}
