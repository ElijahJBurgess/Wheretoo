import { beforeEach, expect, it, vi } from 'vitest'
const getSession = vi.hoisted(() => vi.fn())
vi.mock(
  '../../lib/supabase/client',
  () => ({ supabase: { auth: { getSession }, storage: { from: vi.fn() } } }),
)
import { requestAiCover } from './aiCover.api'
beforeEach(() => {
  getSession.mockResolvedValue({
    data: { session: { access_token: 'private-token' } },
  })
  vi.stubGlobal('fetch', vi.fn())
})
it('sends only generation input and the displayed cover revision', async () => {
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      id: 'gen',
      eventId: 'event',
      expectedRevision: 4,
      input: {},
      selectedSlot: null,
      expired: false,
      expiresAt: 'later',
      candidates: [],
    }),
  )
  await expect(
    requestAiCover({
      action: 'start',
      eventId: 'event',
      revision: 4,
      requestId: 'request',
      mood: 'Editorial',
      direction: 'blue',
    }, () => true),
  ).rejects.toThrow()
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining('/event-cover-generation'),
    expect.objectContaining({
      body: JSON.stringify({
        action: 'start',
        eventId: 'event',
        revision: 4,
        requestId: 'request',
        mood: 'Editorial',
        direction: 'blue',
      }),
    }),
  )
})
it('does not call generation after identity changes', async () => {
  await expect(
    requestAiCover({ action: 'state', generationId: 'gen' }, () => false),
  ).rejects.toThrow(/session/i)
  expect(fetch).not.toHaveBeenCalled()
})
it('explains rate limit without leaking provider errors', async () => {
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ error: 'COVER_EVENT_LIMIT', secret: 'do not display' }, {
      status: 429,
    }),
  )
  await expect(
    requestAiCover({ action: 'state', generationId: 'gen' }, () => true),
  ).rejects.toThrow(/daily limit/i)
  expect(fetch).toHaveBeenCalledTimes(1)
})
