import { beforeEach, describe, expect, it, vi } from 'vitest'

const { functionsInvoke, rpc } = vi.hoisted(() => ({ functionsInvoke: vi.fn(), rpc: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ supabase: { functions: { invoke: functionsInvoke }, rpc } }))

import {
  ModerationApiError,
  acceptCurrentEventPolicies,
  getOwnedEventRequirements,
  getPublicEvent,
  reportPublicEvent,
  submitModerationAction,
} from './moderation.api'

const eventId = 'b4ee321a-bdf6-43b2-a7f4-d6478d942908'
const requirementsRow = {
  minimum_age: 'all_ages', alcohol_present: false, cannabis_present: false,
  explicit_adult_content: false, gambling_present: false, weapons_present: false,
  high_risk_activity: false, needs_acceptance: true,
  organizer_terms_label: 'Organizer Terms', organizer_terms_version_id: 'dev-organizer-terms-v1',
  organizer_terms_stage: 'development_placeholder', organizer_terms_url: '/organizer-terms',
  event_policy_label: 'Event Policy', event_policy_version_id: 'dev-event-policy-v1',
  event_policy_stage: 'development_placeholder', event_policy_url: '/event-policy',
}

describe('moderation browser API', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses owner RPCs, parses their narrow result, and returns safe not-found', async () => {
    rpc.mockResolvedValueOnce({ data: [requirementsRow], error: null })
    await expect(getOwnedEventRequirements(eventId)).resolves.toMatchObject({ minimumAge: 'all_ages' })
    expect(rpc).toHaveBeenCalledWith('get_owned_event_requirements', { p_event_id: eventId })

    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'EVENT_NOT_FOUND' } })
    await expect(getOwnedEventRequirements(eventId)).resolves.toBeNull()
  })

  it('sends only the event identifier for policy acceptance', async () => {
    rpc.mockResolvedValue({ data: [{ ...requirementsRow, needs_acceptance: false }], error: null })
    await acceptCurrentEventPolicies(eventId)
    expect(rpc).toHaveBeenCalledWith('accept_current_event_policies', { p_event_id: eventId })
  })

  it('sends only event ID and report reason through the public Edge boundary', async () => {
    functionsInvoke.mockResolvedValue({ data: { status: 'received' }, error: null })
    await expect(reportPublicEvent(eventId, 'scam_misleading')).resolves.toEqual({ status: 'received' })
    expect(functionsInvoke).toHaveBeenCalledWith('report-event', { body: { eventId, reason: 'scam_misleading' } })
  })

  it('sends exact expected staff facts and hides raw database errors', async () => {
    rpc.mockResolvedValueOnce({ data: '61b942dc-908f-4c6e-947c-905ec32c50de', error: null })
    await submitModerationAction({
      eventId, expectedContentRevision: 4, expectedInputSha256: 'a'.repeat(64),
      expectedModerationVersion: 7, action: 'hold', reasonCode: 'user_report', internalNote: '',
    })
    expect(rpc).toHaveBeenCalledWith('moderate_event', expect.objectContaining({
      p_event_id: eventId, p_expected_content_revision: 4, p_expected_input_sha256: 'a'.repeat(64),
      p_expected_moderation_version: 7, p_action: 'hold', p_reason_code: 'user_report', p_internal_note: '',
    }))

    rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'private schema detail' } })
    await expect(acceptCurrentEventPolicies(eventId)).rejects.toEqual(new ModerationApiError('UNAVAILABLE'))
  })

  it('does not expose malformed public projections', async () => {
    rpc.mockResolvedValue({ data: [{ id: eventId, organizer: { id: eventId } }], error: null })
    await expect(getPublicEvent(eventId)).rejects.toEqual(new ModerationApiError('UNAVAILABLE'))
  })
})
