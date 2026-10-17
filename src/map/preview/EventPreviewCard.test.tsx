import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { WheretooMapEvent } from '../data/wheretooMapEvents'
import { EventPreviewCard } from './EventPreviewCard'
import { resolveEventPreviewNavigation } from './eventPreviewNavigation'

const event: WheretooMapEvent = {
  mapIconVersionId: null,
  id: '9f4fcafa-4c56-4e81-a447-c3c639686d77', title: 'A Very Long Oakland Day Party Title That Still Wraps', category: 'nightlife',
  startsAt: '2027-06-12T21:00:00.000Z', endsAt: '2027-06-13T02:00:00.000Z', timezone: 'America/Los_Angeles',
  latitude: 37.807, longitude: -122.259, animationPreset: 'generic',
  venueLabel: 'Lake Merritt Patio With a Deliberately Long Venue Name', admissionType: 'paid', minimumPriceMinor: 2000,
  minimumAge: '21_plus', advisories: [], artworkReference: null,
}

describe('EventPreviewCard', () => {
  it('presents one non-modal event region with a labeled close control and fallback artwork', () => {
    render(<EventPreviewCard event={event} navigation={{ kind: 'unavailable' }} onClose={vi.fn()} />)

    expect(screen.getByRole('region', { name: event.title })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: event.title })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close event preview' })).toBeInTheDocument()
    expect(screen.getByLabelText('Event artwork unavailable')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Admission' })).toHaveTextContent('Availability unknown')
  })

  it('falls back without leaving a broken image after artwork fails', () => {
    render(<EventPreviewCard event={{ ...event, artworkReference: 'https://images.example.com/missing.jpg' }} navigation={{ kind: 'unavailable' }} onClose={vi.fn()} />)
    fireEvent.error(screen.getByRole('img', { name: `${event.title} artwork` }))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Event artwork unavailable')).toBeInTheDocument()
  })

  it('ignores a late artwork failure from the previously selected event', () => {
    const view = render(<EventPreviewCard event={{ ...event, artworkReference: 'https://images.example.com/first.jpg' }} navigation={{ kind: 'unavailable' }} onClose={vi.fn()} />)
    const staleImage = screen.getByRole('img', { name: `${event.title} artwork` })
    view.rerender(<EventPreviewCard event={{ ...event, id: 'a41a70c9-3ec8-4802-8c54-b95bd60b41e7', title: 'Second Event', artworkReference: 'https://images.example.com/second.jpg' }} navigation={{ kind: 'unavailable' }} onClose={vi.fn()} />)
    fireEvent.error(staleImage)
    expect(screen.getByRole('img', { name: 'Second Event artwork' })).toHaveAttribute('src', 'https://images.example.com/second.jpg')
  })

  it('renders demo availability as a disabled action with its accessible explanation and never routes', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter([{
      path: '/map',
      element: <EventPreviewCard event={event} navigation={{
        kind: 'disabled', indication: 'Demo event', explanation: 'Demo event — full event page not connected yet.',
      }} onClose={vi.fn()} />,
    }, { path: '/events/:eventId', element: <p>event destination</p> }], { initialEntries: ['/map'] })
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>)

    expect(screen.getByText('Demo event')).toBeInTheDocument()
    const action = screen.getByRole('button', { name: 'View event' })
    expect(action).toBeDisabled()
    expect(action).toHaveAccessibleDescription('Demo event — full event page not connected yet.')
    await user.click(action)
    expect(router.state.location.pathname).toBe('/map')
  })

  it('routes a validated real event ID to the existing event detail path', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter([{
      path: '/map',
      element: <EventPreviewCard event={event} navigation={resolveEventPreviewNavigation(event.id)} onClose={vi.fn()} />,
    }, { path: '/events/:eventId', element: <p>event destination</p> }], { initialEntries: ['/map'] })
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>)

    await user.click(screen.getByRole('link', { name: 'View event' }))
    expect(router.state.location.pathname).toBe(`/events/${event.id}`)
    expect(screen.getByText('event destination')).toBeInTheDocument()
  })

  it('offers Back to events only when the preview came from a chooser', () => {
    const onBack = vi.fn()
    const view = render(<EventPreviewCard event={event} navigation={{ kind: 'unavailable' }} onClose={vi.fn()} onBack={onBack} />)
    fireEvent.click(screen.getByRole('button', { name: 'Back to events' }))
    expect(onBack).toHaveBeenCalledOnce()
    view.rerender(<EventPreviewCard event={event} navigation={{ kind: 'unavailable' }} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Back to events' })).not.toBeInTheDocument()
  })
})
