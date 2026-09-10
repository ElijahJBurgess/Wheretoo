import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const { getEventMetrics } = vi.hoisted(() => ({ getEventMetrics: vi.fn() }))
vi.mock('./operations.api', () => ({ getEventMetrics }))
vi.mock('../auth/SessionProvider', () => ({ useSession: () => ({ status: 'authenticated', user: { id: 'owner' } }) }))
import { OrganizerDashboardPage } from './OrganizerDashboardPage'
const data = { event: { id: 'event', title: 'Sunset Rooftop Sessions', status: 'published', startsAt: null, endsAt: null, venueName: null, city: null, artworkPath: null }, grossSalesMinor: 342000, sold: 142, orderCount: 98, checkedIn: 87, issued: 142, capacity: 200, admissionEligible: true, tiers: [{ id: 'ga', name: 'General Admission', status: 'active', sold: 110, remaining: 40, capacity: 150, grossSalesMinor: 220000 }] }
function show() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/organizer/events/event/dashboard']}><Routes><Route path="/organizer/events/:eventId/dashboard" element={<OrganizerDashboardPage />} /></Routes></MemoryRouter></QueryClientProvider>) }
beforeEach(() => { getEventMetrics.mockReset() })
it('shows four historical metrics, tier snapshots, and existing event actions', async () => {
 getEventMetrics.mockResolvedValue(data); show()
 expect(await screen.findByRole('heading', { name: data.event.title })).toBeVisible()
 for (const label of ['Gross ticket sales', 'Tickets sold', 'Orders', 'Checked in']) expect(screen.getByText(label, { selector: 'dt' })).toBeVisible()
 expect(screen.getByText('87 / 142')).toBeVisible()
 expect(screen.getByText('110 sold · 40 remaining')).toBeVisible()
 expect(screen.getByRole('link', { name: 'Edit event' })).toHaveAttribute('href', '/organizer/events/event/edit')
 expect(screen.getByRole('link', { name: 'Check in guests' })).toHaveAttribute('href', '/organizer/events/event/check-in')
})
it('does not invent zero metrics on read failure', async () => {
 getEventMetrics.mockRejectedValue(new Error('private')); show()
 expect(await screen.findByRole('alert')).toHaveTextContent('Event metrics unavailable')
 expect(screen.queryByText('Gross ticket sales')).not.toBeInTheDocument()
 expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
})
it('retains ended history and blocks the check-in action', async () => {
 getEventMetrics.mockResolvedValue({ ...data, admissionEligible: false, event: { ...data.event, endsAt: '2020-01-01T00:00:00Z' } }); show()
 expect(await screen.findByText('Ended')).toBeVisible()
 expect(screen.getByRole('button', { name: 'Check-in closed' })).toBeDisabled()
 expect(screen.getByRole('link', { name: 'View orders' })).toBeVisible()
})
