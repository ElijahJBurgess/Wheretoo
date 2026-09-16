import { onlineManager } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { AppProviders } from '../providers/AppProviders'
import { PublicTicketEventPage } from '../../features/tickets/PublicTicketEventPage'

const read = vi.hoisted(() => vi.fn())
vi.mock('../../features/tickets/publicTicketing.api', () => ({ getPublicEventTicketing: read }))

afterEach(() => { onlineManager.setOnline(true); vi.restoreAllMocks() })

it('lets the canonical query resume a paused read and refetch once on reconnect without a second connectivity request', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  onlineManager.setOnline(false)
  read.mockReset().mockResolvedValue(null)
  render(<AppProviders><MemoryRouter initialEntries={['/events/6e22c270-49d3-4a4f-9d71-1732bd191440']}>
    <Routes><Route path='/events/:eventId' element={<PublicTicketEventPage />} /></Routes>
  </MemoryRouter></AppProviders>)
  expect(screen.getByRole('heading', { name: 'Waiting for a connection' })).toBeInTheDocument()
  expect(read).not.toHaveBeenCalled()
  act(() => onlineManager.setOnline(true))
  await screen.findByRole('heading', { name: 'Event not found' })
  expect(read).toHaveBeenCalledTimes(1)
  act(() => { onlineManager.setOnline(false); window.dispatchEvent(new Event('offline')) })
  act(() => { onlineManager.setOnline(true); window.dispatchEvent(new Event('online')) })
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  expect(read).toHaveBeenLastCalledWith('6e22c270-49d3-4a4f-9d71-1732bd191440')
})
