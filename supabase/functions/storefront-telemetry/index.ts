import { z } from 'zod'
import { getServiceClient } from '../_shared/database.ts'
import { getAppBaseUrl } from '../_shared/env.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { hashAdmissionCredential } from '../_shared/ticketCredentials.ts'
import { storefrontTokenHash } from '../_shared/storefrontAttribution.ts'
const token = z.string().regex(/^[a-f0-9]{64}$/)
const inputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('visit'),
    handle: z.string().regex(/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/),
    ref: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).nullable(),
    token,
  }),
  z.strictObject({
    kind: z.literal('start'),
    eventId: z.uuid(),
    admissionType: z.enum(['paid', 'free']),
    token,
  }),
])
export async function handler(request: Request): Promise<Response> {
  const headers = getCorsHeaders(request, getAppBaseUrl())
  headers.set('cache-control', 'no-store')
  if (!headers.has('access-control-allow-origin')) {
    return new Response(null, { status: 403, headers })
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers })
  }
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers })
  }
  try {
    if (
      !request.body ||
      request.headers.get('content-type')?.split(';')[0] !== 'application/json'
    ) throw new Error('input')
    const reader = request.body.getReader()
    let text = ''
    let size = 0
    const decoder = new TextDecoder('utf-8', { fatal: true })
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > 2048) {
          await reader.cancel()
          throw new Error('size')
        }
        text += decoder.decode(value, { stream: true })
      }
      text += decoder.decode()
    } finally {
      reader.releaseLock()
    }
    const parsed = inputSchema.parse(JSON.parse(text))
    const { token: raw, ...rest } = parsed
    const tokenHash = await storefrontTokenHash(raw)
    const ip = request.headers.get('cf-connecting-ip') ??
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const identityHash = Array.from(
      await hashAdmissionCredential(`storefront-rate:${ip}`),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('')
    const { error } = await getServiceClient().rpc(
      'server_record_storefront_telemetry',
      { p_input: { ...rest, tokenHash }, p_identity_hash: identityHash },
    ).abortSignal(AbortSignal.timeout(1500))
    return new Response(null, { status: error ? 503 : 204, headers })
  } catch {
    return new Response(null, { status: 400, headers })
  }
}
if (import.meta.main) Deno.serve(handler)
