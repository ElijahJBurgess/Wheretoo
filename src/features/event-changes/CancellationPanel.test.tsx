import { describe, expect, it, vi } from 'vitest'
const { getOwnedEvent } = vi.hoisted(() => ({ getOwnedEvent: vi.fn() }))
vi.mock('../events/event.api', () => ({ getOwnedEvent }))
vi.mock('../events/event.queries', () => ({ useCancelOwnedEvent: vi.fn() }))
import { reconcileCancellation } from './cancellationRecovery'
describe('cancellation recovery', () => {
 it('confirms cancellation only for the same owned event', async () => {
  getOwnedEvent.mockResolvedValue({ id: 'e', organizer_id: 'o', status: 'cancelled' })
  expect(await reconcileCancellation('e', 'o')).toBe('cancelled')
  expect(getOwnedEvent).toHaveBeenCalledWith('e', 'o')
 })
 it('allows deliberate retry only after a published server read', async () => {
  getOwnedEvent.mockResolvedValue({ id: 'e', organizer_id: 'o', status: 'published' })
  expect(await reconcileCancellation('e', 'o')).toBe('published')
 })
 it.each([null, { id: 'wrong', organizer_id: 'o', status: 'published' }, { id: 'e', organizer_id: 'other', status: 'cancelled' }, { id: 'e', organizer_id: 'o', status: 'draft' }])('fails closed for unavailable or mismatched reads', async value => {
  getOwnedEvent.mockResolvedValue(value)
  expect(await reconcileCancellation('e', 'o')).toBe('unknown')
 })
 it('leaves outcome unknown on read errors', async () => {
  getOwnedEvent.mockRejectedValue(new Error('offline'))
  expect(await reconcileCancellation('e', 'o')).toBe('unknown')
 })
})
