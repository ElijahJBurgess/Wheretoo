import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const { useSummary } = vi.hoisted(() => ({ useSummary: vi.fn() }))
vi.mock('./eventChanges.queries', () => ({ useCancellationSummary: useSummary }))
import { CancellationSummary } from './CancellationSummary'
const paid = { currency: 'usd', receivedOrders: 5, unpaidAttempts: 2, completedOrders: 1, notConfirmedRefundedOrders: 4, eligibleOrders: 2, eligibleAmountMinor: 4400, processingOrders: 1, actionRequiredOrders: 1, unknownOrders: 0, failedOrders: 0, reviewOrders: 1 }
const summary = { eventId: 'event-1', eventStatus: 'cancelled', admissionType: 'paid', complete: true, asOf: '2026-09-12T12:00:00Z', tickets: { issued: 6, cancelledUnused: 3, used: 2, refunded: 1, other: 0 }, paid, free: null }
function mount() { render(<MemoryRouter><CancellationSummary eventId="event-1" ownerId="owner-1" /></MemoryRouter>) }
beforeEach(() => { useSummary.mockReturnValue({ data: summary, isError: false, isPending: false, refetch: vi.fn() }) })
it('separates current admissions, used history, and per-order refund handoff without bulk authority', () => {
 mount(); expect(screen.getByText('Unused now cancelled').nextElementSibling).toHaveTextContent('3'); expect(screen.getByText('Used — history retained').nextElementSibling).toHaveTextContent('2')
 expect(screen.getByText('Eligible amount').nextElementSibling).toHaveTextContent('$44'); expect(screen.getByRole('link', { name: 'Review orders and refunds' })).toHaveAttribute('href', '/organizer/events/event-1/orders')
 expect(screen.queryByRole('button', { name: /refund all/i })).not.toBeInTheDocument()
})
it('does not present incomplete counts as zero or reliable totals', () => {
 useSummary.mockReturnValue({ data: { ...summary, complete: false, tickets: null, paid: null }, refetch: vi.fn() }); mount()
 expect(screen.getByText('Complete summary unavailable. Partial counts are not shown as totals.')).toBeInTheDocument(); expect(screen.getByText('Payment summary unavailable')).toBeInTheDocument(); expect(screen.queryByText('0')).not.toBeInTheDocument()
})
it('keeps free registration management real and financial sections not applicable', () => {
 useSummary.mockReturnValue({ data: { ...summary, admissionType: 'free', paid: null, free: { registrations: 2, admissions: 6, cancelledRegistrations: 2 } }, refetch: vi.fn() }); mount()
 expect(screen.getByText('Payments and refunds: Not applicable to free registrations.')).toBeInTheDocument(); expect(screen.getByRole('link', { name: 'Manage registrations' })).toHaveAttribute('href', '/organizer/events/event-1/registrations')
 expect(screen.queryByText('Eligible amount')).not.toBeInTheDocument()
})
