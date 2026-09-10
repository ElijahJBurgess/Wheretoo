import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
const { redeemTicket } = vi.hoisted(() => ({ redeemTicket: vi.fn() }))
vi.mock('./operations.api', () => ({ redeemTicket }))
import { ManualAdmissionDialog } from './ManualAdmissionDialog'
const close = vi.fn()
function show() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ManualAdmissionDialog
        ownerId='owner'
        eventId='event'
        buyerName='Alex Chen'
        eventName='Sunset Rooftop Sessions'
        ticketNumber={2}
        ticket={{
          id: 'ticket',
          admissionLabel: 'VIP',
          status: 'valid',
          usedAt: null,
          issuedAt: '2026-01-01T00:00:00Z',
        }}
        onClose={close}
      />
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  vi.resetAllMocks()
})
it('cancel does not admit and confirmation selects a specific ticket', async () => {
  show()
  expect(screen.getByRole('dialog')).toHaveTextContent('Alex Chen')
  expect(screen.getByRole('dialog')).toHaveTextContent('VIP')
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(redeemTicket).not.toHaveBeenCalled()
})
it('does not report success on network uncertainty', async () => {
  redeemTicket.mockRejectedValue(new Error())
  show()
  await userEvent.click(screen.getByRole('button', { name: 'Admit guest' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Admission not confirmed')
  expect(screen.queryByText('Admitted')).not.toBeInTheDocument()
})
it('shows the authoritative result and timestamp', async () => {
  redeemTicket.mockResolvedValue({ outcome: 'already_used', usedAt: '2026-01-01T00:00:00Z' })
  show()
  await userEvent.click(screen.getByRole('button', { name: 'Admit guest' }))
  expect(await screen.findByText('Already used')).toBeVisible()
  expect(screen.getByText(/Checked in/)).toBeVisible()
})
