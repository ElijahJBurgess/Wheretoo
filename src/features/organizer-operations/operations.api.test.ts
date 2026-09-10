import { beforeEach, describe, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase/client', () => ({ supabase: { rpc } }))
import { getEventMetrics } from './operations.api'
const eventId = 'a6200000-0000-4000-8000-000000000001'
const payload = {
  event: {
    id: eventId,
    title: 'Night Market',
    startsAt: null,
    endsAt: null,
    venueName: null,
    city: null,
    status: 'draft',
    artworkPath: null,
  },
  grossSalesMinor: 7000,
  sold: 3,
  orderCount: 1,
  issued: 3,
  checkedIn: 1,
  capacity: 10,
  tiers: [],
  admissionEligible: false,
}
describe('organizer metrics transport', () => {
  beforeEach(() => rpc.mockReset())
  it('returns historical server totals without recalculating from displayed tickets', async () => {
    rpc.mockResolvedValue({ data: payload, error: null })
    expect(await getEventMetrics(eventId)).toEqual(payload)
    expect(rpc).toHaveBeenCalledWith('get_organizer_event_metrics', { p_event_id: eventId })
  })
  it.each([
    { ...payload, sold: -1 },
    { ...payload, grossSalesMinor: Number.MAX_SAFE_INTEGER + 1 },
    { ...payload, checkedIn: 4 },
    { ...payload, event: { ...payload.event, id: 'a6200000-0000-4000-8000-000000000002' } },
    { ...payload, credential_hash: 'private' },
    null,
  ])('rejects inconsistent or excessive fields instead of filling zeros', async (data) => {
    rpc.mockResolvedValue({ data, error: null })
    await expect(getEventMetrics(eventId)).rejects.toThrow('Event metrics unavailable')
  })
  it('sanitizes backend failures without converting them to empty results', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'private database context' } })
    await expect(getEventMetrics(eventId)).rejects.toThrow('Event metrics unavailable')
  })
})
