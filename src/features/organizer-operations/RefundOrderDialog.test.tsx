import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
const { refundOrder, getOrder } = vi.hoisted(() => ({ refundOrder: vi.fn(), getOrder: vi.fn() }))
vi.mock('./operations.api', () => ({ refundOrder, getOrder }))
import { RefundOrderDialog } from './RefundOrderDialog'
const close = vi.fn()
function show() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RefundOrderDialog
        ownerId='owner'
        eventId='event'
        orderId='order'
        orderNumber='WT-123'
        totalMinor={7500}
        quantity={3}
        onClose={close}
      />
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  vi.resetAllMocks()
})
it('names full amount and all tickets; cancel never sends', async () => {
  show()
  expect(screen.getByRole('dialog')).toHaveTextContent('$75')
  expect(screen.getByRole('dialog')).toHaveTextContent('3 tickets')
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(refundOrder).not.toHaveBeenCalled()
})
it('acknowledgement remains pending until canonical read confirms', async () => {
  refundOrder.mockResolvedValue({ outcome: 'pending' })
  getOrder.mockResolvedValue({ status: 'paid' })
  show()
  await userEvent.click(screen.getByRole('button', { name: 'Refund entire order' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Refund pending')
  expect(screen.queryByText('Refund confirmed')).not.toBeInTheDocument()
  expect(refundOrder).toHaveBeenCalledTimes(1)
})
it('only a canonical reread confirms completion', async () => {
  refundOrder.mockResolvedValue({ outcome: 'pending' })
  getOrder.mockResolvedValue({ status: 'refunded', refundState: 'refunded' })
  show()
  await userEvent.click(screen.getByRole('button', { name: 'Refund entire order' }))
  expect(await screen.findByText('Refund confirmed')).toBeVisible()
})
it('timeout leaves the outcome unconfirmed', async () => {
  refundOrder.mockRejectedValue(new Error())
  show()
  await userEvent.click(screen.getByRole('button', { name: 'Refund entire order' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Refund not confirmed')
})
it('canonical completion overrides a timed-out request and prevents resubmission', async () => {
  refundOrder.mockRejectedValue(new Error('timeout'))
  getOrder.mockResolvedValue({ status: 'refunded', refundState: 'refunded' })
  show()
  await userEvent.click(screen.getByRole('button', { name: 'Refund entire order' }))
  expect(await screen.findByText('Refund confirmed')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Refund entire order' })).not.toBeInTheDocument()
  expect(screen.queryByText(/Refund not confirmed/)).not.toBeInTheDocument()
})
