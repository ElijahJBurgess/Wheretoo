import { describe, expect, it, vi } from 'vitest'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ supabase: { rpc } }))
import { saveEventIfCurrent, EventChangeError } from './eventChanges.api'
import { eventRowToFormValues } from '../events/event.api'
import type { EventRow } from '../events/event.types'
describe('conditional event writers', () => {
 it('sends the pinned context and never retries a stale write', async () => {
  rpc.mockResolvedValue({ data: null, error: { message: 'EVENT_CONTEXT_CONFLICT' } })
  const values = eventRowToFormValues({ title: 'Test', description: null, category: null, starts_at: null, ends_at: null, venue_name: null, mapbox_feature_id: null, admission_type: 'free', capacity: null } as EventRow)
  await expect(saveEventIfCurrent('event', 'owner', 'reviewed-token', values)).rejects.toEqual(new EventChangeError('conflict'))
  expect(rpc).toHaveBeenCalledTimes(1)
  expect(rpc).toHaveBeenCalledWith('save_owned_event_revision_if_current', expect.objectContaining({ p_event_id: 'event', p_expected_context: 'reviewed-token' }))
 })
})
