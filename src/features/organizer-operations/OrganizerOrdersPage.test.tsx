import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const { listEventOrders, getEventMetrics } = vi.hoisted(() => ({ listEventOrders: vi.fn(), getEventMetrics: vi.fn() }))
vi.mock('./operations.api', () => ({ listEventOrders, getEventMetrics }))
vi.mock('../auth/SessionProvider', () => ({ useSession: () => ({ status: 'authenticated', user: { id: 'owner' } }) }))
import { OrganizerOrdersPage } from './OrganizerOrdersPage'
const order = { id: 'order', orderNumber: 'WT-123', buyerName: 'Alex Chen', buyerEmail: 'alex@example.invalid', createdAt: '2026-01-01T00:00:00Z', paidAt: '2026-01-01T00:00:00Z', status: 'paid', quantity: 3, totalMinor: 3001, currency: 'usd', items: [] }
function show() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/organizer/events/event/orders']}><Routes><Route path="/organizer/events/:eventId/orders" element={<OrganizerOrdersPage />} /></Routes></MemoryRouter></QueryClientProvider>) }
beforeEach(() => { vi.resetAllMocks(); getEventMetrics.mockResolvedValue({ event: { title: 'Sunset' } }) })
it('searches within the selected event and keeps one row per order', async () => {
 listEventOrders.mockResolvedValue({ orders: [order], nextCursor: null }); show()
 expect(await screen.findByRole('link', { name: /Alex Chen/ })).toHaveAttribute('href','/organizer/events/event/orders/order')
 expect(screen.getAllByText('Alex Chen')).toHaveLength(1)
 await userEvent.type(screen.getByRole('searchbox'), 'alex')
 await userEvent.click(screen.getByRole('button', { name: 'Search' }))
 expect(listEventOrders).toHaveBeenLastCalledWith('event', 'alex', null)
})
it('keeps current rows and exposes retry when the next page fails', async () => {
 listEventOrders.mockResolvedValueOnce({ orders: [order], nextCursor: { createdAt: order.createdAt, id: order.id } }).mockRejectedValue(new Error('failed')); show()
 await screen.findByText('Alex Chen'); await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
 expect(await screen.findByRole('alert')).toHaveTextContent('More orders could not load')
 expect(screen.getByText('Alex Chen')).toBeVisible()
})
it('retains the last successful rows when a new search fails',async()=>{
 listEventOrders.mockResolvedValueOnce({orders:[order],nextCursor:null}).mockRejectedValue(new Error('failed'));show()
 await screen.findByText('Alex Chen');await userEvent.type(screen.getByRole('searchbox'),'absent');await userEvent.click(screen.getByRole('button',{name:'Search'}))
 expect(await screen.findByRole('alert')).toHaveTextContent('Showing previous results')
 expect(screen.getByText('Alex Chen')).toBeVisible()
})
