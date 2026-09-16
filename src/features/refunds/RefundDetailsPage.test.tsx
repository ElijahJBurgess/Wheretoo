import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, useRoutes } from 'react-router-dom'
import { refundRoutes } from './refundRoutes'
import { detailFixture } from './refunds.fixtures'
import { RefundDetailError } from './refunds.public-api'
const { resolve } = vi.hoisted(() => ({ resolve: vi.fn() }))
vi.mock('./refunds.public-api', async original => ({ ...await original<typeof import('./refunds.public-api')>(), getRefundDetails: resolve }))
const token = 'em1_' + 'A'.repeat(43)
function Routes() { return useRoutes(refundRoutes) }
function show() { return render(<MemoryRouter initialEntries={['/refund-details']}><Routes /></MemoryRouter>) }
beforeEach(() => { vi.resetAllMocks(); sessionStorage.clear(); window.history.replaceState(null, '', '/refund-details#' + token); resolve.mockResolvedValue(detailFixture) })
it('renders immutable financial history and distinct Used/Refunded admissions without admission controls', async () => {
 show(); expect(await screen.findByRole('heading', { name: 'Your order has been refunded' })).toBeVisible()
 expect(screen.getAllByText('Order #WT-TEST')[0]).toBeVisible(); expect(screen.getAllByText('$70').length).toBeGreaterThan(1)
 expect(screen.getByText('Used')).toBeVisible(); expect(screen.getAllByText('Refunded')).toHaveLength(2)
 expect(screen.getByText(/Checked in/)).toBeVisible()
 expect(screen.queryByRole('button', { name: /wallet|qr|resend|check in/i })).not.toBeInTheDocument()
 expect(document.querySelector('canvas, img, [data-qr]')).toBeNull()
 expect(window.location.hash).toBe('')
 expect(screen.queryByRole('link', { name: /find.*ticket/i })).not.toBeInTheDocument()
})
it('expired or unavailable financial grants never fall into current ticket recovery', async () => {
 resolve.mockRejectedValue(new RefundDetailError('unavailable')); show()
 expect(await screen.findByRole('heading', { name: 'Refund link unavailable' })).toBeVisible()
 expect(screen.queryByText('Order #WT-TEST')).not.toBeInTheDocument()
 expect(screen.queryByRole('link', { name: /ticket|recover/i })).not.toBeInTheDocument()
 expect(screen.queryByRole('button', { name: /retry|again/i })).not.toBeInTheDocument()
})
it('temporary access failures retry only this financial grant', async () => {
 resolve.mockRejectedValueOnce(new RefundDetailError('temporary')).mockResolvedValue(detailFixture); show()
 fireEvent.click(await screen.findByRole('button', { name: 'Try this refund link again' }))
 expect((await screen.findAllByText('Order #WT-TEST'))[0]).toBeVisible()
 expect(resolve.mock.calls.map(call => call[0])).toEqual([token, token])
})
it('clears displayed history at grant expiry without waiting for navigation', async () => {
 vi.useFakeTimers(); resolve.mockResolvedValue({ ...detailFixture, expiresAt: new Date(Date.now() + 1000).toISOString() }); show()
 await act(async () => { await Promise.resolve() })
 expect(screen.getAllByText('Order #WT-TEST')[0]).toBeVisible()
 await act(async () => { await vi.advanceTimersByTimeAsync(1001) })
 expect(screen.getByRole('heading', { name: 'Refund link unavailable' })).toBeVisible()
 expect(screen.queryByText('Order #WT-TEST')).not.toBeInTheDocument()
 vi.useRealTimers()
})
