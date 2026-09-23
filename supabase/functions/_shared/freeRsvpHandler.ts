import { associateStorefront } from './storefrontAttribution.ts'
import { getCorsHeaders } from './cors.ts'
import { getServiceClient } from './database.ts'
import { getAppBaseUrl } from './env.ts'
import { getTicketCredentialSecret, hashAdmissionCredential } from './ticketCredentials.ts'
import {
  createFreeManifest,
  exactKeys,
  hashFreeLocator,
  hex,
  isRecord,
  normalizeFreeSubmission,
  parseFreeResult,
  UUID_PATTERN,
} from './freeRegistration.ts'
type Operation = 'create' | 'status'
export interface FreeRsvpDependencies {
  associateStorefront?(requestId: string, eventId: string, request: Request): Promise<void>
  appOrigin: string
  getSecret(): Uint8Array
  rateLimit(
    request: Request,
    operation: Operation,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }>
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>
}
async function readBody(request: Request): Promise<unknown> {
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
      'application/json' || !request.body
  ) throw new Error('Invalid body')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 4096) {
        await reader.cancel()
        throw new Error('Body too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}
export function createFreeRsvpHandler(operation: Operation, dependencies: FreeRsvpDependencies) {
  return async (request: Request): Promise<Response> => {
    const headers = getCorsHeaders(request, dependencies.appOrigin)
    headers.set('cache-control', 'private, no-store')
    headers.set('pragma', 'no-cache')
    headers.set('content-type', 'application/json')
    const reply = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers })
    if (!headers.has('access-control-allow-origin')) return reply({ kind: 'unavailable' }, 403)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return reply({ kind: 'unavailable' }, 405)
    let args: Record<string, unknown>
    let requestId: string
    let quantity = 0
    try {
      const body = await readBody(request)
      const keys = operation === 'create'
        ? ['eventId', 'quantity', 'name', 'email', 'requestId', 'collectionBearer']
        : ['requestId', 'collectionBearer']
      if (
        !isRecord(body) || !exactKeys(body, keys) || typeof body.requestId !== 'string' ||
        !UUID_PATTERN.test(body.requestId) || typeof body.collectionBearer !== 'string'
      ) throw new Error('Invalid request')
      requestId = body.requestId
      args = {
        p_request_id: requestId,
        p_access_hash: await hashFreeLocator(body.collectionBearer),
      }
      if (operation === 'create') {
        const submission = normalizeFreeSubmission({
          eventId: body.eventId,
          quantity: body.quantity,
          name: body.name,
          email: body.email,
        })
        quantity = submission.quantity
        Object.assign(args, {
          p_event_id: submission.eventId,
          p_name: submission.name,
          p_email: submission.email,
          p_quantity: quantity,
        })
      }
    } catch {
      return reply({ kind: 'rejected', reason: 'invalid_input' }, 400)
    }
    try {
      const limit = await dependencies.rateLimit(request, operation)
      if (!limit.allowed) {
        headers.set('retry-after', String(Math.max(1, limit.retryAfterSeconds)))
        return reply({ kind: 'unavailable' }, 429)
      }
      if (operation === 'create') {
        args.p_ticket_manifest = await createFreeManifest(
          dependencies.getSecret(),
          requestId,
          quantity,
        )
      }
      const result = parseFreeResult(
        await dependencies.rpc(
          operation === 'create'
            ? 'server_confirm_free_registration'
            : 'server_resolve_free_registration',
          args,
        ),
      )
      if (
        operation === 'create' && result.kind === 'confirmed' &&
        (result.eventId !== args.p_event_id || result.quantity !== quantity)
      ) throw new Error('Incoherent registration response')
      if (operation === 'create' && result.kind === 'not_found') {
        throw new Error('Incoherent creation result')
      }
      if (operation === 'create' && result.kind === 'confirmed') {
        try { await dependencies.associateStorefront?.(requestId, result.eventId, request) } catch { /* Measurement is optional. */ }
      }
      return reply(result)
    } catch {
      // A dependency can fail after commit. Never convert this to a definite rejection.
      return reply({ kind: 'unavailable' }, 503)
    }
  }
}
export function defaultFreeRsvpHandler(operation: Operation) {
  return createFreeRsvpHandler(operation, {
    appOrigin: getAppBaseUrl(),
    associateStorefront: (id, eventId, request) => associateStorefront('free', id, eventId, request),
    getSecret: getTicketCredentialSecret,
    rpc: async (name, args) => {
      const { data, error } = await getServiceClient().rpc(name, args)
      if (error) throw new Error('RSVP unavailable')
      return data
    },
    rateLimit: async (request, operation) => {
      const identity = request.headers.get('cf-connecting-ip') ??
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
      const { data, error } = await getServiceClient().rpc('server_consume_free_rsvp_rate_limit', {
        p_identity_hash: hex(await hashAdmissionCredential(identity)),
        p_operation: operation,
      })
      if (
        error || !isRecord(data) || typeof data.allowed !== 'boolean' ||
        typeof data.retryAfterSeconds !== 'number' ||
        !Number.isSafeInteger(data.retryAfterSeconds) || data.retryAfterSeconds < 0
      ) throw new Error('Rate limit unavailable')
      return { allowed: data.allowed, retryAfterSeconds: data.retryAfterSeconds }
    },
  })
}
