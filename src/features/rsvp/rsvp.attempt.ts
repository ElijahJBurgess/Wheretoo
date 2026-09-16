import {
  BEARER_PATTERN,
  exactKeys,
  type FreeAttemptResult,
  type FreeSubmission,
  isRecord,
  normalizeFreeSubmission,
  parseFreeLocator,
  parseFreeResult,
  UUID_PATTERN,
} from './rsvp.contract'
export interface RsvpStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}
export type RsvpAttempt = {
  version: 1
  requestId: string
  collectionBearer: string
  submission: FreeSubmission
  fingerprint: string
  state: 'unresolved' | 'confirmed' | 'rejected'
  result?: FreeAttemptResult
}
const key = (eventId: string) => 'wheretoo.rsvp.v1:' + eventId
function encode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll(
    '=',
    '',
  )
}
export function readAttempt(
  eventId: string,
  storage: RsvpStorage = localStorage,
): RsvpAttempt | null {
  let raw: string | null
  try {
    raw = storage.getItem(key(eventId))
  } catch {
    throw new Error('Private RSVP recovery is unavailable in this browser.')
  }
  if (raw === null) return null
  try {
    const v: unknown = JSON.parse(raw)
    if (
      !isRecord(v) || !exactKeys(
        v,
        v.result === undefined
          ? ['version', 'requestId', 'collectionBearer', 'submission', 'fingerprint', 'state']
          : [
            'version',
            'requestId',
            'collectionBearer',
            'submission',
            'fingerprint',
            'state',
            'result',
          ],
      ) ||
      v.version !== 1 || typeof v.requestId !== 'string' || !UUID_PATTERN.test(v.requestId) ||
      typeof v.collectionBearer !== 'string' ||
      typeof v.fingerprint !== 'string' || !BEARER_PATTERN.test(v.fingerprint) ||
      !['unresolved', 'confirmed', 'rejected'].includes(v.state as string)
    ) throw new Error()
    parseFreeLocator(v.collectionBearer)
    const submission = normalizeFreeSubmission(v.submission)
    if (
      submission.eventId !== eventId || JSON.stringify(submission) !== JSON.stringify(v.submission)
    ) throw new Error()
    const result = v.result === undefined ? undefined : parseFreeResult(v.result)
    if (
      v.state === 'confirmed' &&
      (result?.kind !== 'confirmed' || result.eventId !== eventId ||
        result.quantity !== submission.quantity)
    ) throw new Error()
    if (v.state === 'rejected' && result?.kind !== 'rejected') throw new Error()
    if (v.state === 'unresolved' && (result?.kind === 'confirmed' || result?.kind === 'rejected')) {
      throw new Error()
    }
    return {
      version: 1,
      requestId: v.requestId,
      collectionBearer: v.collectionBearer,
      submission,
      fingerprint: v.fingerprint,
      state: v.state as RsvpAttempt['state'],
      ...(result ? { result } : {}),
    }
  } catch {
    throw new Error(
      'Your saved RSVP needs recovery. Keep your private link; do not submit another request.',
    )
  }
}
function persist(attempt: RsvpAttempt, storage: RsvpStorage) {
  try {
    storage.setItem(key(attempt.submission.eventId), JSON.stringify(attempt))
    if (
      JSON.stringify(readAttempt(attempt.submission.eventId, storage)) !== JSON.stringify(attempt)
    ) throw new Error()
  } catch {
    throw new Error('Your RSVP retry information could not be saved. No new request can be sent.')
  }
}
export async function validateAttempt(attempt: RsvpAttempt): Promise<RsvpAttempt> {
  const digest = encode(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(attempt.submission)),
      ),
    ),
  )
  if (digest !== attempt.fingerprint) {
    throw new Error(
      'Your saved RSVP needs recovery. Its saved details no longer match the original request.',
    )
  }
  return attempt
}
export async function prepareAttempt(
  input: FreeSubmission,
  storage: RsvpStorage = localStorage,
  newIntent = false,
): Promise<RsvpAttempt> {
  const submission = normalizeFreeSubmission(input)
  const fingerprint = encode(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(submission))),
    ),
  )
  const current = readAttempt(submission.eventId, storage)
  if (current) await validateAttempt(current)
  if (current && current.state !== 'rejected') {
    if (current.state === 'unresolved' && (current.fingerprint !== fingerprint || newIntent)) {
      throw new Error('Resolve your previous RSVP before changing its details.')
    }
    if (!newIntent) {
      if (current.fingerprint !== fingerprint) {
        throw new Error('Open your confirmed tickets or explicitly start another RSVP.')
      }
      return current
    }
  }
  const attempt: RsvpAttempt = {
    version: 1,
    requestId: crypto.randomUUID(),
    collectionBearer: 'rsvp_' + encode(crypto.getRandomValues(new Uint8Array(32))),
    submission,
    fingerprint,
    state: 'unresolved',
  }
  persist(attempt, storage)
  return attempt
}
export function recordResult(
  attempt: RsvpAttempt,
  result: FreeAttemptResult,
  storage: RsvpStorage = localStorage,
): RsvpAttempt {
  const current = readAttempt(attempt.submission.eventId, storage)
  if (
    current?.requestId !== attempt.requestId ||
    current.collectionBearer !== attempt.collectionBearer
  ) throw new Error('The saved RSVP changed. Reload to resolve its status.')
  const safe = parseFreeResult(result)
  if (
    safe.kind === 'confirmed' &&
    (safe.eventId !== attempt.submission.eventId || safe.quantity !== attempt.submission.quantity)
  ) throw new Error('RSVP result does not match this request.')
  // A late unavailable response must not downgrade a terminal result.
  if (current.state !== 'unresolved') return current
  const next: RsvpAttempt = {
    ...current,
    result: safe,
    state: safe.kind === 'confirmed'
      ? 'confirmed'
      : safe.kind === 'rejected'
      ? 'rejected'
      : 'unresolved',
  }
  persist(next, storage)
  return next
}
export async function withRsvpLock<T>(
  eventId: string,
  operation: () => Promise<T>,
  locks: LockManager | undefined = navigator.locks,
): Promise<T> {
  if (!locks) {
    throw new Error(
      'Safe RSVP coordination is unavailable in this browser. Please use a browser with private storage and Web Locks enabled.',
    )
  }
  return await locks.request('wheretoo.rsvp:' + eventId, { mode: 'exclusive' }, operation)
}
