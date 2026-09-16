import { publicEnv } from '../../lib/env'
import { grantTokenSchema } from '../ticket-delivery/delivery.schemas'
import { refundDetailSchema } from './refunds.schemas'
export class RefundDetailError extends Error {
 constructor(readonly kind: 'unavailable' | 'temporary' | 'rate_limited') { super('Refund details unavailable') }
}
export function createRefundDetailsApi(transport: { supabaseUrl: string; supabasePublishableKey: string; fetch: typeof globalThis.fetch } = { ...publicEnv, fetch: (...args) => globalThis.fetch(...args) }) {
 return async (token: string, signal?: AbortSignal) => {
  if (!grantTokenSchema.safeParse(token).success) throw new RefundDetailError('unavailable')
  try {
   const response = await transport.fetch(transport.supabaseUrl + '/functions/v1/refund-detail-access', {
    method: 'POST', headers: { apikey: transport.supabasePublishableKey, 'content-type': 'application/json' }, body: JSON.stringify({ token }), signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
   })
   if (!response.ok) throw new RefundDetailError(response.status === 429 ? 'rate_limited' : response.status >= 500 ? 'temporary' : 'unavailable')
   const parsed = refundDetailSchema.safeParse(await response.json())
   if (!parsed.success || Date.parse(parsed.data.expiresAt) <= Date.now()) throw new RefundDetailError('unavailable')
   return parsed.data
  } catch (error) { signal?.throwIfAborted(); throw error instanceof RefundDetailError ? error : new RefundDetailError('temporary') }
 }
}
export const getRefundDetails = createRefundDetailsApi()
