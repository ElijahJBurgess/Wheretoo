import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearCheckoutAttempt,
  getOrCreateCheckoutAttempt,
} from './checkout.attempt'

const eventId = 'eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f'
const gaTierId = '900a9142-9111-4f87-84d5-b8545a94c7fb'
const vipTierId = '6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe'
const storageKey = `whereto.checkout-attempt.v1:${eventId}`
const firstUuid = '10823f25-2860-4b63-968c-749e8047561d'
const secondUuid = '18a23f25-2860-4b63-968c-749e8047561d'

const submission = {
  eventId,
  buyerName: ' Avery Stone ',
  buyerEmail: ' AVERY@EXAMPLE.COM ',
  items: [
    { tierId: gaTierId, quantity: 2 },
    { tierId: vipTierId, quantity: 1 },
  ],
}

describe('checkout attempt identity', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('reuses both values after refresh and for reordered canonical items without persisting buyer identity', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(firstUuid)
    const first = await getOrCreateCheckoutAttempt(submission)
    const refreshed = await getOrCreateCheckoutAttempt({
      ...submission,
      items: [...submission.items].reverse(),
    })

    expect(refreshed).toEqual(first)
    expect(JSON.parse(sessionStorage.getItem(storageKey) ?? '{}')).toEqual(first)
    expect(Object.keys(first).sort()).toEqual([
      'clientRequestId',
      'confirmationBearer',
      'contractVersion',
      'submissionFingerprint',
    ])
    expect(sessionStorage.getItem(storageKey)).not.toMatch(/Avery|example\.com|buyerName|buyerEmail|tierId|quantity/)
  })

  it.each([
    { buyerName: 'Avery Stone Jr.' },
    { buyerEmail: 'other@example.com' },
    { items: [{ tierId: gaTierId, quantity: 3 }] },
  ])('rotates both values after a material buyer or cart edit', async (edit) => {
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce(firstUuid)
      .mockReturnValueOnce(secondUuid)
    const first = await getOrCreateCheckoutAttempt(submission)
    const second = await getOrCreateCheckoutAttempt({ ...submission, ...edit })

    expect(second.clientRequestId).toBe(secondUuid)
    expect(second.clientRequestId).not.toBe(first.clientRequestId)
    expect(second.confirmationBearer).not.toBe(first.confirmationBearer)
  })

  it('generates the bearer from an independent 32-byte random draw in canonical base64url', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(firstUuid)
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((values) => {
      const bytes = values as Uint8Array
      bytes.forEach((_value, index) => { bytes[index] = index })
      return values
    })

    const attempt = await getOrCreateCheckoutAttempt(submission)
    const decoded = Uint8Array.from(
      atob(attempt.confirmationBearer.replace(/-/g, '+').replace(/_/g, '/')),
      (character) => character.charCodeAt(0),
    )

    expect(decoded).toEqual(Uint8Array.from({ length: 32 }, (_value, index) => index))
    expect(attempt.confirmationBearer).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(attempt.confirmationBearer).not.toContain('=')
    expect(attempt.confirmationBearer).not.toContain(firstUuid.replaceAll('-', ''))
  })

  it('rotates a stored bearer whose unused base64url pad bits are non-canonical', async () => {
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce(firstUuid)
      .mockReturnValueOnce(secondUuid)
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((values) => {
      const bytes = values as Uint8Array
      bytes.forEach((_value, index) => { bytes[index] = index })
      return values
    })
    await getOrCreateCheckoutAttempt(submission)
    const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? '{}') as Record<string, unknown>
    sessionStorage.setItem(storageKey, JSON.stringify({
      ...stored,
      confirmationBearer: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh9',
    }))

    const rotated = await getOrCreateCheckoutAttempt(submission)

    expect(rotated.clientRequestId).toBe(secondUuid)
    expect(rotated.confirmationBearer).toBe('AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8')
  })

  it('fails closed and rotates a corrupt stored record', async () => {
    sessionStorage.setItem(storageKey, JSON.stringify({
      contractVersion: 'checkout_integrity_v1',
      submissionFingerprint: 'not-a-fingerprint',
      clientRequestId: firstUuid,
      confirmationBearer: 'not-a-bearer',
      buyerEmail: 'leaked@example.com',
    }))
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(secondUuid)

    const attempt = await getOrCreateCheckoutAttempt(submission)

    expect(attempt.clientRequestId).toBe(secondUuid)
    expect(sessionStorage.getItem(storageKey)).not.toContain('leaked@example.com')
  })

  it('terminal cleanup deletes only the still-matching attempt', async () => {
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce(firstUuid)
      .mockReturnValueOnce(secondUuid)
    const first = await getOrCreateCheckoutAttempt(submission)
    const second = await getOrCreateCheckoutAttempt({ ...submission, buyerName: 'Another Buyer' })

    clearCheckoutAttempt(eventId, first)
    expect(JSON.parse(sessionStorage.getItem(storageKey) ?? '{}')).toEqual(second)

    clearCheckoutAttempt(eventId, second)
    expect(sessionStorage.getItem(storageKey)).toBeNull()
  })

  it.each(['read', 'write'] as const)('fails closed when session storage %s is unavailable', async (operation) => {
    vi.spyOn(Storage.prototype, operation === 'read' ? 'getItem' : 'setItem')
      .mockImplementation(() => { throw new Error('denied') })

    await expect(getOrCreateCheckoutAttempt(submission)).rejects.toThrow('Checkout retry state is unavailable.')
  })

  it('fails closed when a storage write cannot be read back', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined)

    await expect(getOrCreateCheckoutAttempt(submission)).rejects.toThrow('Checkout retry state is unavailable.')
  })
})
