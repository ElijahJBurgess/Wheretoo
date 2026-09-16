import {
  MAX_RSVP_QUANTITY,
  parseFreeLocator,
  UUID_PATTERN,
} from '../../../src/features/rsvp/rsvp.contract.ts'
import { hashAdmissionCredential } from './ticketCredentials.ts'
export {
  exactKeys,
  isRecord,
  normalizeFreeSubmission,
  parseFreeLocator,
  parseFreeResult,
  UUID_PATTERN,
} from '../../../src/features/rsvp/rsvp.contract.ts'
export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
export async function hashFreeLocator(locator: string): Promise<string> {
  return hex(await hashAdmissionCredential(parseFreeLocator(locator)))
}
export async function deriveFreeAdmissionCredential(
  secret: Uint8Array,
  requestId: string,
  unit: number,
): Promise<string> {
  if (
    secret.length !== 32 || !UUID_PATTERN.test(requestId) || !Number.isInteger(unit) || unit < 1 ||
    unit > MAX_RSVP_QUANTITY
  ) throw new Error('Invalid free admission source')
  const bytes = new Uint8Array(secret).buffer
  const key = await crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`wheretoo:free-admission:v1\n${requestId}\n${unit}`),
    ),
  )
  return 'wta1_' +
    btoa(String.fromCharCode(...signature)).replaceAll('+', '-').replaceAll('/', '_').replaceAll(
      '=',
      '',
    )
}
export async function createFreeManifest(secret: Uint8Array, requestId: string, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_RSVP_QUANTITY) {
    throw new Error('Invalid free quantity')
  }
  return await Promise.all(
    Array.from(
      { length: quantity },
      async (_, i) => ({
        unit_sequence: i + 1,
        credential_hash: hex(
          await hashAdmissionCredential(
            await deriveFreeAdmissionCredential(secret, requestId, i + 1),
          ),
        ),
      }),
    ),
  )
}
