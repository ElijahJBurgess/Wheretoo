import { beforeEach, describe, expect, it } from 'vitest'
import {
  prepareAttempt,
  readAttempt,
  recordResult,
  type RsvpStorage,
  withRsvpLock,
} from './rsvp.attempt'
const eventId = 'd6100000-0000-4000-8000-000000000001'
const input = { eventId, name: 'Alex Chen', email: 'alex@example.invalid', quantity: 3 }
let storage: RsvpStorage
beforeEach(() => {
  const values = new Map<string, string>()
  storage = {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => {
      values.set(k, v)
    },
  }
})
describe('durable RSVP attempts', () => {
  it('persists canonical payload, proof and identity before sending and restores after restart', async () => {
    const first = await prepareAttempt(input, storage)
    expect(readAttempt(eventId, storage)).toEqual(first)
    expect(await prepareAttempt(input, storage)).toEqual(first)
  })
  it('refuses changed payload under unresolved identity', async () => {
    await prepareAttempt(input, storage)
    await expect(prepareAttempt({ ...input, quantity: 2 }, storage)).rejects.toThrow('Resolve')
  })
  it('corrupt storage is not a new request', async () => {
    storage.setItem('wheretoo.rsvp.v1:' + eventId, 'broken')
    await expect(prepareAttempt(input, storage)).rejects.toThrow('recovery')
  })
  it('failed durable write prevents creation', async () => {
    await expect(prepareAttempt(input, { getItem: () => null, setItem: () => {} })).rejects.toThrow(
      'saved',
    )
  })
  it('not-found and unavailable keep exact attempt identity', async () => {
    const first = await prepareAttempt(input, storage)
    for (const kind of ['not_found', 'unavailable'] as const) {
      recordResult(first, { kind }, storage)
      expect((await prepareAttempt(input, storage)).requestId).toBe(first.requestId)
    }
  })
  it('only definite rejection allows changed request; confirmation requires explicit new intent', async () => {
    const first = await prepareAttempt(input, storage)
    recordResult(first, { kind: 'rejected', reason: 'full', remaining: 1 }, storage)
    const second = await prepareAttempt({ ...input, quantity: 1 }, storage)
    expect(second.requestId).not.toBe(first.requestId)
    recordResult(
      second,
      { kind: 'confirmed', registrationId: eventId, eventId, quantity: 1 },
      storage,
    )
    expect((await prepareAttempt({ ...input, quantity: 1 }, storage)).requestId).toBe(
      second.requestId,
    )
    expect((await prepareAttempt(input, storage, true)).requestId).not.toBe(second.requestId)
  })
  it('a late result cannot overwrite a newer attempt', async () => {
    const first = await prepareAttempt(input, storage)
    recordResult(first, { kind: 'rejected', reason: 'full' }, storage)
    const next = await prepareAttempt(input, storage)
    expect(() => recordResult(first, { kind: 'unavailable' }, storage)).toThrow('changed')
    expect(readAttempt(eventId, storage)?.requestId).toBe(next.requestId)
  })
  it('fails closed without browser lock coordination', async () => {
    await expect(withRsvpLock(eventId, async () => true, undefined)).rejects.toThrow('coordination')
  })
})

it('changed saved payload cannot be replayed under its old fingerprint', async () => {
  const first = await prepareAttempt(input, storage)
  storage.setItem(
    'wheretoo.rsvp.v1:' + eventId,
    JSON.stringify({
      ...first,
      submission: { ...first.submission, email: 'different@example.invalid' },
    }),
  )
  const { validateAttempt } = await import('./rsvp.attempt')
  await expect(validateAttempt(readAttempt(eventId, storage)!)).rejects.toThrow('recovery')
  await expect(prepareAttempt({ ...input, email: 'different@example.invalid' }, storage)).rejects
    .toThrow('recovery')
})
