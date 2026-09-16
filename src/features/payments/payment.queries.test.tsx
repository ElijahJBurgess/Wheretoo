import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
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


  it('refreshes a cached Connect status on Settings entry and preserves provider read failure', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    client.setQueryData(paymentKeys.connect('organizer-1'), status)
    getConnectStatus.mockRejectedValueOnce(new Error('Payment setup could not be loaded'))
    const { result } = renderHook(() => useConnectStatus('organizer-1', { fresh: true }), { wrapper: createWrapper(client) })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(getConnectStatus).toHaveBeenCalledWith('organizer-1', expect.any(Function))
    expect(result.current.data?.status).not.toBe('not_started')
    expect(createConnectAccountSession).not.toHaveBeenCalled()
  })

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
    const { result } = renderHook(() => useConnectAccountSession(), {
      wrapper: createWrapper(client),
    })

    await act(async () => {
      await result.current.mutateAsync('organizer-1')
    })

    expect(client.getQueryData(paymentKeys.connect('organizer-1'))).toEqual(status)
    expect(client.getQueryData(paymentKeys.connect('organizer-2'))).toBe('other organizer status')
  })

  it('keeps a deferred Account Session response on the immutable initiating organizer after an identity switch', async () => {
    let resolveSession!: (value: { clientSecret: string; status: typeof status }) => void
    const deferredSession = new Promise<{ clientSecret: string; status: typeof status }>((resolve) => {
      resolveSession = resolve
    })
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    client.setQueryData(paymentKeys.connect('organizer-b'), 'organizer-b status')
    createConnectAccountSession.mockReturnValue(deferredSession)
    const { result, rerender } = renderHook(
      ({ userId }: { userId: string }) => {
        void userId
        return useConnectAccountSession()
      },
      { initialProps: { userId: 'organizer-a' }, wrapper: createWrapper(client) },
    )

    let pending!: Promise<unknown>
    act(() => {
      pending = result.current.mutateAsync('organizer-a' as never)
    })
    rerender({ userId: 'organizer-b' })
    resolveSession({ clientSecret: 'session-secret', status })
    await act(async () => {
      await pending
    })

    expect(client.getQueryData(paymentKeys.connect('organizer-a'))).toEqual(status)
    expect(client.getQueryData(paymentKeys.connect('organizer-b'))).toBe('organizer-b status')
  })
})
