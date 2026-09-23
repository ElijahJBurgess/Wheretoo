import { publicEnv } from '../../lib/env'
const storageKey = 'wheretoo.storefront-visits.v1'
const lifetime = 30 * 86400000
const tokenPattern = /^[a-f0-9]{64}$/
type Visit = { handle: string; token: string; at: number; events: string[] }
function visits(): Visit[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    return Array.isArray(value)
      ? value.filter((v): v is Visit =>
        v && typeof v.handle === 'string' && tokenPattern.test(v.token) &&
        Number.isFinite(v.at) && Array.isArray(v.events) &&
        v.events.every((id: unknown) => typeof id === 'string') &&
        Date.now() - v.at < lifetime && v.at <= Date.now()
      ).slice(-50)
      : []
  } catch {
    return []
  }
}
export function rememberStorefrontVisit(
  handle: string,
  token: string,
  events: string[],
  at: number,
) {
  try {
    if (!tokenPattern.test(token)) return
    const old = visits()
    const previous = old.find((v) => v.handle === handle)
    localStorage.setItem(
      storageKey,
      JSON.stringify(
        [...old.filter((v) => v.handle !== handle), {
          handle,
          token,
          at,
          events: [...new Set([...(previous?.events ?? []), ...events])].slice(
            -200,
          ),
        }].slice(-50),
      ),
    )
  } catch { /* Measurement never blocks navigation. */ }
}
function currentToken(eventId: string) {
  return visits().filter((v) => v.events.includes(eventId)).sort((a, b) =>
    b.at - a.at
  )[0]?.token ?? null
}
export function freezeStorefrontAttribution(
  eventId: string,
  requestId: string,
): Record<string, string> {
  try {
    const key = `wheretoo.storefront-attempt.v1:${requestId}`
    let raw = sessionStorage.getItem(key)
    if (raw === null) {
      raw = JSON.stringify(currentToken(eventId))
      sessionStorage.setItem(key, raw)
    }
    const token: unknown = JSON.parse(raw)
    return typeof token === 'string' && tokenPattern.test(token)
      ? { 'X-Wheretoo-Storefront': token }
      : {}
  } catch {
    return {}
  }
}
async function send(body: unknown) {
  try {
    await fetch(`${publicEnv.supabaseUrl}/functions/v1/storefront-telemetry`, {
      method: 'POST',
      headers: {
        apikey: publicEnv.supabasePublishableKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(2500),
    })
  } catch { /* Best-effort telemetry. */ }
}
let lastVisitKey: string | null = null
const activeVisits = new Map<string, { token: string; at: number }>()
export function visitStorefront(
  handle: string,
  ref: string | null,
  eventIds: string[],
) {
  const label = ref && /^[a-zA-Z0-9_-]{1,64}$/.test(ref) ? ref : null
  const key = `${handle}:${label ?? ''}`
  let visit = activeVisits.get(key)
  if (lastVisitKey !== key || !visit || Date.now() - visit.at > 30 * 60000) {
    visit = {
      token: Array.from(
        crypto.getRandomValues(new Uint8Array(32)),
        (b) => b.toString(16).padStart(2, '0'),
      ).join(''),
      at: Date.now(),
    }
    activeVisits.set(key, visit)
    void send({ kind: 'visit', handle, ref: label, token: visit.token })
  }
  lastVisitKey = key
  rememberStorefrontVisit(handle, visit.token, eventIds, visit.at)
}
export function startStorefrontTransaction(
  eventId: string,
  kind: 'paid' | 'free',
) {
  const token = currentToken(eventId)
  if (token) void send({ kind: 'start', eventId, admissionType: kind, token })
}
