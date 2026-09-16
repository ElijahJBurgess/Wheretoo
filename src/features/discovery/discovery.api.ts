import { publicEnv } from '../../lib/env'
import { discoveryRequest } from './discovery.filters'
import { parseDiscoveryPage } from './discovery.schemas'
import type { DiscoveryFilters, DiscoveryPageData } from './discovery.types'

export class DiscoveryReadError extends Error {
  constructor(readonly kind: 'cursor' | 'rate_limited' | 'invalid_response' | 'unavailable', readonly retryAfterSeconds = 0) {
    super('Discovery is temporarily unavailable')
    this.name = 'DiscoveryReadError'
  }
}

export async function getDiscoveryPage(filters: DiscoveryFilters, options: { cursor?: string; signal?: AbortSignal } = {}): Promise<DiscoveryPageData> {
  let response: Response
  try {
    response = await fetch(`${publicEnv.supabaseUrl}/functions/v1/public-discovery`, {
      method: 'POST', credentials: 'omit', signal: options.signal,
      headers: { 'content-type': 'application/json', apikey: publicEnv.supabasePublishableKey },
      body: JSON.stringify(discoveryRequest(filters, options.cursor)),
    })
  } catch (error) {
    if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
    throw new DiscoveryReadError('unavailable')
  }
  if (response.status === 429) {
    const seconds = Number(response.headers.get('retry-after'))
    throw new DiscoveryReadError('rate_limited', Number.isInteger(seconds) && seconds > 0 && seconds <= 3600 ? seconds : 60)
  }
  let payload: unknown
  try { payload = await response.json() } catch (error) {
    if (options.signal?.aborted) throw error
    throw new DiscoveryReadError(response.ok ? 'invalid_response' : 'unavailable')
  }
  if (!response.ok) {
    if (response.status === 400 && typeof payload === 'object' && payload !== null && 'error' in payload) {
      const error = payload.error
      if (typeof error === 'object' && error !== null && 'code' in error &&
        (error.code === 'DISCOVERY_CURSOR_INVALID' || error.code === 'DISCOVERY_CURSOR_EXPIRED')) throw new DiscoveryReadError('cursor')
    }
    throw new DiscoveryReadError('unavailable')
  }
  try { return parseDiscoveryPage(payload) } catch { throw new DiscoveryReadError('invalid_response') }
}
