import { beforeEach, expect, it, vi } from 'vitest'
const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ supabase: { rpc, from } }))
import { draftPayload, eventRowToFormValues, saveEventDraft, saveEventRevision } from './event.api'
import { saveEventIfCurrent, parseEventContext } from '../event-changes/eventChanges.api'
import { testContext, testEvent } from '../event-changes/eventChanges.fixtures'
const version = '8d94a4cf-e61b-480a-9f1f-8b5497620dfa'
const request = '11111111-1111-4111-8111-111111111111'
beforeEach(() => vi.resetAllMocks())
it('does not reassign icons through the existing admission-only revision caller', async () => {
 rpc.mockResolvedValue({ data: { ...testEvent, map_icon_version_id: version }, error: null })
 await saveEventRevision({ eventId: testEvent.id, organizerId: testEvent.organizer_id, values: { ...eventRowToFormValues(testEvent), mapIconVersionId: version } })
 expect(rpc.mock.calls[0][1].p_event).not.toHaveProperty('map_icon_version_id')
})
it('atomically creates the draft and icon via the owner RPC, with caller retry identity', async () => {
 const saved = { ...testEvent, map_icon_version_id: version }
 rpc.mockResolvedValue({ data: saved, error: null })
 const values = { ...eventRowToFormValues(testEvent), mapIconVersionId: version }
 await expect(saveEventDraft({ eventId: null, organizerId: testEvent.organizer_id, values, requestId: request })).resolves.toEqual(saved)
 expect(from).not.toHaveBeenCalled()
 expect(rpc).toHaveBeenCalledWith('save_owned_event_draft', {
  p_event_id: null, p_event: expect.objectContaining({ map_icon_version_id: version }),
  p_expected_updated_at: null, p_request_id: request,
 })
})
it.each([version, null])('sends icon %s with the reviewed context and revision, preserving exact timestamps', async choice => {
 rpc.mockResolvedValue({ error: { message: 'EVENT_CONTEXT_CONFLICT' }, data: null })
 const baseline = { ...testEvent, map_icon_version_id: version, starts_at: '2027-11-07T09:30:15.123Z' }
 const values = { ...eventRowToFormValues(baseline), mapIconVersionId: choice }
 await expect(saveEventIfCurrent(testEvent.id, testEvent.organizer_id, 'reviewed-token', values, baseline)).rejects.toThrow('conflict')
 expect(rpc).toHaveBeenCalledTimes(1)
 expect(rpc).toHaveBeenCalledWith('save_owned_event_revision_if_current', {
  p_event_id: testEvent.id, p_expected_context: 'reviewed-token',
  p_event: expect.objectContaining({ map_icon_version_id: choice, expected_content_revision: 1, starts_at: baseline.starts_at }),
 })
})
it('hydrates immutable choice and does not erase it from a legacy payload that omits the field', () => {
 expect(eventRowToFormValues({ ...testEvent, map_icon_version_id: version }).mapIconVersionId).toBe(version)
 const { mapIconVersionId: ignored, ...legacy } = eventRowToFormValues(testEvent)
 void ignored
 expect(draftPayload(legacy)).not.toHaveProperty('map_icon_version_id')
})
it('rejects a malformed icon assignment in the owned context', () => {
 const raw = { ...testContext(), requirements: { policies_unavailable: true, needs_acceptance: true, minimum_age: null, alcohol_present: null, cannabis_present: null, explicit_adult_content: null, gambling_present: null, weapons_present: null, high_risk_activity: null } }
 expect(() => parseEventContext({ ...raw, event: { ...raw.event, map_icon_version_id: 'https://untrusted.invalid/icon.png' } }, testEvent.id, testEvent.organizer_id)).toThrow()
})
