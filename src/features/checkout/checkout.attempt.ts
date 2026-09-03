import { z } from 'zod'
import {
  checkoutCanonicalSubmissionSchema,
  type CheckoutCanonicalSubmission,
} from './checkout.schemas'

const contractVersion = 'checkout_integrity_v1' as const
const base64Url32BytePattern = /^[A-Za-z0-9_-]{43}$/
const uuidV4Pattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/

const checkoutAttemptRecordSchema = z
  .object({
    contractVersion: z.literal(contractVersion),
    submissionFingerprint: z.string().regex(base64Url32BytePattern),
    clientRequestId: z.string().regex(uuidV4Pattern),
    confirmationBearer: z.string().regex(base64Url32BytePattern),
  })
  .strict()

export type CheckoutAttemptRecord = z.output<typeof checkoutAttemptRecordSchema>

function storageKey(eventId: string): string {
  return `whereto.checkout-attempt.v1:${eventId}`
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function submissionFingerprint(submission: CheckoutCanonicalSubmission): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(submission))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return bytesToBase64Url(new Uint8Array(digest))
}

function readAttempt(key: string): CheckoutAttemptRecord | null {
  try {
    const value = sessionStorage.getItem(key)
    if (value === null) return null
    return checkoutAttemptRecordSchema.parse(JSON.parse(value))
  } catch {
    return null
  }
}

function writeAttempt(key: string, attempt: CheckoutAttemptRecord): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(attempt))
  } catch {
    // Storage can be unavailable in private or constrained browser contexts.
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

export function clearCheckoutAttempt(eventId: string, expected: CheckoutAttemptRecord): void {
  const key = storageKey(eventId)
  const stored = readAttempt(key)
  if (stored === null || !attemptsMatch(stored, expected)) return
  try {
    sessionStorage.removeItem(key)
  } catch {
    // Cleanup is best effort when browser storage is unavailable.
  }
}
