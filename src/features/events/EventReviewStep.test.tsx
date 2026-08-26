import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { EventReviewStep } from './EventReviewStep'

describe('EventReviewStep', () => {
  it('guides paid drafts to ticket setup instead of obsolete unavailable guidance', () => {
    const router = createMemoryRouter([
      { path: '/', element: <EventReviewStep eventId="event-1" values={{ title: '', description: '', category: '', startsAt: '', endsAt: '', timezone: 'America/Los_Angeles', venueName: '', location: null, admissionType: 'paid', capacity: null }} /> },
    ])
    render(<RouterProvider router={router} />)
    expect(screen.getByRole('link', { name: 'Set up paid tickets' })).toHaveAttribute('href', '/organizer/events/event-1/tickets')
    expect(screen.queryByText(/not available in this milestone/i)).not.toBeInTheDocument()
  })
})
