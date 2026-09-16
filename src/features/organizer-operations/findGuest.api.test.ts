import { beforeEach, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase/client', () => ({ supabase: { rpc } }))
import { listEventAdmissions } from './operations.api'
const eventId = 'a6200000-0000-4000-8000-000000000001'
beforeEach(() => rpc.mockReset())
it('uses one bounded event-scoped read and returns successful empty results', async () => {
  rpc.mockResolvedValue({ data: { admissions: [], nextCursor: null }, error: null })
  expect(await listEventAdmissions(eventId, 'alex', null)).toEqual({
    admissions: [],
    nextCursor: null,
  })
  expect(rpc).toHaveBeenCalledWith('list_organizer_event_admissions', {
    p_event_id: eventId,
    p_search: 'alex',
    p_limit: 25,
  })
})
it('fails closed on private response fields and preserves access denial classification', async () => {
  rpc.mockResolvedValueOnce({
    data: { admissions: [], nextCursor: null, credential: 'secret' },
    error: null,
  })
  await expect(listEventAdmissions(eventId, 'alex', null)).rejects.toThrow(
    'Guest search unavailable',
  )
  rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } })
  await expect(listEventAdmissions(eventId, 'alex', null)).rejects.toMatchObject({
    accessDenied: true,
  })
})
