import { beforeEach, describe, expect, it, vi } from 'vitest'

const { functionsInvoke, rpc } = vi.hoisted(() => ({ functionsInvoke: vi.fn(), rpc: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ supabase: { functions: { invoke: functionsInvoke }, rpc } }))

import {
  ModerationApiError,
  acceptCurrentEventPolicies,
  getModerationCase,
  getMyStaffRole,
  getOwnedEventRequirements,
  getPublicEvent,
  listModerationQueue,
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
const staffCaseRow = {
  event_id: eventId, moderation_status: 'under_review', content_revision: 2, input_sha256: 'a'.repeat(64), moderation_version: 4,
  public_history_status: 'never_public', first_publicly_eligible_at: null, title: 'Night market', description: 'Food and local makers.',
  category: 'community', starts_at: '2026-09-02T01:00:00Z', ends_at: '2026-09-02T04:00:00Z', timezone: 'America/Los_Angeles',
  venue_name: 'Civic Center', address_line1: '1 Market St', address_line2: null, city: 'San Francisco', region: 'CA', postal_code: '94102', country_code: 'US',
  mapbox_feature_id: 'address.1', latitude: 37.78, longitude: -122.42,
  disclosures: { minimum_age: 'all_ages', alcohol_present: false, cannabis_present: false, explicit_adult_content: false, gambling_present: false, weapons_present: false, high_risk_activity: false },
  legacy_resolution: {},
  actions: [{ id: '37beaa67-b2a2-4b56-9c6c-e91208925c45', action: 'hold', previous_status: 'clear', new_status: 'under_review', reason_code: 'user_report', internal_note: null, created_at: '2026-08-26T00:00:00Z', moderation_version: 4 }],
  evaluations: [{ id: '2c3c855f-cdd2-495e-8ccd-5f82648aa535', content_revision: 2, status: 'queued', source: 'report', outcome: null, risk_level: null, reason_codes: ['user_report'], failure_code: null, created_at: '2026-08-26T00:00:00Z', finished_at: null }],
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
    expect(rpc).toHaveBeenCalledWith('moderate_event', {
      p_event_id: eventId, p_expected_content_revision: 4, p_expected_input_sha256: 'a'.repeat(64),
      p_expected_moderation_version: 7, p_action: 'hold', p_reason_code: 'user_report', p_internal_note: '',
    })

    rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'private schema detail' } })
    await expect(acceptCurrentEventPolicies(eventId)).rejects.toEqual(new ModerationApiError('UNAVAILABLE'))
  })

  it('does not expose malformed public projections', async () => {
    rpc.mockResolvedValue({ data: [{ id: eventId, organizer: { id: eventId } }], error: null })
    await expect(getPublicEvent(eventId)).rejects.toEqual(new ModerationApiError('UNAVAILABLE'))
  })

  it('parses nullable staff addresses and rejects malformed nested staff JSON or list results', async () => {
    rpc.mockResolvedValueOnce({ data: [staffCaseRow], error: null })
    await expect(getModerationCase(eventId)).resolves.toMatchObject({ addressLine2: null, moderationStatus: 'under_review' })

    rpc.mockResolvedValueOnce({ data: [{ ...staffCaseRow, actions: [{ ...staffCaseRow.actions[0], actor_type: 'admin' }] }], error: null })
    await expect(getModerationCase(eventId)).rejects.toEqual(new ModerationApiError('UNAVAILABLE'))

    rpc.mockResolvedValueOnce({ data: [{ ...staffCaseRow, moderation_status: 'flagged' }], error: null })
    await expect(getModerationCase(eventId)).rejects.toEqual(new ModerationApiError('UNAVAILABLE'))

    rpc.mockResolvedValueOnce({ data: [{ event_id: eventId, moderation_status: 'clear', content_revision: 1, input_sha256: 'a'.repeat(64), moderation_version: 0, public_history_status: 'never_public', queued_evaluation_count: 0, oldest_queued_at: null, leaked: true }], error: null })
    await expect(listModerationQueue(25)).rejects.toEqual(new ModerationApiError('UNAVAILABLE'))
  })

  it('maps only a staff-role denial to no role and bounds malformed or raw errors', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'STAFF_ROLE_REQUIRED' } })
    await expect(getMyStaffRole()).resolves.toBeNull()

    rpc.mockResolvedValueOnce({ data: 'owner', error: null })
    await expect(getMyStaffRole()).rejects.toEqual(new ModerationApiError('UNAVAILABLE'))

    rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'private staff detail' } })
    await expect(getMyStaffRole()).rejects.toEqual(new ModerationApiError('UNAVAILABLE'))
  })
})
