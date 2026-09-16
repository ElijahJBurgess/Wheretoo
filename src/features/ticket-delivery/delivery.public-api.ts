import { z } from 'zod'
import { publicEnv } from '../../lib/env'
import { ticketCollectionSchema } from '../ticket-experience/adapters/ticketCollectionReader'
import { accessIndexSchema, collectionBearerSchema, emailSchema, grantTokenSchema, publicStatusSchema, timestamp, uuid, type SourceKind } from './delivery.schemas'
export class PublicDeliveryError extends Error {
  constructor(readonly kind: 'unavailable' | 'rate_limited' | 'invalid_input' | 'temporary' = 'unavailable') { super('Ticket access unavailable') }
}
type Transport = { supabaseUrl: string; supabasePublishableKey: string; fetch: typeof globalThis.fetch }
export function createPublicTicketDeliveryApi(transport: Transport = { ...publicEnv, fetch: (...args) => globalThis.fetch(...args) }) {
  async function post(endpoint: string, body: unknown, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const response = await transport.fetch(transport.supabaseUrl + '/functions/v1/' + endpoint, {
      method: 'POST', headers: { apikey: transport.supabasePublishableKey, 'content-type': 'application/json' }, body: JSON.stringify(body), signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
    })
    if (!response.ok) throw new PublicDeliveryError(response.status === 429 ? 'rate_limited' : response.status === 400 ? 'invalid_input' : response.status >= 500 ? 'temporary' : 'unavailable')
    return response.json() as Promise<unknown>
  }
  return {
    async recover(email: string, requestId: string, signal?: AbortSignal) {
      const input = z.strictObject({ email: emailSchema, requestId: uuid }).parse({ email, requestId })
      return z.strictObject({ kind: z.literal('requested') }).parse(await post('ticket-recovery-request', input, signal))
    },
    async index(token: string, page: number, signal?: AbortSignal) {
      const input = z.strictObject({ token: grantTokenSchema, page: z.number().int().min(0).max(9) }).parse({ token, page })
      const result = accessIndexSchema.parse(await post('ticket-email-access', input, signal))
      if (result.page !== page || Date.parse(result.expiresAt) <= Date.now()) throw new PublicDeliveryError()
      return result
    },
    async member(token: string, member: number, sourceKind: SourceKind, signal?: AbortSignal) {
      const input = z.strictObject({ token: grantTokenSchema, member: z.number().int().min(1).max(200) }).parse({ token, member })
      const result = z.strictObject({ kind: z.literal('ready'), collection: ticketCollectionSchema, expiresAt: timestamp }).parse(await post('ticket-email-access', input, signal))
      const collection = result.collection
      const free = sourceKind === 'free_registration'
      if (Date.parse(result.expiresAt) <= Date.now() || (free ? !collection.registrationId || !collection.registrationStatus || collection.tickets.some(t => !t.attendeeLabel || (t.eventFactsAvailable !== false && !t.timezone) || (t.status !== 'used' && t.status !== (collection.registrationStatus === 'cancelled' ? 'cancelled' : 'valid')) || (t.status === 'used') !== (t.usedAt !== undefined)) : collection.registrationId !== undefined || collection.registrationStatus !== undefined || collection.tickets.some(t => t.attendeeLabel !== undefined || (t.eventFactsAvailable === undefined && (t.usedAt !== undefined || t.timezone !== undefined || t.directionsUrl !== undefined))))) throw new PublicDeliveryError()
      return result
    },
    async status(collectionBearer: string, signal?: AbortSignal) {
      collectionBearerSchema.parse(collectionBearer)
      return publicStatusSchema.parse(await post('ticket-email-status', { collectionBearer }, signal))
    },
  }
}
export const publicTicketDeliveryApi = createPublicTicketDeliveryApi()
