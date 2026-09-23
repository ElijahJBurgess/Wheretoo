import { freezeStorefrontAttribution } from '../storefront/storefront.attribution'
import { z } from 'zod'
import { publicEnv } from '../../lib/env'
import { publicFreeEventSchema } from '../tickets/ticket.schemas'
import { type FreeAttemptResult, parseFreeResult } from './rsvp.contract'
import type { RsvpAttempt } from './rsvp.attempt'
export const freeEventSchema = z.strictObject({
  event: publicFreeEventSchema,
  availability: z.strictObject({
    status: z.enum(['available', 'full']),
    remaining: z.number().int().nonnegative().nullable(),
    maxQuantity: z.literal(10),
  }),
}).refine((v) =>
  v.availability.status === 'full'
    ? v.availability.remaining === 0
    : v.availability.remaining === null || v.availability.remaining > 0
)
export type FreeRsvpEvent = z.infer<typeof freeEventSchema>
type AttemptInput = Pick<RsvpAttempt, 'requestId' | 'collectionBearer' | 'submission'>
export function createRsvpApi(fetcher: typeof fetch = (...args) => fetch(...args)) {
  async function post(path: string, body: unknown, attribution:Record<string,string>={}): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetcher(publicEnv.supabaseUrl + path, {
        method: 'POST',
        headers: { ...attribution, apikey: publicEnv.supabasePublishableKey, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      })
      if (!response.ok && response.status !== 400) throw new Error()
      return await response.json()
    } catch {
      throw new Error(
        'Your RSVP is not confirmed yet. Check its status before trying anything else.',
      )
    } finally {
      clearTimeout(timeout)
    }
  }
  return {
    async event(eventId: string): Promise<FreeRsvpEvent | null> {
      const value = await post('/rest/v1/rpc/get_public_free_rsvp', { p_event_id: eventId })
      return value === null ? null : freeEventSchema.parse(value)
    },
    async confirm(attempt: AttemptInput): Promise<FreeAttemptResult> {
      return parseFreeResult(
        await post('/functions/v1/free-rsvp', {
          ...attempt.submission,
          requestId: attempt.requestId,
          collectionBearer: attempt.collectionBearer,
        },freezeStorefrontAttribution(attempt.submission.eventId,attempt.requestId)),
      )
    },
    async resolve(
      attempt: Pick<AttemptInput, 'requestId' | 'collectionBearer'>,
    ): Promise<FreeAttemptResult> {
      return parseFreeResult(
        await post('/functions/v1/free-rsvp-status', {
          requestId: attempt.requestId,
          collectionBearer: attempt.collectionBearer,
        }),
      )
    },
  }
}
export const rsvpApi = createRsvpApi()
