import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { OrganizerLayout } from './OrganizerLayout'

describe('OrganizerLayout', () => {
  it('links an organizer to payment setup without adding a financial dashboard', () => {
    render(
      <MemoryRouter>
        <OrganizerLayout><p>Page content</p></OrganizerLayout>
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Payments' })).toHaveAttribute(
      'href',
      '/organizer/settings/payments',
    )
    expect(screen.queryByText(/payouts|analytics|balance/i)).not.toBeInTheDocument()
  })

  it('shows moderation navigation only after a database staff role is confirmed', () => {
    const view = render(
      <MemoryRouter>
        <OrganizerLayout staffRole={null}><p>Page content</p></OrganizerLayout>
      </MemoryRouter>,
    )
    expect(screen.queryByRole('link', { name: 'Moderation' })).not.toBeInTheDocument()

    view.rerender(
      <MemoryRouter>
        <OrganizerLayout staffRole="moderator"><p>Page content</p></OrganizerLayout>
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Moderation' })).toHaveAttribute('href', '/moderation')
  })
})
