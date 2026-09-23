import { z } from 'zod'
import { publicEnv } from '../../lib/env'
import { supabase } from '../../lib/supabase/client'
export const coverMoods = [
  'Nightlife',
  'Editorial',
  'Minimal',
  'Colorful',
  'Underground',
  'Luxury',
  'Community',
  'Energetic',
  'Surprise me',
] as const
const candidateSchema = z.object({
  id: z.string().uuid(),
  slot: z.number().int().min(1).max(3),
  status: z.enum(['pending', 'ready', 'failed']),
  path: z.string().nullable(),
  failureCode: z.string().nullable(),
  attempts: z.number().int().min(0).max(2),
  retryAfter: z.string(),
})
const generationSchema = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  input: z.object({
    mood: z.string().optional(),
    direction: z.string().optional(),
  }),
  selectedSlot: z.number().nullable(),
  expired: z.boolean(),
  expiresAt: z.string(),
  candidates: z.array(candidateSchema).length(3),
})
export type CoverGeneration =
  & Omit<z.infer<typeof generationSchema>, 'candidates'>
  & { candidates: (z.infer<typeof candidateSchema> & { url?: string })[] }
type CoverRequest =
  | {
    action: 'start'
    eventId: string
    revision: number
    requestId: string
    mood: string
    direction: string
  }
  | { action: 'state'; generationId: string }
  | { action: 'step'; generationId: string; slot: number; attempt: number }
const errors: Record<string, string> = {
  COVER_EVENT_LIMIT:
    'This event has reached its daily limit. Try again tomorrow.',
  COVER_ORGANIZER_LIMIT:
    'You have reached your daily limit. Try again tomorrow.',
  COVER_ACTIVE:
    'Another cover set is still generating. Reopen that event or try again in 15 minutes.',
  COVER_STALE: 'Your cover changed. Refresh and generate a new set.',
  COVER_RETRY_UNAVAILABLE:
    'This cover cannot be retried yet. Wait a moment, or generate a new set.',
  COVER_RETRY_LIMIT: 'This cover has used its retry. Generate a new set.',
  COVER_SAVE_DETAILS: 'Save a title and your event details before generating.',
  GENERATION_DISABLED:
    'AI covers are not available yet. You can still upload a cover.',
}
export async function requestAiCover(
  body: CoverRequest,
  current: () => boolean,
): Promise<CoverGeneration> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session || !current()) {
    throw new Error('Your session changed. Sign in again.')
  }
  const response = await fetch(
    `${publicEnv.supabaseUrl}/functions/v1/event-cover-generation`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.access_token}`,
        apikey: publicEnv.supabasePublishableKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  )
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as {
      error?: string
    }
    throw new Error(
      errors[payload.error ?? ''] ??
        'Generation could not be confirmed. Refresh covers before trying again.',
    )
  }
  const generation = generationSchema.parse(await response.json())
  if (!current()) throw new Error('Your session changed. Sign in again.')
  const ready = generation.candidates.filter((c) =>
    c.status === 'ready' && c.path
  )
  const signed = ready.length
    ? await supabase.storage.from('event-cover-candidates').createSignedUrls(
      ready.map((c) => c.path!),
      60,
    )
    : null
  if (signed?.error) {
    throw new Error(
      'Private previews could not load. Refresh covers to try again.',
    )
  }
  if (!current()) throw new Error('Your session changed. Sign in again.')
  return {
    ...generation,
    candidates: generation.candidates.map((c) => ({
      ...c,
      url: signed?.data?.[ready.findIndex((r) => r.id === c.id)]?.signedUrl ??
        undefined,
    })),
  }
}
