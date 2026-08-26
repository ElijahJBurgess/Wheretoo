import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createConnectAccountSession, getConnectStatus } = vi.hoisted(() => ({
  createConnectAccountSession: vi.fn(),
  getConnectStatus: vi.fn(),
}))

vi.mock('./payment.api', () => ({ createConnectAccountSession, getConnectStatus }))

import { paymentKeys, useConnectAccountSession, useConnectStatus } from './payment.queries'

const status = {
  status: 'ready' as const,
  requirements_currently_due_count: 0,
  requirements_past_due_count: 0,
  last_status_code: null,
  last_synced_at: '2026-08-25T12:00:00.000Z',
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('payment query contracts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses an authenticated-organizer-scoped Connect key and never enables a blank identity', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useConnectStatus(''), { wrapper: createWrapper(client) })

    expect(paymentKeys.connect('organizer-1')).toEqual(['payments', 'connect', 'organizer-1'])
    expect(result.current.fetchStatus).toBe('idle')
    expect(getConnectStatus).not.toHaveBeenCalled()
  })

  it('writes a refreshed Account Session status only to its owning organizer cache', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    client.setQueryData(paymentKeys.connect('organizer-2'), 'other organizer status')
    createConnectAccountSession.mockResolvedValue({ clientSecret: 'session-secret', status })
    const { result } = renderHook(() => useConnectAccountSession('organizer-1'), {
      wrapper: createWrapper(client),
    })

    await act(async () => {
      await result.current.mutateAsync()
    })

    expect(client.getQueryData(paymentKeys.connect('organizer-1'))).toEqual(status)
    expect(client.getQueryData(paymentKeys.connect('organizer-2'))).toBe('other organizer status')
  })
})
