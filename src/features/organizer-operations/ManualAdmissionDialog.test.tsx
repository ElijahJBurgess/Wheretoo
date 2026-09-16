import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
const { redeemTicket, getOrderDetails } = vi.hoisted(() => ({
  redeemTicket: vi.fn(),
  getOrderDetails: vi.fn(),
}))
vi.mock('./operations.api', () => ({ redeemTicket, getOrderDetails }))
vi.mock('./freeOperations.api', () => ({ getFreeRegistration: vi.fn() }))
vi.mock('../events/event.api', () => ({ getOwnedEvent: vi.fn() }))
vi.mock('./operations.queries', () => ({ operationsKeys: { event: (ownerId: string, eventId: string) => ['organizer-operations', ownerId, eventId] } }))
import { ManualAdmissionDialog } from './ManualAdmissionDialog'
const close = vi.fn()
function show(client = new QueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <ManualAdmissionDialog
        ownerId='owner'
        eventId='event'
        orderId='order'
        orderNumber='WT-2'
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

it('rechecks after a lost response and shows original used history without another admission', async () => {
  redeemTicket.mockRejectedValue(new Error())
  getOrderDetails.mockResolvedValue({
    buyerName: 'Alex Chen',
    tickets: [{
      id: 'ticket',
      status: 'used',
      usedAt: '2026-01-01T00:00:00Z',
      admissionLabel: 'VIP',
    }],
    admissionEligible: true,
  })
  show()
  await userEvent.click(screen.getByRole('button', { name: 'Admit guest' }))
  expect(await screen.findByRole('button', { name: 'Recheck ticket status' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Admit guest' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Recheck ticket status' }))
  expect(await screen.findByText('Already used')).toBeVisible()
  expect(redeemTicket).toHaveBeenCalledTimes(1)
})
it('keeps an uncertain outcome while the recovery read also fails', async () => {
  redeemTicket.mockRejectedValue(new Error())
  getOrderDetails.mockRejectedValue(new Error())
  show()
  await userEvent.click(screen.getByRole('button', { name: 'Admit guest' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Recheck ticket status' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('not confirmed')
  expect(redeemTicket).toHaveBeenCalledTimes(1)
})
it('suppresses repeated confirmation while one operation is pending', async () => {
  redeemTicket.mockReturnValue(new Promise(() => {}))
  show()
  await userEvent.dblClick(screen.getByRole('button', { name: 'Admit guest' }))
  expect(redeemTicket).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled()
})
it('permits only an explicit same-ticket retry after a successful valid recheck', async () => {
  redeemTicket.mockRejectedValueOnce(new Error()).mockResolvedValueOnce({
    outcome: 'admitted',
    buyerName: 'Alex Chen',
    admissionLabel: 'VIP',
    usedAt: '2026-01-01T00:00:00Z',
  })
  getOrderDetails.mockResolvedValue({
    buyerName: 'Alex Chen',
    tickets: [{ id: 'ticket', status: 'valid' }],
    admissionEligible: true,
  })
  show()
  await userEvent.click(screen.getByRole('button', { name: 'Admit guest' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Recheck ticket status' }))
  expect(redeemTicket).toHaveBeenCalledTimes(1)
  await userEvent.click(await screen.findByRole('button', { name: 'Admit guest' }))
  expect(await screen.findByText('Admitted')).toBeVisible()
  expect(redeemTicket.mock.calls.map((args) => args.slice(0, 2))).toEqual([['event', 'ticket'], [
    'event',
    'ticket',
  ]])
})

it('requires a successful recheck after dismissing and reopening an uncertain ticket', async () => {
  const client = new QueryClient()
  redeemTicket.mockRejectedValue(new Error())
  getOrderDetails.mockRejectedValue(new Error())
  const first = show(client)
  await userEvent.click(screen.getByRole('button', { name: 'Admit guest' }))
  await screen.findByRole('button', { name: 'Recheck ticket status' })
  first.unmount()
  show(client)
  expect(screen.queryByRole('button', { name: 'Admit guest' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Recheck ticket status' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('not confirmed')
  expect(redeemTicket).toHaveBeenCalledTimes(1)
})
