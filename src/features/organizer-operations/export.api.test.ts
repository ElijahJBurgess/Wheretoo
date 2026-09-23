import { beforeEach, expect, it, vi } from 'vitest'
import { payload, event } from '../../test/exportFixtures'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ supabase: { rpc } }))
import { getEventExport } from './export.api'
beforeEach(() => rpc.mockReset())
it('requests whole-event data without UI filters and validates event identity', async () => {
  const abortSignal = vi.fn().mockResolvedValue({ data: payload, error: null })
  rpc.mockReturnValue({ abortSignal })
  const signal = new AbortController().signal
  expect(await getEventExport(event.id, 'orders', signal)).toEqual(payload)
  expect(rpc).toHaveBeenCalledWith('get_organizer_event_export', { p_event_id: event.id, p_kind: 'orders' })
  expect(abortSignal).toHaveBeenCalledWith(signal)
  abortSignal.mockResolvedValue({ data: { ...payload, event: { ...event, id: 'a6200000-0000-4000-8000-000000000099' } }, error: null })
  await expect(getEventExport(event.id, 'orders', signal)).rejects.toThrow('complete export')
})
it.each([['PT413', 'download limit'], ['42501', 'organizer access'], ['P0001', 'complete export']])('safely handles %s without echoing source errors', async (code, message) => {
  rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: null, error: { code, message: 'SECRET_SENTINEL' } }) })
  await expect(getEventExport(event.id, 'orders', new AbortController().signal)).rejects.toThrow(message)
})
it('rejects oversized transport JSON and a response completed after abort', async () => {
  rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: { ...payload, padding: 'x'.repeat(8 * 1024 * 1024) }, error: null }) })
  await expect(getEventExport(event.id, 'orders', new AbortController().signal)).rejects.toThrow('download limit')
  const controller = new AbortController(); controller.abort()
  rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: payload, error: null }) })
  await expect(getEventExport(event.id, 'orders', controller.signal)).rejects.toThrow('complete export')
})
