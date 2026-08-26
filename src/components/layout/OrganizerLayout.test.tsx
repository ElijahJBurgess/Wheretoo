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
})
