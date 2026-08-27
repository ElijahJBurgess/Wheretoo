import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { acceptCurrentEventPolicies, getOwnedEventRequirements, requestEventReview, saveEventRequirements, submitModerationAction } = vi.hoisted(() => ({
  acceptCurrentEventPolicies: vi.fn(), getOwnedEventRequirements: vi.fn(), requestEventReview: vi.fn(), saveEventRequirements: vi.fn(), submitModerationAction: vi.fn(),
}))
vi.mock('./moderation.api', () => ({ acceptCurrentEventPolicies, getOwnedEventRequirements, requestEventReview, saveEventRequirements, submitModerationAction }))
vi.mock('../events/event.queries', () => ({
  eventKeys: {
    detail: (organizerId: string, eventId: string) => ['events', 'detail', organizerId, eventId],
    ownedList: (organizerId: string) => ['events', 'owned', organizerId],
  },
}))
import { moderationKeys, useAcceptCurrentEventPolicies, useOwnedEventRequirements, useRequestEventReview, useSaveEventRequirements, useSubmitModerationAction } from './moderation.queries'

const requirements = {
  minimumAge: 'all_ages' as const, alcoholPresent: false, cannabisPresent: false, explicitAdultContent: false,
  gamblingPresent: false, weaponsPresent: false, highRiskActivity: false, needsAcceptance: true,
  organizerTerms: { policyKind: 'organizer_terms', label: 'Organizer Terms', versionId: 'dev-organizer-terms-v1', stage: 'development_placeholder', publicUrl: '/organizer-terms', effectiveAt: '2026-08-26T00:00:00Z' },
  eventPolicy: { policyKind: 'event_policy', label: 'Event Policy', versionId: 'dev-event-policy-v1', stage: 'development_placeholder', publicUrl: '/event-policy', effectiveAt: '2026-08-26T00:00:00Z' },
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('moderation query cache contracts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses owner and staff identity in private keys and no key for a blank identity', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useOwnedEventRequirements('', 'event-1'), { wrapper: wrapper(client) })
    expect(moderationKeys.requirements('organizer-1', 'event-1')).toEqual(['moderation', 'requirements', 'organizer-1', 'event-1'])
    expect(moderationKeys.case('staff-1', 'event-1')).toEqual(['moderation', 'case', 'staff-1', 'event-1'])
    expect(result.current.fetchStatus).toBe('idle')
    expect(getOwnedEventRequirements).not.toHaveBeenCalled()
  })

  it('does not reuse private requirements after an identity switch', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(moderationKeys.requirements('organizer-a', 'event-1'), requirements)
    getOwnedEventRequirements.mockResolvedValue(null)
    const { result } = renderHook(() => useOwnedEventRequirements('organizer-b', 'event-1'), { wrapper: wrapper(client) })
    expect(result.current.data).toBeUndefined()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
    expect(client.getQueryData(moderationKeys.requirements('organizer-a', 'event-1'))).toEqual(requirements)
  })

  it('invalidates only exact owner and public event contracts after acceptance', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    acceptCurrentEventPolicies.mockResolvedValue({ ...requirements, needsAcceptance: false })
    const { result } = renderHook(() => useAcceptCurrentEventPolicies('organizer-1', 'event-1'), { wrapper: wrapper(client) })
    await act(async () => { await result.current.mutateAsync() })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: moderationKeys.requirements('organizer-1', 'event-1'), exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: moderationKeys.agreement('organizer-1', 'event-1'), exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['public-event', 'event-1'], exact: true })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: moderationKeys.requirements('organizer-2', 'event-1'), exact: true })
  })

  it('invalidates only the exact owner families after a requirements save', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    client.setQueryData(['events', 'detail', 'organizer-2', 'event-1'], 'other organizer event')
    client.setQueryData(moderationKeys.requirements('organizer-2', 'event-1'), 'other organizer requirements')
    saveEventRequirements.mockResolvedValue(requirements)
    const { result } = renderHook(() => useSaveEventRequirements('organizer-1', 'event-1'), { wrapper: wrapper(client) })
    await act(async () => { await result.current.mutateAsync(requirements) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: moderationKeys.review('organizer-1', 'event-1'), exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: moderationKeys.publicEvent('event-1'), exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['events', 'detail', 'organizer-1', 'event-1'], exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['events', 'owned', 'organizer-1'], exact: true })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: moderationKeys.review('organizer-2', 'event-1'), exact: true })
    expect(client.getQueryState(['events', 'detail', 'organizer-2', 'event-1'])?.isInvalidated).toBe(false)
    expect(client.getQueryState(moderationKeys.requirements('organizer-2', 'event-1'))?.isInvalidated).toBe(false)
  })

  it('invalidates the initiating owner review facts without a public invalidation', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    requestEventReview.mockResolvedValue('37beaa67-b2a2-4b56-9c6c-e91208925c45')
    const { result } = renderHook(() => useRequestEventReview('organizer-1', 'event-1'), { wrapper: wrapper(client) })
    await act(async () => { await result.current.mutateAsync('Please review this event.') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: moderationKeys.review('organizer-1', 'event-1'), exact: true })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: moderationKeys.publicEvent('event-1'), exact: true })
  })

  it('invalidates only the acting staff member case, queue, and event public projection', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    client.setQueryData(moderationKeys.case('staff-2', 'b4ee321a-bdf6-43b2-a7f4-d6478d942908'), 'other staff case')
    submitModerationAction.mockResolvedValue('37beaa67-b2a2-4b56-9c6c-e91208925c45')
    const { result } = renderHook(() => useSubmitModerationAction('staff-1', 'organizer-1'), { wrapper: wrapper(client) })
    await act(async () => {
      await result.current.mutateAsync({
        eventId: 'b4ee321a-bdf6-43b2-a7f4-d6478d942908', expectedContentRevision: 2,
        expectedInputSha256: 'a'.repeat(64), expectedModerationVersion: 4,
        action: 'hold', reasonCode: 'user_report', internalNote: '',
      })
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: moderationKeys.case('staff-1', 'b4ee321a-bdf6-43b2-a7f4-d6478d942908'), exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: moderationKeys.queue('staff-1'), exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['events', 'detail', 'organizer-1', 'b4ee321a-bdf6-43b2-a7f4-d6478d942908'], exact: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['events', 'owned', 'organizer-1'], exact: true })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: moderationKeys.case('staff-2', 'b4ee321a-bdf6-43b2-a7f4-d6478d942908'), exact: true })
    expect(client.getQueryState(moderationKeys.case('staff-2', 'b4ee321a-bdf6-43b2-a7f4-d6478d942908'))?.isInvalidated).toBe(false)
  })
})
