import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { query, refetch } = vi.hoisted(() => ({ query: vi.fn(), refetch: vi.fn() }))
vi.mock('../../features/tickets/publicTicketing.queries', () => ({ usePublicTicketingEvent: query }))
import { EventDescription } from './EventDescription'

describe('EventDescription', () => {
  beforeEach(() => {
    refetch.mockReset()
    query.mockReturnValue({ data: undefined, isPending: true, isError: false, refetch })
  })

  it('shows loading before public event data arrives, then renders the organizer description as text', () => {
    const view = render(<EventDescription eventId="first-event" />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading description')
    query.mockReturnValue({ data: { event: { description: 'Live jazz on the rooftop.\nDoors at six. <script>plain text</script>' } }, isPending: false, isError: false, refetch })
    view.rerender(<EventDescription eventId="first-event" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText(/Live jazz on the rooftop/)).toHaveTextContent('<script>plain text</script>')
    expect(document.querySelector('script')).toBeNull()
  })

  it('lets visitors retry a failed description request', () => {
    query.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch })
    render(<EventDescription eventId="first-event" />)
    expect(screen.getByText('Description could not load.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Retry description' }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('handles events without a public description', () => {
    query.mockReturnValue({ data: null, isPending: false, isError: false, refetch })
    render(<EventDescription eventId="first-event" />)
    expect(screen.getByText('No description available.')).toBeVisible()
  })

  it('does not retain the previous description while another event loads', () => {
    query.mockReturnValue({ data: { event: { description: 'First event description' } }, isPending: false, isError: false, refetch })
    const view = render(<EventDescription eventId="first-event" />)
    query.mockReturnValue({ data: undefined, isPending: true, isError: false, refetch })
    view.rerender(<EventDescription eventId="second-event" />)
    expect(screen.queryByText('First event description')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading description')
  })
})
