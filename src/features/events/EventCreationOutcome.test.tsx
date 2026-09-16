import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { EventCreationOutcome } from './EventCreationOutcome'

describe('creation outcome', () => {
  it('offers the public page only for verified public eligibility', () => {
    render(<MemoryRouter><EventCreationOutcome eventId="event-1" state="live" /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Your event is live!' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View event' })).toHaveAttribute('href', '/events/event-1')
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute('href', '/organizer/events/event-1/dashboard')
  })
  it.each(['review', 'unavailable', 'unknown'] as const)('does not imply live or expose public action for %s', (state) => {
    render(<MemoryRouter><EventCreationOutcome eventId="event-1" state={state} /></MemoryRouter>)
    expect(screen.queryByText('Your event is live!')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'View event' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Event status' })).toHaveAttribute('href', '/organizer/events/event-1')
  })
})
