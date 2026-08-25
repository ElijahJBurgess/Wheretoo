import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Organizer } from './organizer.api'
import type { OrganizerInput } from './organizer.schemas'

const { saveOrganizer } = vi.hoisted(() => ({ saveOrganizer: vi.fn() }))

vi.mock('./organizer.api', () => ({
  getOrganizer: vi.fn(),
  saveOrganizer,
}))

import { organizerKeys, shouldRetryOrganizerQuery, useSaveOrganizer } from './organizer.queries'

const organizer: Organizer = {
  id: 'user-1',
  display_name: 'Bay City Arts',
  organizer_type: null,
  bio: null,
  website_url: null,
  base_city: null,
  country_code: 'US',
  onboarding_completed_at: '2026-08-24T12:00:00.000Z',
  created_at: '2026-08-24T12:00:00.000Z',
  updated_at: '2026-08-24T12:00:00.000Z',
}

const input: OrganizerInput = {
  displayName: 'Bay City Arts',
  organizerType: '',
  bio: '',
  websiteUrl: '',
  baseCity: '',
}

describe('organizer query contracts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes a successful save to only the authenticated organizer detail cache', async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    queryClient.setQueryData(organizerKeys.detail('user-2'), 'unrelated organizer')
    saveOrganizer.mockResolvedValue(organizer)
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useSaveOrganizer('user-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(input)
    })

    expect(saveOrganizer).toHaveBeenCalledWith('user-1', input)
    expect(queryClient.getQueryData(organizerKeys.detail('user-1'))).toEqual(organizer)
    expect(queryClient.getQueryData(organizerKeys.detail('user-2'))).toBe('unrelated organizer')
  })

  it('retries only the exact fresh-browser JWT clock-skew response within the bound', () => {
    expect(shouldRetryOrganizerQuery(0, { message: 'JWT issued at future' })).toBe(true)
    expect(shouldRetryOrganizerQuery(19, { message: 'JWT issued at future' })).toBe(true)
    expect(shouldRetryOrganizerQuery(20, { message: 'JWT issued at future' })).toBe(false)
    expect(shouldRetryOrganizerQuery(0, {
      message: 'Request rejected: JWT issued at future while validating another claim',
    })).toBe(false)
    expect(shouldRetryOrganizerQuery(0, new Error('Network request failed'))).toBe(false)
  })
})
