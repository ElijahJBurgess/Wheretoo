import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { RefundOrderPanel } from './RefundOrderPanel'
import { refundKeys } from './refunds.queries'
import { RefundAccessError } from './refunds.api'
import { refundFixture } from './refunds.fixtures'
const { status, request, notice } = vi.hoisted(() => ({ status: vi.fn(), request: vi.fn(), notice: vi.fn() }))
vi.mock('./refunds.api', async original => ({ ...await original<typeof import('./refunds.api')>(), getRefundStatus: status, requestRefund: request, getRefundNotice: notice }))
function show(ownerId = 'owner') {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
 const view = render(<QueryClientProvider client={client}><RefundOrderPanel ownerId={ownerId} eventId={refundFixture.eventId} orderId={refundFixture.orderId} /></QueryClientProvider>)
 return { client, ...view }
}
beforeEach(() => { vi.resetAllMocks(); status.mockResolvedValue(refundFixture); notice.mockResolvedValue({ state: 'queued', observation: null }) })
it('confirms actual whole order context and cancellation never submits', async () => {
 show(); const trigger = await screen.findByRole('button', { name: 'Refund order' }); trigger.focus(); fireEvent.click(trigger)
 expect(screen.getByRole('dialog')).toHaveTextContent('Synthetic Rooftop')
 expect(screen.getByRole('dialog')).toHaveTextContent('guest@example.invalid')
 expect(screen.getByRole('dialog')).toHaveTextContent('$70')
 expect(screen.getByRole('dialog')).toHaveTextContent('Used')
 fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(request).not.toHaveBeenCalled()
 expect(screen.getByRole('button', { name: 'Refund order' })).toHaveFocus()
})
it('never promotes an acknowledgment to completion or allows duplicate submission', async () => {
 let finish!: (value: { outcome: string }) => void
 request.mockImplementation(() => new Promise(resolve => { finish = resolve }))
 const { client } = show(); fireEvent.click(await screen.findByRole('button', { name: 'Refund order' }))
 fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }))
 expect(await screen.findByRole('button', { name: 'Submitting refund…' })).toBeDisabled()
 expect(screen.getByRole('button', { name: 'Resend tickets' })).toBeDisabled()
 status.mockResolvedValue({ ...refundFixture, state: 'processing', action: 'none' })
 await act(async () => finish({ outcome: 'completed' }))
 expect(await screen.findAllByText('Refund processing')).not.toHaveLength(0)
 expect(screen.queryByText('Refund complete')).not.toBeInTheDocument()
 expect(request).toHaveBeenCalledTimes(1)
 const completed = { ...refundFixture, state: 'completed', action: 'none', completedAt: '2026-09-11T00:00:00Z' }
 await act(async () => { client.setQueryData(refundKeys.status('owner', refundFixture.eventId, refundFixture.orderId), completed) })
 expect(await screen.findAllByText('Refund complete')).not.toHaveLength(0)
 expect(screen.getByRole('button', { name: 'Resend tickets' })).toBeDisabled()
 client.clear()
})
it.each([
 ['submitting', 'none', 'Submitting refund'], ['processing', 'none', 'Refund processing'],
 ['review', 'none', 'Refund needs review'], ['failed', 'none', 'Refund failed'],
 ['unknown', 'reconcile', 'Refund outcome unknown'], ['ineligible', 'none', 'Refund unavailable'],
 ['completed', 'none', 'Refund complete'],
])('renders %s safely with no new refund action', async (state, action, heading) => {
 status.mockResolvedValue({ ...refundFixture, state, action }); show()
 expect(await screen.findByText(heading)).toBeVisible()
 expect(screen.queryByRole('button', { name: 'Refund order' })).not.toBeInTheDocument()
 expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
 expect(screen.getByRole('button', { name: 'Resend tickets' })).toBeDisabled()
})
it('reconciles only the existing operation and cannot submit after an ambiguous failure', async () => {
 status.mockResolvedValue({ ...refundFixture, state: 'unknown', action: 'reconcile' }); request.mockResolvedValue({ outcome: 'unknown' })
 show(); fireEvent.click(await screen.findByRole('button', { name: 'Check existing refund' }))
 await waitFor(() => expect(request).toHaveBeenCalledWith(refundFixture.eventId, refundFixture.orderId, 'reconcile'))
 expect(screen.queryByRole('button', { name: 'Refund order' })).not.toBeInTheDocument()
})
it('hides cached financial context and actions after authorization fails', async () => {
 const { client } = show(); await screen.findByRole('button', { name: 'Refund order' })
 fireEvent.click(screen.getByRole('button', { name: 'Refund order' }))
 status.mockRejectedValue(new RefundAccessError(true))
 await act(async () => { await client.invalidateQueries({ queryKey: refundKeys.status('owner', refundFixture.eventId, refundFixture.orderId) }) })
 expect(await screen.findByText('Refund access unavailable')).toBeVisible()
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
 expect(screen.queryByText('guest@example.invalid')).not.toBeInTheDocument()
 expect(screen.queryByRole('button', { name: /refresh|check existing/i })).not.toBeInTheDocument()
 client.clear()
})
it('labels already-refunded only after the canonical completed read and keeps email failure independent', async () => {
 request.mockResolvedValue({ outcome: 'already_refunded' })
 notice.mockResolvedValue({ state: 'failed', observation: 'bounced' })
 show(); fireEvent.click(await screen.findByRole('button', { name: 'Refund order' }))
 status.mockResolvedValue({ ...refundFixture, state: 'completed', action: 'none', completedAt: '2026-09-11T00:00:00Z' })
 fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }))
 expect((await screen.findAllByText('Already refunded'))[0]).toBeVisible()
 expect(await screen.findByText(/Refund email could not be delivered/)).toBeVisible()
 expect(screen.queryByRole('button', { name: 'Refund order' })).not.toBeInTheDocument()
})
it('never reuses another organizer identity’s cached refund view', async () => {
 const { client, rerender } = show(); await screen.findByRole('button', { name: 'Refund order' })
 status.mockImplementation(() => new Promise(() => {}))
 rerender(<QueryClientProvider client={client}><RefundOrderPanel ownerId='other-owner' eventId={refundFixture.eventId} orderId={refundFixture.orderId} /></QueryClientProvider>)
 expect(screen.getByText('Checking refund status…')).toBeVisible()
 expect(screen.queryByRole('button', { name: 'Refund order' })).not.toBeInTheDocument()
 client.clear()
})
it('opens long confirmation at the warning rather than autofocus scrolling to the action buttons', async () => {
 show(); const trigger = await screen.findByRole('button', { name: 'Refund order' }); trigger.focus(); fireEvent.click(trigger)
 expect(screen.getByText(/^This refunds the full order\./)).toHaveFocus()
 fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
 expect(trigger).toHaveFocus()
})
it('does not show failed-refund instructions in the completed refund state', async () => {
 status.mockResolvedValue({ ...refundFixture, state: 'completed', action: 'none' }); show()
 await screen.findByText('Refund complete')
 expect(screen.queryByText(/Failed refunds need support/)).not.toBeInTheDocument()
})
