import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModerationApiError } from './moderation.api'

const { actionMutate, actionReset, refetch, resolveMutate, resolveReset, useModerationCase, useResolveLegacyPublicHistory, useStaffContext, useSubmitModerationAction } = vi.hoisted(() => ({
  actionMutate: vi.fn(), actionReset: vi.fn(), refetch: vi.fn(), resolveMutate: vi.fn(), resolveReset: vi.fn(),
  useModerationCase: vi.fn(), useResolveLegacyPublicHistory: vi.fn(), useStaffContext: vi.fn(), useSubmitModerationAction: vi.fn(),
}))

vi.mock('./staffContext', () => ({ useStaffContext }))
vi.mock('./moderation.queries', () => ({ useModerationCase, useResolveLegacyPublicHistory, useSubmitModerationAction }))

import { ModerationCasePage } from './ModerationCasePage'

const eventId = '28000000-0000-4000-8000-000000000006'
const organizerId = '18000000-0000-4000-8000-000000000005'
const baseCase = {
  eventId, organizerId, moderationStatus: 'under_review' as const, contentRevision: 3, inputSha256: 'a'.repeat(64), moderationVersion: 8,
  publicHistoryStatus: 'never_public' as const, firstPubliclyEligibleAt: null, currentOpenReviewRequest: true, currentReportCount: 2,
  title: 'Night market', description: 'Food and local makers.', category: 'community', startsAt: '2026-09-02T01:00:00Z', endsAt: '2026-09-02T04:00:00Z', timezone: 'America/Los_Angeles',
  venueName: 'Civic Center', addressLine1: '1 Market St', addressLine2: null, city: 'San Francisco', region: 'CA', postalCode: '94102', countryCode: 'US',
  mapboxFeatureId: 'address.1', latitude: 37.78, longitude: -122.42,
  disclosures: { minimumAge: 'all_ages' as const, alcoholPresent: false, cannabisPresent: false, explicitAdultContent: false, gamblingPresent: false, weaponsPresent: false, highRiskActivity: true },
  legacyResolution: {},
  actions: [{ id: '37beaa67-b2a2-4b56-9c6c-e91208925c45', action: 'hold' as const, previous_status: 'clear' as const, new_status: 'under_review' as const, reason_code: 'user_report' as const, internal_note: 'Checked current content.', created_at: '2026-08-26T00:00:00Z', moderation_version: 8 }],
  evaluations: [{ id: '2c3c855f-cdd2-495e-8ccd-5f82648aa535', content_revision: 3, status: 'succeeded' as const, source: 'contextual' as const, outcome: 'review_required' as const, risk_level: 'high' as const, reason_codes: ['unsafe_activity' as const], failure_code: null, created_at: '2026-08-26T00:00:00Z', finished_at: '2026-08-26T00:00:01Z' }],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/moderation/events/${eventId}`]}>
      <Routes>
        <Route path="/moderation/events/:eventId" element={<ModerationCasePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function selectActionAndReason(action: string) {
  fireEvent.click(screen.getByRole('radio', { name: action }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Reason' }), { target: { value: 'no_violation' } })
}

describe('ModerationCasePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useStaffContext.mockReturnValue({ role: 'moderator', staffUserId: 'staff-1' })
    useModerationCase.mockReturnValue({ data: baseCase, isPending: false, isError: false, refetch })
    useSubmitModerationAction.mockReturnValue({ isPending: false, mutateAsync: actionMutate, reset: actionReset })
    useResolveLegacyPublicHistory.mockReturnValue({ isPending: false, mutateAsync: resolveMutate, reset: resolveReset })
    actionMutate.mockResolvedValue('action-1')
    resolveMutate.mockResolvedValue('action-2')
  })

  it('renders current safe facts, disclosures, curated reasons, report count, and action timeline', () => {
    renderPage()
    expect(useModerationCase).toHaveBeenCalledWith('staff-1', eventId)
    expect(screen.getByRole('heading', { name: 'Night market' })).toBeInTheDocument()
    expect(screen.getAllByText('Revision 3')).toHaveLength(2)
    expect(screen.getByText('2 reports')).toBeInTheDocument()
    expect(screen.getByText('High-risk activity')).toBeInTheDocument()
    expect(screen.getAllByText('Unsafe activity')).toHaveLength(2)
    expect(screen.getAllByText('Hold')).toHaveLength(2)
    expect(screen.queryByText(/reporter|fingerprint|provider reference|model version|reasoning/i)).not.toBeInTheDocument()
  })

  it('offers only valid transition-specific actions and requires a reason', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByRole('radio', { name: 'Clear' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Hold' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Block' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Remove' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Restore' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Clear' }))
    expect(screen.getByRole('button', { name: 'Apply Clear' })).toBeDisabled()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Reason' }), 'no_violation')
    expect(screen.getByRole('textbox', { name: 'Internal note (optional)' })).toHaveAttribute('maxlength', '1000')
    await user.click(screen.getByRole('button', { name: 'Apply Clear' }))
    expect(actionMutate).toHaveBeenCalledWith({
      eventId, expectedContentRevision: 3, expectedInputSha256: 'a'.repeat(64), expectedModerationVersion: 8,
      action: 'clear', reasonCode: 'no_violation', internalNote: '',
    })
  })

  it.each([
    [{ moderationStatus: 'blocked', publicHistoryStatus: 'never_public' }, ['Clear']],
    [{ moderationStatus: 'removed', publicHistoryStatus: 'previously_public' }, ['Restore']],
    [{ moderationStatus: 'under_review', publicHistoryStatus: 'previously_public' }, ['Clear', 'Hold', 'Remove']],
  ])('maps state/history %o to only its server-valid actions', (facts, expectedActions) => {
    useModerationCase.mockReturnValue({ data: { ...baseCase, ...facts }, isPending: false, isError: false, refetch })
    renderPage()
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual(expectedActions.map((value) => value.toLowerCase()))
  })

  it('maps a stale conflict to a focused reload action', async () => {
    const user = userEvent.setup()
    actionMutate.mockRejectedValue(new ModerationApiError('CONFLICT'))
    renderPage()
    selectActionAndReason('Clear')
    await user.click(screen.getByRole('button', { name: 'Apply Clear' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Case changed while you were reviewing it')
    const reload = screen.getByRole('button', { name: 'Reload case' })
    await waitFor(() => expect(reload).toHaveFocus())
    await user.click(reload)
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('uses a per-attempt mutex while a moderation action is pending', () => {
    actionMutate.mockReturnValue(new Promise(() => undefined))
    renderPage()
    selectActionAndReason('Clear')
    const form = screen.getByRole('button', { name: 'Apply Clear' }).closest('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form!)
    fireEvent.submit(form!)
    expect(actionMutate).toHaveBeenCalledOnce()
  })

  it('limits unknown-history resolution to admins and keeps clearance separate', async () => {
    useModerationCase.mockReturnValue({ data: { ...baseCase, publicHistoryStatus: 'unknown' }, isPending: false, isError: false, refetch })
    const view = renderPage()
    expect(screen.queryByRole('heading', { name: 'Resolve legacy history' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Clear' })).not.toBeInTheDocument()

    useStaffContext.mockReturnValue({ role: 'admin', staffUserId: 'staff-1' })
    view.rerender(
      <MemoryRouter initialEntries={[`/moderation/events/${eventId}`]}>
        <Routes><Route path="/moderation/events/:eventId" element={<ModerationCasePage />} /></Routes>
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Resolve legacy history' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Clear' })).not.toBeInTheDocument()
  })
})
