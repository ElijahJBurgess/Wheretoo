import { z } from 'zod'
import { grantTokenSchema } from '../ticket-delivery/delivery.schemas'
const key = 'wheretoo:refund-detail:v1'
const schema = z.strictObject({ token: grantTokenSchema, expiresAt: z.number().finite().positive() })
export type RefundGrant = z.infer<typeof schema>
let memory: RefundGrant | null = null
function save(grant: RefundGrant | null) { memory = grant; try { if (grant) sessionStorage.setItem(key, JSON.stringify(grant)); else sessionStorage.removeItem(key) } catch { /* The current page can still use an in-memory grant when storage is disabled. */ } }
export function readRefundGrant(): RefundGrant | null {
 const fragment = window.location.hash.slice(1)
 if (fragment) {
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  save(null)
  if (!grantTokenSchema.safeParse(fragment).success) return null
  // Server expiry can only shorten this local ceiling; it remains the access authority.
  const grant = { token: fragment, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 }
  save(grant); return grant
 }
 let value = memory
 try {
  const raw = sessionStorage.getItem(key)
  if (raw) { const parsed = schema.safeParse(JSON.parse(raw)); value = parsed.success ? parsed.data : null }
 } catch { /* Denied storage retains only the current tab’s in-memory grant. */ }
 if (!value || value.expiresAt <= Date.now()) { save(null); return null }
 return value
}
export function shortenRefundGrant(grant: RefundGrant, expiresAt: string) {
 const current = readRefundGrant()
 const next = { token: grant.token, expiresAt: Math.min(grant.expiresAt, current?.token === grant.token ? current.expiresAt : Infinity, Date.parse(expiresAt)) }
 save(next); return next
}
export function clearRefundGrant() { save(null) }
