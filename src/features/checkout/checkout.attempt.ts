import { z } from 'zod'
import {
  checkoutCanonicalSubmissionSchema,
  type CheckoutCanonicalSubmission,
} from './checkout.schemas'
import { checkoutItemsSchema } from './checkout.schemas'
import { lowercaseRfcUuidSchema } from '../tickets/ticket.schemas'
import { checkoutSelectionPath } from './checkout.cart'

const contractVersion = 'checkout_integrity_v1' as const
const base64Url32BytePattern = /^[A-Za-z0-9_-]{43}$/
const uuidV4Pattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const storageKeyPrefix = 'whereto.checkout-attempt.v1:'

const checkoutAttemptRecordSchema = z
  .object({
    contractVersion: z.literal(contractVersion),
    submissionFingerprint: z.string().refine(isCanonicalCheckoutBearer),
    clientRequestId: z.string().regex(uuidV4Pattern),
    confirmationBearer: z.string().refine(isCanonicalCheckoutBearer),
    lifecycle: z.enum(['prepared', 'submitted', 'rejected']).optional(),
    rejectionKind: z.enum(['stock', 'unavailable']).optional(),
    verifiedEventId: lowercaseRfcUuidSchema.optional(),
    selection: checkoutItemsSchema.optional(),
  })
  .strict()

export type CheckoutAttemptRecord = z.output<typeof checkoutAttemptRecordSchema>

function storageKey(eventId: string): string {
  return `${storageKeyPrefix}${eventId}`
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function isCanonicalCheckoutBearer(value: unknown): value is string {
  if (typeof value !== 'string' || !base64Url32BytePattern.test(value)) return false
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
    const decoded = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
    return decoded.length === 32 && bytesToBase64Url(decoded) === value
  } catch {
    return false
  }
}

async function submissionFingerprint(submission: CheckoutCanonicalSubmission): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(submission))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return bytesToBase64Url(new Uint8Array(digest))
}

function readAttempt(key: string): CheckoutAttemptRecord | null {
  let value: string | null
  try {
    value = sessionStorage.getItem(key)
  } catch {
    throw new Error('Checkout retry state is unavailable.')
  }
  if (value === null) {
    if (sessionStorage.getItem(`${key}:seen`) !== null) throw new Error('Checkout retry state is unavailable.')
    return null
  }
  try {
    return checkoutAttemptRecordSchema.parse(JSON.parse(value))
  } catch {
    throw new Error('Checkout retry state is unavailable.')
  }
}

function writeAttempt(key: string, attempt: CheckoutAttemptRecord): void {
  try {
    sessionStorage.setItem(`${key}:seen`, '1')
    sessionStorage.setItem(key, JSON.stringify(attempt))
  } catch {
    throw new Error('Checkout retry state is unavailable.')
  }
  const persisted = readAttempt(key)
  if (persisted === null || JSON.stringify(persisted) !== JSON.stringify(checkoutAttemptRecordSchema.parse(attempt))) {
    throw new Error('Checkout retry state is unavailable.')
  }
}

function attemptsMatch(left: CheckoutAttemptRecord, right: CheckoutAttemptRecord): boolean {
  return left.contractVersion === right.contractVersion &&
    left.submissionFingerprint === right.submissionFingerprint &&
    left.clientRequestId === right.clientRequestId &&
    left.confirmationBearer === right.confirmationBearer
}

export async function getOrCreateCheckoutAttempt(
  canonicalSubmission: CheckoutCanonicalSubmission,
  expectedBearer?: string,
  requireExisting = false,
): Promise<CheckoutAttemptRecord> {
  const submission = checkoutCanonicalSubmissionSchema.parse(canonicalSubmission)
  const fingerprint = await submissionFingerprint(submission)
  const key = storageKey(submission.eventId)
  const stored = readAttempt(key)
  if ((requireExisting && !stored) || (expectedBearer !== undefined && stored?.confirmationBearer !== expectedBearer)) throw new Error('Checkout retry state is unavailable. Keep your original checkout link.')
  if (stored?.submissionFingerprint === fingerprint) return stored

  if (stored !== null) throw new Error('Resolve your existing checkout before changing buyer details or tickets.')

  const confirmationBytes = crypto.getRandomValues(new Uint8Array(32))
  const attempt: CheckoutAttemptRecord = {
    contractVersion,
    lifecycle: 'prepared',
    submissionFingerprint: fingerprint,
    clientRequestId: crypto.randomUUID().toLowerCase(),
    confirmationBearer: bytesToBase64Url(confirmationBytes),
  }
  const validatedAttempt = checkoutAttemptRecordSchema.parse(attempt)
  writeAttempt(key, validatedAttempt)
  return validatedAttempt
}

export function clearCheckoutAttemptForConfirmation(confirmationBearer: string): void {
  if (!isCanonicalCheckoutBearer(confirmationBearer)) return
  try {
    const keys = Array.from({ length: sessionStorage.length }, (_value, index) => sessionStorage.key(index))
    for (const key of keys) {
      if (key === null || !key.startsWith(storageKeyPrefix) || key.endsWith(':seen')) continue
      const stored = readAttempt(key)
      if (stored?.confirmationBearer === confirmationBearer) {
        sessionStorage.removeItem(key)
        sessionStorage.removeItem(`${key}:seen`)
      }
    }
  } catch {
    // Cleanup is best effort when browser storage is unavailable.
  }
}

export function getStoredCheckoutAttempt(eventId: string): CheckoutAttemptRecord | null {
  return readAttempt(storageKey(lowercaseRfcUuidSchema.parse(eventId)))
}

export function markCheckoutSubmitted(eventId: string, attempt: CheckoutAttemptRecord, submission: CheckoutCanonicalSubmission, verifiedEventId: string): CheckoutAttemptRecord {
  const key = storageKey(eventId)
  const stored = readAttempt(key)
  if (!stored || !attemptsMatch(stored, attempt) || stored.lifecycle === 'rejected') throw new Error('Checkout retry state is unavailable.')
  if (verifiedEventId !== submission.eventId) throw new Error('Checkout event could not be verified.')
  const updated = checkoutAttemptRecordSchema.parse({ ...stored, lifecycle: 'submitted', verifiedEventId, selection: submission.items })
  writeAttempt(key, updated)
  return updated
}

export function markCheckoutRejected(eventId: string, attempt: CheckoutAttemptRecord, rejectionKind: 'stock' | 'unavailable' = 'stock'): void {
  const key = storageKey(eventId)
  const stored = readAttempt(key)
  if (!stored || !attemptsMatch(stored, attempt)) throw new Error('Checkout retry state is unavailable.')
  writeAttempt(key, { ...stored, lifecycle: 'rejected', rejectionKind })
}

export function findCheckoutAttempt(confirmationBearer: string): { eventId: string; attempt: CheckoutAttemptRecord } | null {
  if (!isCanonicalCheckoutBearer(confirmationBearer)) return null
  try {
    for (let index = 0; index < sessionStorage.length; index++) {
      const key = sessionStorage.key(index)
      if (key === null || !key.startsWith(storageKeyPrefix) || key.endsWith(':seen')) continue
      const eventId = key.slice(storageKeyPrefix.length)
      if (!lowercaseRfcUuidSchema.safeParse(eventId).success) continue
      const attempt = readAttempt(key)
      if (attempt?.confirmationBearer === confirmationBearer) return { eventId, attempt }
    }
  } catch { return null }
  return null
}

export function getVerifiedCheckoutAssociation(confirmationBearer: string): { eventId: string; selectionPath: string } | null {
  const found = findCheckoutAttempt(confirmationBearer)
  if (!found || found.attempt.verifiedEventId !== found.eventId || !found.attempt.selection) return null
  return { eventId: found.eventId, selectionPath: checkoutSelectionPath(found.eventId, found.attempt.selection) }
}
