import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { fingerprintConfirmationToken, getOrderConfirmation } = vi.hoisted(() => ({
  fingerprintConfirmationToken: vi.fn(),
  getOrderConfirmation: vi.fn(),
}))
vi.mock('./order.api', () => ({ fingerprintConfirmationToken, getOrderConfirmation }))

import { orderKeys, useOrderConfirmation } from './order.queries'

const token = 'tzGJcJWwoS-3IzLlK9cZV3QHHbC6-vv2d3a-Kl3nHng'
const fingerprint = '59c3bb1da17d73b082ec3cda686cf96a0df6f352b91d227a64cf9084daa51282'
const processing = {
  event: { title: 'Night Market', startsAt: '2026-09-01T02:00:00Z', endsAt: '2026-09-01T05:00:00Z', timezone: 'America/Los_Angeles', venueName: 'Civic Center Plaza' },
  tier: { name: 'General admission' }, orderNumber: 'WT-42', status: 'processing' as const,
}

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('order confirmation query', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.clearAllMocks()
    fingerprintConfirmationToken.mockResolvedValue(fingerprint)
    getOrderConfirmation.mockResolvedValue(processing)
  })

  afterEach(() => vi.useRealTimers())

  it('uses only the browser fingerprint as cache identity and never the clear bearer', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useOrderConfirmation(token), { wrapper: createWrapper(client) })

    await waitFor(() => expect(result.current.data?.status).toBe('processing'))
    expect(orderKeys.confirmation(fingerprint)).toEqual(['orders', 'confirmation', fingerprint])
    const serializedCache = JSON.stringify(client.getQueryCache().getAll().map((query) => query.queryKey))
    expect(serializedCache).not.toContain(token)
    expect(serializedCache).toContain(fingerprint)
  })

  it('polls processing truth each second, stops at 60 seconds, and manual retry starts a new bounded window', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useOrderConfirmation(token), { wrapper: createWrapper(client) })
    await waitFor(() => expect(getOrderConfirmation).toHaveBeenCalledTimes(1))

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(getOrderConfirmation).toHaveBeenCalledTimes(3)

    await act(async () => { await vi.advanceTimersByTimeAsync(58_000) })
    expect(result.current.isTimedOut).toBe(true)
    const callsAtTimeout = getOrderConfirmation.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(getOrderConfirmation).toHaveBeenCalledTimes(callsAtTimeout)

    await act(async () => { await result.current.retry() })
    expect(result.current.isTimedOut).toBe(false)
    expect(getOrderConfirmation.mock.calls.length).toBe(callsAtTimeout + 1)
  })

  it('stops polling on terminal truth and after unmount', async () => {
    getOrderConfirmation.mockResolvedValueOnce(processing).mockResolvedValueOnce({ ...processing, status: 'paid' })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result, unmount } = renderHook(() => useOrderConfirmation(token), { wrapper: createWrapper(client) })
    await waitFor(() => expect(result.current.data?.status).toBe('processing'))
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    await waitFor(() => expect(result.current.data?.status).toBe('paid'))
    const terminalCalls = getOrderConfirmation.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(getOrderConfirmation).toHaveBeenCalledTimes(terminalCalls)

    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(getOrderConfirmation).toHaveBeenCalledTimes(terminalCalls)
  })

  it('discards a fingerprint completion after its route lifecycle unmounts', async () => {
    let resolveFirst!: (value: string) => void
    fingerprintConfirmationToken
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { unmount } = renderHook(() => useOrderConfirmation(token), { wrapper: createWrapper(client) })
    unmount()
    resolveFirst(fingerprint)
    await act(async () => undefined)
    expect(getOrderConfirmation).not.toHaveBeenCalledWith(token)
    expect(JSON.stringify(client.getQueryCache().getAll().map((query) => query.queryKey))).not.toContain(token)
  })
})
