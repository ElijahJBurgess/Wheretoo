import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { testContext, testEvent } from '../event-changes/eventChanges.fixtures'
import type { EventChangeContext } from '../event-changes/eventChanges.schemas'
const { useContext, publish, reload, refetch, useOrganizer, organizerRefetch, useTiers, tiersRefetch, useConnect, connectRefetch } = vi.hoisted(() => ({ useContext: vi.fn(), publish: vi.fn(), reload: vi.fn(), refetch: vi.fn(), useOrganizer: vi.fn(), organizerRefetch: vi.fn(), useTiers: vi.fn(), tiersRefetch: vi.fn(), useConnect: vi.fn(), connectRefetch: vi.fn() }))
vi.mock('../auth/SessionProvider', () => ({ useSession: () => ({ status: 'authenticated', user: { id: 'organizer-1' } }) }))
vi.mock('../organizers/organizer.queries', () => ({ useOrganizer }))
vi.mock('../event-changes/eventChanges.queries', () => ({ useEventChangeContext: useContext }))
vi.mock('../event-changes/eventChanges.api', async importOriginal => ({ ...await importOriginal<typeof import('../event-changes/eventChanges.api')>(), publishIfCurrent: publish, getEventChangeContext: reload }))
vi.mock('../tickets/ticket.queries', () => ({ useOwnedTicketTiers: useTiers, ticketKeys: {} }))
vi.mock('../payments/payment.queries', () => ({ useConnectStatus: useConnect }))
vi.mock('../../lib/supabase/client', () => ({ supabase: {} }))
import { EventPreviewPage } from './EventPreviewPage'
import { EventChangeError } from '../event-changes/eventChanges.api'
let current: EventChangeContext
function renderPreview(path = '/organizer/events/event-1/preview') {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
 const router = createMemoryRouter([
  { path: '/organizer/events/:eventId/preview', element: <EventPreviewPage /> }, { path: '/organizer/events/:eventId/edit', element: <p>edit destination</p> },
  { path: '/organizer/events/:eventId/tickets', element: <p>ticket setup destination</p> }, { path: '/organizer/events/:eventId', element: <p>published destination</p> },
 ], { initialEntries: [path] })
 return { router, client, ...render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>) }
}
beforeEach(() => {
 vi.clearAllMocks(); current = testContext(); current.requirements.needsAcceptance = false
 useContext.mockImplementation(() => ({ data: current, isPending: false, isError: false, isFetching: false, refetch }))
 useOrganizer.mockReturnValue({ data: { id: 'organizer-1', display_name: 'Bay City Arts' }, isPending: false, isError: false, refetch: organizerRefetch })
 useTiers.mockReturnValue({ data: [], isPending: false, isError: false, refetch: tiersRefetch })
 useConnect.mockReturnValue({ data: { status: 'ready' }, isPending: false, isError: false, refetch: connectRefetch })
 tiersRefetch.mockResolvedValue({ data: [], isError: false })
 connectRefetch.mockResolvedValue({ data: { status: 'ready' }, isError: false })
 publish.mockImplementation(async () => ({ ...current, context_token: 'published-token', event: { ...current.event, status: 'published' } }))
 reload.mockImplementation(async () => current)
})
describe('atomic saved preview', () => {
 it('requires deliberate confirmation before invoking the current-context publisher', async () => {
  const user = userEvent.setup(); const { router } = renderPreview()
  await user.click(screen.getByRole('button', { name: 'Publish event' }))
  expect(publish).not.toHaveBeenCalled()
  expect(router.state.location.search).toBe('?mode=confirm')
  expect(screen.getByRole('heading', { name: 'Ready to publish?' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Confirm and publish' }))
  expect(publish).toHaveBeenCalledOnce()
  expect(publish).toHaveBeenCalledWith('event-1', 'organizer-1', 'baseline-token')
 })
 it('renders persisted event, organizer, requirements and policies from one displayed context', () => {
  renderPreview(); expect(screen.getByRole('heading', { name: 'Preview your event' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Saved title' })).toBeInTheDocument(); expect(screen.getByText(/Bay City Arts/)).toBeInTheDocument(); expect(screen.getByText('21+')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Organizer Terms' })).toHaveAttribute('href', '/organizer-terms')
  expect(screen.getByRole('button', { name: 'Publish event' })).toBeEnabled()
 })
 it('does not hydrate stale cached context while the initial atomic read is in flight', () => {
  useContext.mockReturnValue({ data: current, isPending: false, isError: false, isFetching: true, refetch })
  renderPreview(); expect(screen.getByText('Loading your preview')).toBeInTheDocument(); expect(screen.queryByText('Saved title')).not.toBeInTheDocument()
 })
 it('holds publication when the saved context changed after the displayed preview', async () => {
  const user = userEvent.setup(); const view = renderPreview()
  current = { ...current, context_token: 'another-token', event: { ...testEvent, title: 'Another writer' } }
  await act(async () => view.router.navigate('/organizer/events/event-1/preview?refresh'))
  expect(screen.getByRole('heading', { name: 'Saved title' })).toBeInTheDocument(); expect(screen.queryByText('Another writer')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Publish event' }))
  await user.click(screen.getByRole('button', { name: 'Confirm and publish' }))
  expect(publish).not.toHaveBeenCalled()
  expect(await screen.findByText('Saved event details changed. Review the updated preview before publishing.')).toBeInTheDocument()
 })
 it('keeps publish disabled until the current saved agreement is accepted', () => {
  current.requirements.needsAcceptance = true; renderPreview()
  expect(screen.getByRole('button', { name: 'Publish event' })).toBeDisabled(); expect(screen.getByText('Agreement required before publishing.')).toBeInTheDocument()
 })
 it('renders retryable atomic context and organizer failures', async () => {
  useContext.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch })
  const first = renderPreview(); await userEvent.click(screen.getByRole('button', { name: 'Try again' })); expect(refetch).toHaveBeenCalledOnce(); first.unmount()
  useContext.mockReturnValue({ data: current, isPending: false, isError: false, refetch })
  useOrganizer.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: organizerRefetch })
  renderPreview(); await userEvent.click(screen.getByRole('button', { name: 'Try again' })); expect(organizerRefetch).toHaveBeenCalledOnce()
 })
 it('waits for saved organizer identity before loading its profile', () => {
  useContext.mockReturnValue({ data: undefined, isPending: true, isError: false, refetch }); renderPreview()
  expect(useOrganizer).toHaveBeenCalledWith(''); expect(screen.getByText('Loading your preview')).toBeInTheDocument()
 })
 it('routes an untiered paid draft to setup and waits for failed tier reads', async () => {
  current.event.admission_type = 'paid'; const first = renderPreview()
  expect(screen.getByRole('link', { name: 'Set up paid tickets' })).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Publish event' })).not.toBeInTheDocument(); first.unmount()
  useTiers.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: tiersRefetch }); renderPreview()
  expect(screen.getByText('Ticket setup could not load')).toBeInTheDocument(); await userEvent.click(screen.getByRole('button', { name: 'Try again' })); expect(tiersRefetch).toHaveBeenCalledOnce()
 })
 it('publishes a paid draft only after its tiers are configured', async () => {
  current.event.admission_type = 'paid'; useTiers.mockReturnValue({ data: [{ id: 'tier-1', event_id: 'event-1', status: 'draft', name: 'General', description: null, currency: 'usd', unit_amount_minor: 1000, quantity_total: 20 }], isPending: false, isError: false, refetch: tiersRefetch }); tiersRefetch.mockResolvedValue({ data: useTiers().data, isError: false }); const { router } = renderPreview()
  await userEvent.click(screen.getByRole('button', { name: 'Publish event' })); await userEvent.click(screen.getByRole('button', { name: 'Confirm and publish' })); await waitFor(() => expect(router.state.location.pathname).toBe('/organizer/events/event-1'))
  expect(publish).toHaveBeenCalledWith('event-1', 'organizer-1', 'baseline-token')
 })
 it('attaches the same saved event to the Stripe handoff without publishing', async () => {
  current.event.admission_type = 'paid'
  const tiers = [{ id: 'tier-1', event_id: 'event-1', status: 'draft', name: 'General', description: null, currency: 'usd', unit_amount_minor: 1000, quantity_total: 20 }]
  useTiers.mockReturnValue({ data: tiers, isPending: false, isError: false, refetch: tiersRefetch })
  tiersRefetch.mockResolvedValue({ data: tiers, isError: false })
  useConnect.mockReturnValue({ data: { status: 'action_required' }, isPending: false, isError: false, refetch: connectRefetch })
  connectRefetch.mockResolvedValue({ data: { status: 'action_required' }, isError: false })
  renderPreview()
  await userEvent.click(screen.getByRole('button', { name: 'Publish event' }))
  await userEvent.click(screen.getByRole('button', { name: 'Confirm and publish' }))
  expect(await screen.findByRole('link', { name: 'Set up Stripe' })).toHaveAttribute('href', '/organizer/settings/payments?eventId=event-1')
  expect(publish).not.toHaveBeenCalled()
 })
 it('dismisses the Stripe-required prompt back to the same saved preview and rechecks readiness on another deliberate confirmation', async () => {
  current.event.admission_type = 'paid'
  const tiers = [{ id: 'tier-1', event_id: 'event-1', status: 'draft', name: 'General', description: null, currency: 'usd', unit_amount_minor: 1000, quantity_total: 20 }]
  useTiers.mockReturnValue({ data: tiers, isPending: false, isError: false, refetch: tiersRefetch })
  tiersRefetch.mockResolvedValue({ data: tiers, isError: false })
  connectRefetch.mockResolvedValue({ data: { status: 'action_required' }, isError: false })
  const user = userEvent.setup(); const { router } = renderPreview()

  await user.click(screen.getByRole('button', { name: 'Publish event' }))
  await user.click(screen.getByRole('button', { name: 'Confirm and publish' }))
  expect(await screen.findByRole('heading', { name: 'Set up payments to publish' })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Back' }))
  expect(await screen.findByRole('heading', { name: 'Preview your event' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Saved title' })).toBeInTheDocument()
  expect(router.state.location).toMatchObject({ pathname: '/organizer/events/event-1/preview', search: '' })
  expect(publish).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: 'Publish event' }))
  expect(screen.getByRole('heading', { name: 'Ready to publish?' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Confirm and publish' }))
  expect(await screen.findByRole('heading', { name: 'Set up payments to publish' })).toBeInTheDocument()
  expect(connectRefetch).toHaveBeenCalledTimes(2)

  await act(async () => router.navigate(-1))
  expect(await screen.findByRole('heading', { name: 'Preview your event' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Publish event' }))
  expect(screen.getByRole('heading', { name: 'Ready to publish?' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Confirm and publish' }))
  expect(await screen.findByRole('heading', { name: 'Set up payments to publish' })).toBeInTheDocument()
  expect(connectRefetch).toHaveBeenCalledTimes(3)
  expect(publish).not.toHaveBeenCalled()
 })
 it('does not restore an old Stripe prompt across an A to B to A route lifetime', async () => {
  const paidTiers = [{ id: 'tier-1', event_id: 'event-1', status: 'draft', name: 'General', description: null, currency: 'usd', unit_amount_minor: 1000, quantity_total: 20 }]
  useContext.mockImplementation((requestedEventId: string) => {
   const requested = requestedEventId === 'event-1'
    ? { ...current, event_id: 'event-1', event: { ...current.event, id: 'event-1', admission_type: 'paid', title: 'Event A' } }
    : { ...current, event_id: 'event-2', event: { ...current.event, id: 'event-2', admission_type: 'free', title: 'Event B' } }
   return { data: requested, isPending: false, isError: false, isFetching: false, refetch }
  })
  useTiers.mockImplementation((_organizerId: string, requestedEventId: string) => ({ data: requestedEventId === 'event-1' ? paidTiers : [], isPending: false, isError: false, refetch: tiersRefetch }))
  tiersRefetch.mockResolvedValue({ data: paidTiers, isError: false })
  connectRefetch.mockResolvedValue({ data: { status: 'action_required' }, isError: false })
  const user = userEvent.setup(); const { router } = renderPreview()

  await user.click(screen.getByRole('button', { name: 'Publish event' }))
  await user.click(screen.getByRole('button', { name: 'Confirm and publish' }))
  expect(await screen.findByRole('heading', { name: 'Set up payments to publish' })).toBeInTheDocument()
  await act(async () => router.navigate('/organizer/events/event-2/preview?mode=confirm'))
  expect(await screen.findByRole('heading', { name: 'Event B' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Set up payments to publish' })).not.toBeInTheDocument()
  await act(async () => router.navigate('/organizer/events/event-1/preview?mode=confirm'))
  expect(await screen.findByRole('heading', { name: 'Event A' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Confirm and publish' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Set up payments to publish' })).not.toBeInTheDocument()
  expect(publish).not.toHaveBeenCalled()
 })
 it('loads active owner tiers for a published paid ticket-selection preview', async () => {
  current.event = { ...current.event, status: 'published', admission_type: 'paid' }
  useTiers.mockReturnValue({
   data: [
    { id: 'active-tier', event_id: 'event-1', status: 'active', name: 'Balcony', description: 'Upper level', currency: 'usd', unit_amount_minor: 2500, quantity_total: 40 },
    { id: 'archived-tier', event_id: 'event-1', status: 'archived', name: 'Retired', description: null, currency: 'usd', unit_amount_minor: 500, quantity_total: 10 },
   ],
   isPending: false, isError: false, refetch: tiersRefetch,
  })
  renderPreview()

  expect(useTiers).toHaveBeenCalledWith('organizer-1', 'event-1')
  await userEvent.click(screen.getByRole('button', { name: 'Ticket Selection' }))
  expect(screen.getByRole('heading', { name: 'Balcony' })).toBeInTheDocument()
  expect(screen.getByText('$25.00')).toBeInTheDocument()
  expect(screen.getByText('40 tickets configured')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Retired' })).not.toBeInTheDocument()
 })
 it('shows truthful loading and retryable error states for published paid tiers', async () => {
  current.event = { ...current.event, status: 'published', admission_type: 'paid' }
  useTiers.mockReturnValue({ data: undefined, isPending: true, isError: false, fetchStatus: 'fetching', refetch: tiersRefetch })
  const loading = renderPreview(); expect(screen.getByText('Loading ticket setup')).toBeInTheDocument(); loading.unmount()
  useTiers.mockReturnValue({ data: undefined, isPending: false, isError: true, fetchStatus: 'idle', refetch: tiersRefetch })
  renderPreview(); expect(screen.getByText('Ticket setup could not load')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(tiersRefetch).toHaveBeenCalledOnce()
 })
 it('keeps paid-tier and Connect readers disabled for a free preview', () => {
  current.event.admission_type = 'free'
  renderPreview()
  expect(useTiers).toHaveBeenCalledWith('organizer-1', '')
  expect(useConnect).toHaveBeenCalledWith('', { fresh: true })
  expect(tiersRefetch).not.toHaveBeenCalled()
  expect(connectRefetch).not.toHaveBeenCalled()
 })
 it.each(['blocked', 'removed', 'under_review'] as const)('preserves returned %s enforcement and removes stale public cache', async moderation_status => {
  current.event.status = 'published'; current.event.moderation_status = moderation_status
  const { client, router } = renderPreview(); client.setQueryData(['public-event', 'event-1'], { id: 'stale' })
  await userEvent.click(screen.getByRole('button', { name: 'Publish changes' })); await waitFor(() => expect(router.state.location.pathname).toBe('/organizer/events/event-1'))
  expect(client.getQueryData(['events', 'detail', 'organizer-1', 'event-1'])).toMatchObject({ moderation_status })
 })
 it('allows a happening-now paid published revision to republish', async () => {
  current.event = { ...current.event, status: 'published', admission_type: 'paid', starts_at: new Date(Date.now() - 3600000).toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString() }
  renderPreview(); await userEvent.click(screen.getByRole('button', { name: 'Publish changes' })); expect(publish).toHaveBeenCalledOnce()
 })
 it('guards rapid duplicate publication and navigates only after verified success', async () => {
  let resolve!: (value: EventChangeContext) => void; publish.mockReturnValue(new Promise<EventChangeContext>(done => { resolve = done }))
  const user = userEvent.setup(); const { router } = renderPreview(); await user.click(screen.getByRole('button', { name: 'Publish event' })); await user.dblClick(screen.getByRole('button', { name: 'Confirm and publish' }))
  expect(publish).toHaveBeenCalledOnce(); expect(screen.getByRole('button', { name: 'Publishing…' })).toBeDisabled(); expect(router.state.location.pathname).toContain('/preview')
  await act(async () => resolve({ ...current, event: { ...current.event, status: 'published' } })); expect(router.state.location.pathname).toBe('/organizer/events/event-1')
 })
 it('drops a late publication result after an A to B to A event switch', async () => {
  let resolvePublish!: (value: EventChangeContext) => void
  publish.mockReturnValue(new Promise<EventChangeContext>((resolve) => { resolvePublish = resolve }))
  useContext.mockImplementation((requestedEventId: string) => {
   const requested = requestedEventId === 'event-1'
    ? current
    : { ...current, event_id: requestedEventId, event: { ...current.event, id: requestedEventId } }
   return { data: requested, isPending: false, isError: false, isFetching: false, refetch }
  })
  const user = userEvent.setup(); const { router } = renderPreview()
  await user.click(screen.getByRole('button', { name: 'Publish event' }))
  await user.click(screen.getByRole('button', { name: 'Confirm and publish' }))
  await act(async () => router.navigate('/organizer/events/event-2/preview'))
  await act(async () => router.navigate('/organizer/events/event-1/preview'))
  await act(async () => resolvePublish({ ...current, context_token: 'published-token', event: { ...current.event, status: 'published' } }))
  expect(router.state.location.pathname).toBe('/organizer/events/event-1/preview')
 })
 it.each(['conflict', 'unknown'] as const)('retains preview and requires fresh review after %s', async kind => {
  publish.mockRejectedValue(new EventChangeError(kind)); const user = userEvent.setup(); renderPreview()
  await user.click(screen.getByRole('button', { name: 'Publish event' })); await user.click(screen.getByRole('button', { name: 'Confirm and publish' })); expect(screen.getByRole('heading', { name: 'Saved title' })).toBeInTheDocument()
  if (kind === 'conflict') {
   expect(screen.getByRole('button', { name: 'Try publishing again' })).toBeDisabled()
   current = { ...current, context_token: 'fresh-token', event: { ...current.event, title: 'Refreshed version' } }
   await user.click(screen.getByRole('button', { name: 'Reload and review saved event' })); expect(screen.getByRole('heading', { name: 'Refreshed version' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Confirm and publish' })).toBeEnabled()
  } else {
   expect(screen.getByText('Publication was not completed. Review the saved event before trying again.')).toBeInTheDocument()
   expect(screen.getByRole('button', { name: 'Try publishing again' })).toBeEnabled()
   expect(publish).toHaveBeenCalledOnce()
  }
 })
 it.each([{ id: 'wrong-event', status: 'published' }, { organizer_id: 'wrong-owner', status: 'published' }, { status: 'draft' }])('rejects unverified publication response %o', async invalid => {
  publish.mockResolvedValue({ ...current, event: { ...current.event, ...invalid } }); const { router } = renderPreview()
  await userEvent.click(screen.getByRole('button', { name: 'Publish event' })); await userEvent.click(screen.getByRole('button', { name: 'Confirm and publish' })); expect(await screen.findByText('Publication was not completed. Review the saved event before trying again.')).toBeInTheDocument(); expect(router.state.location.pathname).toContain('/preview')
  expect(screen.getByRole('button', { name: 'Try publishing again' })).toBeEnabled()
 })
 it('shows a reconciled Stripe readiness error without exposing backend detail', async () => {
  publish.mockRejectedValue({ message: 'CONNECT_NOT_READY', details: 'private account row' })
  const user = userEvent.setup(); renderPreview()
  await user.click(screen.getByRole('button', { name: 'Publish event' }))
  await user.click(screen.getByRole('button', { name: 'Confirm and publish' }))
  expect(await screen.findByText('Complete Stripe setup before publishing paid tickets.')).toBeInTheDocument()
  expect(screen.queryByText(/private account row/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Try publishing again' })).toBeEnabled()
 })
})
