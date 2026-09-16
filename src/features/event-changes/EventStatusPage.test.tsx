import './testEnvMock'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { testContext } from './eventChanges.fixtures'
import type { EventStatusAccess } from './eventStatus.schemas'
const { read, shorten, clear, getStatus, privacy } = vi.hoisted(() => ({ read: vi.fn(), shorten: vi.fn(), clear: vi.fn(), getStatus: vi.fn(), privacy: vi.fn() }))
vi.mock('./eventStatus.session', () => ({ readEventStatusGrant: read, shortenEventStatusGrant: shorten, clearEventStatusGrant: clear }))
vi.mock('./eventStatus.public-api', async importOriginal => ({ ...await importOriginal<typeof import('./eventStatus.public-api')>(), getEventStatus: getStatus }))
vi.mock('../ticket-experience/customer/useTicketDocumentPrivacy', () => ({ useTicketDocumentPrivacy: privacy }))
import { EventStatusPage } from './EventStatusPage'
import { EventStatusError } from './eventStatus.public-api'
const token = 'em1_' + 'a'.repeat(42) + 'A'
function value(): EventStatusAccess { return { kind: 'ready', purpose: 'event_cancellation', expiresAt: new Date(Date.now() + 3600000).toISOString(), detail: { sourceKind: 'paid_order', eventStatus: 'cancelled', facts: testContext().current_saved.facts, quantity: 2, orderNumber: 'A123', financialState: 'eligible', totalMinor: 4000, tickets: [ { id: '11111111-1111-4111-8111-111111111111', admissionLabel: 'General Admission', status: 'used', usedAt: '2026-09-12T17:30:00Z' }, { id: '22222222-2222-4222-8222-222222222222', admissionLabel: 'General Admission', status: 'cancelled', usedAt: null } ], canViewTickets: false } } }
function mount() { return render(<MemoryRouter><EventStatusPage /></MemoryRouter>) }
beforeEach(() => { vi.clearAllMocks(); read.mockReturnValue({ token, expiresAt: Date.now() + 3600000 }); getStatus.mockResolvedValue(value()) })
describe('private buyer event status', () => {
 it('separates cancellation from financial state, preserves used history and has no QR or entry affordance', async () => {
  const { container } = mount(); expect(await screen.findByRole('heading', { name: 'Event cancelled' })).toBeInTheDocument()
  expect(screen.getByText(/No refund is recorded/)).toBeInTheDocument(); expect(screen.getByText(/Used ·/)).toHaveTextContent('2026')
  expect(screen.getByText('Cancelled · Not valid for entry')).toBeInTheDocument(); expect(container.querySelector('svg, canvas, img')).toBeNull(); expect(screen.queryByRole('link', { name: 'View your tickets' })).not.toBeInTheDocument()
  expect(privacy).toHaveBeenCalled(); expect(shorten).toHaveBeenCalled()
 })
 it.each(['processing', 'unknown', 'failed', 'review', 'completed'] as const)('renders truthful %s refund status', async financialState => {
  const result = value(); result.detail.financialState = financialState; getStatus.mockResolvedValue(result); mount()
  await screen.findByRole('heading', { name: 'Event cancelled' })
  if (financialState === 'completed') expect(screen.getByText('Your whole-order refund is confirmed.')).toBeInTheDocument()
  else expect(screen.queryByText('Your whole-order refund is confirmed.')).not.toBeInTheDocument()
 })
 it('shows free registrations without financial amounts', async () => {
  const result = value(); result.detail = { ...result.detail, sourceKind: 'free_registration', financialState: 'not_applicable', totalMinor: null, orderNumber: null }; getStatus.mockResolvedValue(result); mount()
  expect(await screen.findByText('This is a free registration. No payment or refund applies.')).toBeInTheDocument(); expect(screen.queryByText(/Total paid:/)).not.toBeInTheDocument()
 })
 it('shows no-ticket late payments as review without inventing admissions', async () => {
  const result = value(); result.detail.financialState = 'review'; result.detail.tickets = []; getStatus.mockResolvedValue(result); mount()
  expect(await screen.findByText('Payment needs review. No tickets were issued and admission is unavailable.')).toBeInTheDocument()
 })
 it('explicitly reports unavailable legacy event facts without a fabricated schedule', async () => {
  const result = value(); result.detail.facts = null; getStatus.mockResolvedValue(result); mount()
  expect(await screen.findByText('Recorded event details unavailable. No previous schedule is assumed.')).toBeInTheDocument(); expect(screen.queryByText('Starts')).not.toBeInTheDocument()
 })
 it('links eligible change notices to the existing same-grant ticket access', async () => {
  const result = value(); result.purpose = 'event_change'; result.detail.eventStatus = 'published'; result.detail.canViewTickets = true; result.detail.tickets[1].status = 'valid'; getStatus.mockResolvedValue(result); mount()
  expect(await screen.findByRole('link', { name: 'View your tickets' })).toHaveAttribute('href', `/ticket-access#${token}`)
 })
 it.each(['unavailable', 'temporary', 'rate_limited'] as const)('provides support on %s failures', async kind => {
  getStatus.mockRejectedValue(new EventStatusError(kind)); mount(); await waitFor(() => expect(screen.queryByText('Loading your event status…')).not.toBeInTheDocument())
  expect(screen.queryByRole('heading', { name: 'Event cancelled' })).not.toBeInTheDocument()
  if (kind === 'unavailable') { expect(clear).toHaveBeenCalled(); expect(screen.getByText('Event status link unavailable')).toBeInTheDocument() }
  else expect(screen.getByRole('button', { name: 'Try this status link again' })).toBeInTheDocument()
 })
})
