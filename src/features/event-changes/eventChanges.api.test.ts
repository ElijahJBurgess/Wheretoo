import { describe, expect, it, vi } from 'vitest'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ supabase: { rpc } }))
import { parseEventContext, saveEventIfCurrent, EventChangeError } from './eventChanges.api'
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

import { testContext } from './eventChanges.fixtures'
it('loads draft context while publication policies are unconfigured, without inventing policy consent', () => {
 const raw = { ...testContext(), requirements: {
  policies_unavailable: true, needs_acceptance: true,
  minimum_age: null, alcohol_present: null, cannabis_present: null, explicit_adult_content: null,
  gambling_present: null, weapons_present: null, high_risk_activity: null,
 } }
 const result = parseEventContext(raw, 'event-1', 'organizer-1')
 expect(result.requirements).toMatchObject({ needsAcceptance: true, organizerTerms: null, eventPolicy: null, minimumAge: 'all_ages' })
 expect(() => parseEventContext(raw, 'event-1', 'foreign-owner')).toThrow()
 expect(() => parseEventContext({ ...raw, requirements: { ...raw.requirements, needs_acceptance: false } }, 'event-1', 'organizer-1')).toThrow()
})
