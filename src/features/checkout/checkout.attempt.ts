import { z } from 'zod'
import {
  checkoutCanonicalSubmissionSchema,
  type CheckoutCanonicalSubmission,
} from './checkout.schemas'

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
  if (value === null) return null
  try {
    return checkoutAttemptRecordSchema.parse(JSON.parse(value))
  } catch {
    return null
  }
}

function writeAttempt(key: string, attempt: CheckoutAttemptRecord): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(attempt))
  } catch {
    throw new Error('Checkout retry state is unavailable.')
  }
  const persisted = readAttempt(key)
  if (persisted === null || !attemptsMatch(persisted, attempt)) {
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
): Promise<CheckoutAttemptRecord> {
  const submission = checkoutCanonicalSubmissionSchema.parse(canonicalSubmission)
  const fingerprint = await submissionFingerprint(submission)
  const key = storageKey(submission.eventId)
  const stored = readAttempt(key)
  if (stored?.submissionFingerprint === fingerprint) return stored

  const confirmationBytes = crypto.getRandomValues(new Uint8Array(32))
  const attempt: CheckoutAttemptRecord = {
    contractVersion,
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
      if (key === null || !key.startsWith(storageKeyPrefix)) continue
      const stored = readAttempt(key)
      if (stored?.confirmationBearer === confirmationBearer) sessionStorage.removeItem(key)
    }
  } catch {
    // Cleanup is best effort when browser storage is unavailable.
  }
}
