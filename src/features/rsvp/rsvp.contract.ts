// Shared by the browser and Edge: normalization is part of request identity.
export const MAX_RSVP_QUANTITY = 10
export const FREE_LOCATOR_PREFIX = 'rsvp_'
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const BEARER_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
export type FreeSubmission = { eventId: string; quantity: number; name: string; email: string }
export type FreeAttemptResult =
  | { kind: 'confirmed'; registrationId: string; eventId: string; quantity: number }
  | { kind: 'rejected'; reason: 'full' | 'unavailable' | 'invalid_input'; remaining?: number }
  | { kind: 'conflict' }
  | { kind: 'unavailable' }
  | { kind: 'not_found' }
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value)
}
export function normalizeFreeSubmission(value: unknown): FreeSubmission {
  if (
    !isRecord(value) || !exactKeys(value, ['eventId', 'quantity', 'name', 'email']) ||
    typeof value.eventId !== 'string' || !UUID_PATTERN.test(value.eventId) ||
    typeof value.quantity !== 'number' || !Number.isInteger(value.quantity) ||
    value.quantity < 1 || value.quantity > MAX_RSVP_QUANTITY ||
    typeof value.name !== 'string' || typeof value.email !== 'string'
  ) throw new Error('Check your RSVP details.')
  const name = value.name.trim().replace(/\s+/gu, ' ')
  const email = value.email.trim().toLowerCase()
  if (
    [...name].length < 1 || [...name].length > 200 ||
    [...name].some((character) =>
      character.codePointAt(0)! < 32 || character.codePointAt(0) === 127
    ) ||
    email.length > 320 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i
      .test(email)
  ) throw new Error('Enter your full name and a valid email address.')
  return { eventId: value.eventId, quantity: value.quantity, name, email }
}
export function parseFreeLocator(value: unknown): string {
  if (
    typeof value !== 'string' || !value.startsWith(FREE_LOCATOR_PREFIX) ||
    !BEARER_PATTERN.test(value.slice(FREE_LOCATOR_PREFIX.length))
  ) throw new Error('Private RSVP link unavailable.')
  return value.slice(FREE_LOCATOR_PREFIX.length)
}
export function parseFreeResult(value: unknown): FreeAttemptResult {
  if (!isRecord(value)) throw new Error('RSVP result unavailable.')
  if (
    value.kind === 'confirmed' &&
    exactKeys(value, ['kind', 'registrationId', 'eventId', 'quantity']) &&
    typeof value.registrationId === 'string' && UUID_PATTERN.test(value.registrationId) &&
    typeof value.eventId === 'string' && UUID_PATTERN.test(value.eventId) &&
    typeof value.quantity === 'number' && Number.isInteger(value.quantity) && value.quantity >= 1 &&
    value.quantity <= MAX_RSVP_QUANTITY
  ) {
    return {
      kind: 'confirmed',
      registrationId: value.registrationId,
      eventId: value.eventId,
      quantity: value.quantity,
    }
  }
  if (
    value.kind === 'rejected' &&
    (exactKeys(value, ['kind', 'reason']) || exactKeys(value, ['kind', 'reason', 'remaining'])) &&
    (value.reason === 'full' || value.reason === 'unavailable' ||
      value.reason === 'invalid_input') &&
    (value.remaining === undefined ||
      (typeof value.remaining === 'number' && Number.isSafeInteger(value.remaining) &&
        value.remaining >= 0))
  ) {
    return {
      kind: 'rejected',
      reason: value.reason,
      ...(value.remaining === undefined ? {} : { remaining: value.remaining as number }),
    }
  }
  if (
    exactKeys(value, ['kind']) &&
    (value.kind === 'conflict' || value.kind === 'unavailable' || value.kind === 'not_found')
  ) return { kind: value.kind }
  throw new Error('RSVP result unavailable.')
}
