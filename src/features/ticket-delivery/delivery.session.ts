import { z } from 'zod'
import { grantTokenSchema, uuid, type OwnedDeliverySource } from './delivery.schemas'
const accessKey = 'wheretoo:ticket-email-access:v1'
const operationKey = 'wheretoo:ticket-resends:v1'
const sessionSchema = z.strictObject({ token: grantTokenSchema, expiresAt: z.number().finite() })
type AccessSession = z.infer<typeof sessionSchema>
let memory: AccessSession | null = null
function saveAccess(value: AccessSession | null) {
  memory = value
  try { if (value) sessionStorage.setItem(accessKey, JSON.stringify(value)); else sessionStorage.removeItem(accessKey) } catch { /* The current page can use its fragment without persistent storage. */ }
}
export function captureTicketAccess() {
  if (typeof window === 'undefined' || location.pathname !== '/ticket-access' || !location.hash) return
  const fragment = location.hash.slice(1)
  history.replaceState(history.state, '', location.pathname + location.search)
  const parsed = grantTokenSchema.safeParse(fragment)
  saveAccess(parsed.success ? { token: parsed.data, expiresAt: Date.now() + 24 * 60 * 60 * 1000 } : null)
}
export function readTicketAccess(): AccessSession | null {
  let value = memory
  try {
    const raw = sessionStorage.getItem(accessKey)
    if (raw) { const parsed = sessionSchema.safeParse(JSON.parse(raw)); value = parsed.success ? parsed.data : null }
  } catch { /* Denied storage uses only this tab's memory. */ }
  if (!value || value.expiresAt <= Date.now() || value.expiresAt > Date.now() + 24 * 60 * 60 * 1000) { saveAccess(null); return null }
  return value
}
export function shortenTicketAccess(expiresAt: string) {
  const current = readTicketAccess()
  const expiry = Date.parse(expiresAt)
  if (current && Number.isFinite(expiry)) saveAccess({ ...current, expiresAt: Math.min(current.expiresAt, expiry) })
}
function sourceKey(source: OwnedDeliverySource) { return JSON.stringify([source.ownerId, source.eventId, source.sourceKind, source.sourceId]) }
const operationsSchema = z.array(z.tuple([z.string().max(500), uuid, z.enum(['accepted', 'failed', 'suppressed']).optional()])).max(100)
type StoredOperation = z.infer<typeof operationsSchema>[number]
function operations(): StoredOperation[] {
  const raw = sessionStorage.getItem(operationKey)
  return raw === null ? [] : operationsSchema.parse(JSON.parse(raw))
}
export function readResend(source: OwnedDeliverySource): string | null {
  try { return operations().find(([key]) => key === sourceKey(source))?.[1] ?? null } catch { return null }
}
export function rememberResend(source: OwnedDeliverySource): string {
  const rows = operations()
  const key = sourceKey(source)
  const existing = rows.find(([k]) => k === key)
  if (existing) return existing[1]
  // Completed history has a separate bound; never evict an uncertain send.
  if (rows.filter(row => row[2] === undefined).length >= 50) throw new Error('Resend session full')
  const requestId = crypto.randomUUID()
  sessionStorage.setItem(operationKey, JSON.stringify([...rows, [key, requestId]]))
  return requestId
}
export function clearResend(source: OwnedDeliverySource) {
  sessionStorage.setItem(operationKey, JSON.stringify(operations().filter(([key]) => key !== sourceKey(source))))
}

// Called only after the exact-request RPC verifies a terminal result. Keep the identity
// for close/remount review, but release its unresolved-operation capacity.
export function retireResend(source: OwnedDeliverySource, requestId: string, state: 'accepted' | 'failed' | 'suppressed') {
  const rows = operations()
  const key = sourceKey(source)
  const current = rows.find(row => row[0] === key && row[1] === requestId)
  if (!current) return
  const others = rows.filter(row => row !== current)
  const unresolved = others.filter(row => row[2] === undefined)
  const completed: StoredOperation[] = [...others.filter(row => row[2] !== undefined), [key, requestId, state]]
  sessionStorage.setItem(operationKey, JSON.stringify([...unresolved, ...completed.slice(-50)]))
}
