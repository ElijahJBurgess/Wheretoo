import { beforeEach, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase/client', () => ({ supabase: { rpc } }))

import { getFreeRegistration, getFreeRegistrationMetrics, listFreeAdmissions } from './freeOperations.api'

const eventId = 'a6200000-0000-4000-8000-000000000001'
const registrationId = 'a6300000-0000-4000-8000-000000000001'
const ticketId = 'a6400000-0000-4000-8000-000000000002'
const metrics = {
  eventId,
  registrationCount: 1,
  confirmedRegistrations: 1,
  reservedAdmissions: 3,
  issued: 3,
  checkedIn: 1,
  capacity: 10,
  remaining: 7,
}
const detail = {
  registrationId,
  eventId,
  eventName: 'Community supper',
  registrantName: 'Alex Chen',
  registrantEmail: 'alex@example.invalid',
  status: 'confirmed',
  quantity: 3,
  createdAt: '2026-09-14T12:00:00Z',
  tickets: [1, 2, 3].map(position => ({
    ticketId: `a6400000-0000-4000-8000-00000000000${position}`,
    position,
    admissionLabel: 'General Admission',
    status: position === 2 ? 'used' : 'valid',
    usedAt: position === 2 ? '2026-09-14T13:00:00Z' : null,
  })),
}

beforeEach(() => rpc.mockReset())

it('accepts the exact finite and unlimited free metric projections and verifies event membership', async () => {
  rpc.mockResolvedValueOnce({ data: metrics, error: null }).mockResolvedValueOnce({
    data: { ...metrics, capacity: null, remaining: null }, error: null,
  })
  expect(await getFreeRegistrationMetrics(eventId)).toEqual(metrics)
  expect((await getFreeRegistrationMetrics(eventId)).capacity).toBeNull()

  rpc.mockResolvedValue({ data: { ...metrics, eventId: 'a6200000-0000-4000-8000-000000000002' }, error: null })
  await expect(getFreeRegistrationMetrics(eventId)).rejects.toThrow('Registration metrics unavailable')
})

it.each([
  { ...metrics, remaining: null },
  { ...metrics, remaining: 8 },
  { ...metrics, checkedIn: 4 },
  { ...metrics, grossSalesMinor: 0 },
])('rejects contradictory or paid-shaped free metrics', async invalid => {
  rpc.mockResolvedValue({ data: invalid, error: null })
  await expect(getFreeRegistrationMetrics(eventId)).rejects.toThrow('Registration metrics unavailable')
})

it('keeps exact search text, page size 25, and the independent free cursor', async () => {
  const cursor = { createdAt: '2026-09-14T12:00:00Z', ticketId }
  rpc.mockResolvedValue({ data: { admissions: [], nextCursor: null }, error: null })
  await listFreeAdmissions(eventId, 'alex@example.invalid', cursor)
  expect(rpc).toHaveBeenCalledWith('get_organizer_free_admissions', {
    p_event_id: eventId,
    p_search: 'alex@example.invalid',
    p_limit: 25,
    p_cursor: cursor,
  })
})

it('strictly rejects a free admission row carrying a paid order identity', async () => {
  rpc.mockResolvedValue({ data: { admissions: [{
    sourceKind: 'free_registration', registrationId, registrantName: 'Alex Chen', registrantEmail: 'alex@example.invalid', registrationStatus: 'confirmed', createdAt: '2026-09-14T12:00:00Z', ticketId, ticketPosition: 2, ticketTotal: 3, admissionLabel: 'General Admission', status: 'valid', usedAt: null, admissionEligible: true, orderId: 'a6500000-0000-4000-8000-000000000001',
  }], nextCursor: null }, error: null })
  await expect(listFreeAdmissions(eventId, 'Alex Chen', null)).rejects.toThrow('Guest search unavailable')
})

it('keeps registration detail strict and never invents admission eligibility', async () => {
  rpc.mockResolvedValueOnce({ data: detail, error: null }).mockResolvedValueOnce({
    data: { ...detail, admissionEligible: true }, error: null,
  })
  expect(await getFreeRegistration(eventId, registrationId)).toEqual(detail)
  await expect(getFreeRegistration(eventId, registrationId)).rejects.toThrow('Registration unavailable')
})
