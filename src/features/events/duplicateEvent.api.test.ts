import { beforeEach, expect, it, vi } from 'vitest'
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ supabase: { auth: { getSession } } }))
import { duplicateEvent } from './duplicateEvent.api'
const source = 'dd000000-0000-4000-8000-000000000010'
const target = 'dd000000-0000-4000-8000-000000000020'
beforeEach(() => { vi.restoreAllMocks(); getSession.mockResolvedValue({ data: { session: { access_token: 'fixture' } } }) })
it('sends only source ID and validates the returned new event ID', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ eventId: target }, { status: 201 }))
  expect(await duplicateEvent(source, () => true)).toEqual({ eventId: target })
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ sourceEventId: source })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('does not retry unknown outcomes', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('lost'))
  await expect(duplicateEvent(source, () => true)).rejects.toMatchObject({ code: 'DUPLICATE_OUTCOME_UNKNOWN' })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('malformed or source-ID success must remain uncertain', async () => {
  for (const value of [{ eventId: source }, {}, { eventId: 'not-an-id' }]) {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(value))
    await expect(duplicateEvent(source, () => true)).rejects.toMatchObject({ code: 'DUPLICATE_OUTCOME_UNKNOWN' })
  }
})
it('preserves a definitive source conflict or moderation denial', async () => {
  for (const code of ['DUPLICATE_SOURCE_CHANGED', 'DUPLICATE_MODERATION_BLOCKED']) {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: code }, { status: 409 }))
    await expect(duplicateEvent(source, () => true)).rejects.toMatchObject({ code })
  }
})
it('identity change before dispatch prevents mutation', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch')
  await expect(duplicateEvent(source, () => false)).rejects.toMatchObject({ code: 'SIGN_IN_REQUIRED' })
  expect(fetcher).not.toHaveBeenCalled()
})
