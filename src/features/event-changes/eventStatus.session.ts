import { z } from 'zod'
import { grantTokenSchema } from '../ticket-delivery/delivery.schemas'
const key = 'wheretoo:event-status:v1'
const ceiling = 24 * 60 * 60 * 1000
const schema = z.strictObject({ token: grantTokenSchema, expiresAt: z.number().finite().positive() })
export type EventStatusGrant = z.infer<typeof schema>
let memory: EventStatusGrant | null = null
function save(grant: EventStatusGrant | null) { memory = grant; try { if (grant) sessionStorage.setItem(key, JSON.stringify(grant)); else sessionStorage.removeItem(key) } catch { /* Denied storage retains only this tab's memory. */ } }
export function captureEventStatusAccess() {
 if (typeof window === 'undefined' || window.location.pathname !== '/event-status' || !window.location.hash) return
 const fragment = window.location.hash.slice(1)
 window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
 const value = grantTokenSchema.safeParse(fragment)
 save(value.success ? { token: value.data, expiresAt: Date.now() + ceiling } : null)
}
export function readEventStatusGrant(): EventStatusGrant | null {
 captureEventStatusAccess()
 let value = memory
 try { const raw = sessionStorage.getItem(key); if (raw) { const parsed = schema.safeParse(JSON.parse(raw)); value = parsed.success ? parsed.data : null } } catch { /* Memory is bounded to this tab. */ }
 if (!value || value.expiresAt <= Date.now() || value.expiresAt > Date.now() + ceiling) { save(null); return null }
 return value
}
export function shortenEventStatusGrant(grant: EventStatusGrant, expiresAt: string) {
 const current = readEventStatusGrant()
 if (current?.token !== grant.token) return
 save({ token: grant.token, expiresAt: Math.min(current.expiresAt, grant.expiresAt, Date.parse(expiresAt)) })
}
export function clearEventStatusGrant() { save(null) }
