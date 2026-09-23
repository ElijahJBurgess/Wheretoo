import { getServiceClient } from './database.ts'
export async function storefrontTokenHash(
  token: string | null,
): Promise<string | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
}
/** Isolated from canonical request bodies and digests. No measurement error escapes. */
export async function associateStorefront(
  kind: 'paid' | 'free',
  requestId: string,
  eventId: string,
  request: Request,
) {
  try {
    const hash = await storefrontTokenHash(
      request.headers.get('X-Wheretoo-Storefront'),
    )
    await getServiceClient().rpc('server_associate_storefront_transaction', {
      p_kind: kind,
      p_request_id: requestId,
      p_event_id: eventId,
      p_token_hash: hash,
    }).abortSignal(AbortSignal.timeout(1500))
  } catch {
    /* The purchase/RSVP remains authoritative when measurement is unavailable. */
  }
}
