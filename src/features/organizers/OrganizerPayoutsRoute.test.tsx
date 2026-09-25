import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
vi.mock('../payments/OrganizerPaymentsPage', () => ({ OrganizerPaymentsPage: () => <p>Existing payout behavior</p> }))
import { OrganizerPayoutsRoute } from './OrganizerPayoutsRoute'
it('shows Payouts as step 3 only when arriving from setup', () => {
 render(<MemoryRouter initialEntries={[{ pathname: '/organizer/settings/payments', state: { organizerSetup: true } }]}><OrganizerPayoutsRoute /></MemoryRouter>)
 expect(screen.getByText('Payouts').closest('li')).toHaveAttribute('aria-current', 'step')
 expect(screen.getByText('Existing payout behavior')).toBeInTheDocument()
})
it('leaves ordinary Settings visits unchanged', () => {
 render(<MemoryRouter><OrganizerPayoutsRoute /></MemoryRouter>)
 expect(screen.queryByRole('list')).not.toBeInTheDocument()
 expect(screen.getByText('Existing payout behavior')).toBeInTheDocument()
})
