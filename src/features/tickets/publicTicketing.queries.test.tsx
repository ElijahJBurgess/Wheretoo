import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getPublicEventTicketing } = vi.hoisted(() => ({ getPublicEventTicketing: vi.fn() }))
vi.mock('./publicTicketing.api', () => ({ getPublicEventTicketing }))

import { usePublicTicketingEvent } from './publicTicketing.queries'
import { ticketKeys } from './ticket.queries'

function wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
}

describe('public ticketing query', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses an identity-free stable public key and requests only the event projection', async () => {
    getPublicEventTicketing.mockResolvedValue(null)
    const { result } = renderHook(() => usePublicTicketingEvent('eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(ticketKeys.public('eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f')).toEqual([
      'tickets', 'public', 'eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f',
    ])
    expect(getPublicEventTicketing).toHaveBeenCalledWith('eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f')
  })

  it('normalizes an equivalent route UUID before creating its public cache identity', async () => {
    getPublicEventTicketing.mockResolvedValue(null)
    const { result } = renderHook(
      () => usePublicTicketingEvent('EB0FD9D5-D7D5-45DD-A99F-0C8A191BDC6F'),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(getPublicEventTicketing).toHaveBeenCalledWith('eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f')
  })
})
