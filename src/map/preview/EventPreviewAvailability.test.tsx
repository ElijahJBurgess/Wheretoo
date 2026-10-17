import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import type { PublicTicketingEvent } from '../../features/tickets/ticket.types'
import { getDevelopmentMapEvents } from '../data/developmentMapEvents'
import { EventPreviewCard } from './EventPreviewCard'
const { read } = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../../features/tickets/publicTicketing.api', () => ({ getPublicEventTicketing: read }))
const eventId = 'eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f'
const tierId = '900a9142-9111-4f87-84d5-b8545a94c7fb'
const publicEvent: PublicTicketingEvent = {
  event: {
    id: eventId,
    title: 'Night Market',
    description: 'Food, music, and neighborhood makers.',
    category: 'community',
    starts_at: '2026-09-01T02:00:00+00:00',
    ends_at: '2026-09-01T05:00:00+00:00',
    timezone: 'America/Los_Angeles',
    venue_name: 'Civic Center Plaza',
    address_line1: '1 Dr Carlton B Goodlett Place',
    address_line2: null,
    city: 'San Francisco',
    region: 'CA',
    postal_code: '94102',
    country_code: 'US',
    latitude: 37.7793,
    longitude: -122.4193,
    artwork_path: null,
    animation_preset: 'generic',
    admission_type: 'paid',
    minimum_age: 'all_ages',
    advisories: [],
    organizer: { id: '6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe', display_name: 'Bay City Arts' },
  },
  tiers: [{
    id: tierId,
    name: 'General admission',
    description: 'Entry to the market.',
    unit_amount_minor: 2_500,
    currency: 'usd',
    availability_status: 'available',
  }, {
    id: '6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe',
    name: 'VIP',
    description: 'Early access and a reserved lounge.',
    unit_amount_minor: 7_500,
    currency: 'usd',
    availability_status: 'available',
  }],
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
it('replaces stale preview price with current available tiers, sold out, unknown and unavailable without changing navigation', async () => {
  vi.useFakeTimers()
  read.mockResolvedValue({ ...publicEvent, event: { ...publicEvent.event, ends_at: '2099-01-01T00:00:00Z' }, tiers: [
    { ...publicEvent.tiers[0], unit_amount_minor: 1000, availability_status: 'sold_out' },
    { ...publicEvent.tiers[1], unit_amount_minor: 3000, availability_status: 'available' },
  ] })
  const event = { ...getDevelopmentMapEvents()[0], id: eventId, minimumPriceMinor: 1000 }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter><EventPreviewCard event={event} navigation={{ kind: 'enabled', to: '/events/' + eventId }} onClose={() => {}} /></MemoryRouter></QueryClientProvider>)
  expect(screen.getByText('Checking availability…')).toBeInTheDocument()
  await act(async () => { await vi.advanceTimersByTimeAsync(10) })
  expect(screen.getByText('From $30')).toBeInTheDocument()
  expect(screen.queryByText('From $10')).not.toBeInTheDocument()
  read.mockResolvedValue({ ...publicEvent, event: { ...publicEvent.event, ends_at: '2099-01-01T00:00:00Z' }, tiers: publicEvent.tiers.map(t => ({ ...t, availability_status: 'sold_out' })) })
  await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
  expect(screen.getByText('Sold out')).toBeInTheDocument()
  read.mockRejectedValue(new Error('offline'))
  await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
  expect(screen.getByText('Availability unknown')).toBeInTheDocument()
  expect(screen.queryByText('Sold out')).not.toBeInTheDocument()
  read.mockResolvedValue(null)
  await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
  expect(screen.getByText('Currently unavailable')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'View event' })).toHaveAttribute('href', '/events/' + eventId)
  fireEvent.click(screen.getByRole('button', { name: 'Close event preview' }))
  client.clear()
})

it('withdraws the displayed price while a visible refetch checks current inventory', async () => {
  vi.useFakeTimers()
  read.mockResolvedValue({ ...publicEvent, tiers: [publicEvent.tiers[0]] })
  const event = { ...getDevelopmentMapEvents()[0], id: eventId }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter><EventPreviewCard event={event} navigation={{ kind: 'enabled', to: '/events/' + eventId }} onClose={() => {}} /></MemoryRouter></QueryClientProvider>)
  await act(async () => { await vi.advanceTimersByTimeAsync(10) })
  expect(screen.getByText('From $25')).toBeInTheDocument()
  let resolve!: (value: typeof publicEvent) => void
  read.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
  expect(screen.getByText('Checking availability…')).toBeInTheDocument()
  expect(screen.queryByText('From $25')).not.toBeInTheDocument()
  await act(async () => { resolve({ ...publicEvent, tiers: [{ ...publicEvent.tiers[0], availability_status: 'sold_out' }] }); await vi.advanceTimersByTimeAsync(10) })
  expect(screen.getByText('Sold out')).toBeInTheDocument()
  client.clear()
})
