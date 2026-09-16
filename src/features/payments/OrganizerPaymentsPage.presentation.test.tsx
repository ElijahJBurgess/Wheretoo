import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getConnectStatus, createConnectAccountSession, getExpressLoginUrl, useSession } = vi.hoisted(() => ({
  getConnectStatus: vi.fn(), createConnectAccountSession: vi.fn(), getExpressLoginUrl: vi.fn(), useSession: vi.fn(),
}))
vi.mock('../auth/SessionProvider', () => ({ useSession }))
vi.mock('./payment.api', () => ({ getConnectStatus, createConnectAccountSession, getExpressLoginUrl }))
vi.mock('./ConnectEmbeddedPanel', () => ({
  ConnectEmbeddedPanel: ({ onExit, onLoadError, mode }: { onExit: () => void; onLoadError: () => void; mode: string }) => (
    <section aria-label="Stripe payment setup">
      <p>Stripe component: {mode}</p>
      <button onClick={onExit}>Exit embedded setup</button>
      <button onClick={onLoadError}>Report embedded load error</button>
    </section>
  ),
}))

import { OrganizerPaymentsPage } from './OrganizerPaymentsPage'
import type { ConnectStatus } from './payment.types'
import { paymentKeys } from './payment.queries'

const summary = { requirements_currently_due_count: 0, requirements_past_due_count: 0, last_status_code: null, last_synced_at: '2026-09-10T12:00:00.000Z' }
const statusValue = (status: ConnectStatus['status']): ConnectStatus => status === 'not_started' ? { status } : { ...summary, status }

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } } })
  const page = (key = 'organizer-1') => <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={['/organizer/settings/payments']}>
      <Routes>
        <Route path="/organizer/settings/payments" element={<OrganizerPaymentsPage key={key} />} />
        <Route path="/organizer/events" element={<p>events destination</p>} />
        <Route path="/organizer/events/new" element={<p>new event destination</p>} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>
  return { ...render(page()), client, page }
}

async function beginOnboarding(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Set up payouts' }))
  expect(screen.getByRole('heading', { name: 'You’re almost there' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Continue with Stripe' }))
  await screen.findByRole('region', { name: 'Stripe payment setup' })
}

describe('OrganizerPaymentsPage journey', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useSession.mockReturnValue({ status: 'authenticated', session: {}, user: { id: 'organizer-1' } })
    getConnectStatus.mockResolvedValue(statusValue('not_started'))
    createConnectAccountSession.mockResolvedValue({ clientSecret: 'never-render-this-secret', status: statusValue('action_required') })
  })

  it('offers the payouts decision and safely skips into the organizer console', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Secure payouts with Stripe' })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Do this later' }))
    expect(screen.getByText('events destination')).toBeInTheDocument()
    expect(createConnectAccountSession).not.toHaveBeenCalled()
  })

  it('introduces Stripe before opening the existing component without exposing its secret', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Set up payouts' }))
    expect(createConnectAccountSession).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'You’re almost there' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue with Stripe' }))
    expect(await screen.findByText('Stripe component: onboarding')).toBeInTheDocument()
    expect(screen.queryByText('never-render-this-secret')).not.toBeInTheDocument()
    expect(createConnectAccountSession).toHaveBeenCalledOnce()
  })

  it.each([
    ['pending', 'Stripe is reviewing your details', 'Refresh status'],
    ['action_required', 'Action required in Stripe', 'Review with Stripe'],
    ['restricted', 'Payment setup needs an update', 'Review with Stripe'],
    ['ready', 'You’re all set!', 'Manage payment details'],
  ] as const)('renders canonical %s on a fresh visit', async (status, title, action) => {
    getConnectStatus.mockResolvedValue(statusValue(status))
    renderPage()
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: action })).toBeInTheDocument()
    expect(screen.queryByText(/acct_|requirements_due/)).not.toBeInTheDocument()
    if (status !== 'ready') expect(screen.queryByText('Ready to sell tickets')).not.toBeInTheDocument()
  })

  it('refreshes pending status and offers event creation only when the server reports ready', async () => {
    const user = userEvent.setup()
    getConnectStatus.mockResolvedValueOnce(statusValue('pending')).mockResolvedValue(statusValue('ready'))
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Refresh status' }))
    expect(await screen.findByRole('heading', { name: 'You’re all set!' })).toBeInTheDocument()
    expect(screen.getByText('Payments enabled')).toBeInTheDocument()
    expect(screen.getByText('Payouts configured')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Create your first event' }))
    expect(screen.getByText('new event destination')).toBeInTheDocument()
  })

  it.each(['pending', 'action_required', 'restricted', 'ready'] as const)('rechecks on exit and gives canonical %s precedence over interrupted UX', async (status) => {
    const user = userEvent.setup()
    renderPage()
    await beginOnboarding(user)
    getConnectStatus.mockResolvedValue(statusValue(status))
    await user.click(screen.getByRole('button', { name: 'Exit embedded setup' }))
    await waitFor(() => expect(getConnectStatus).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('region', { name: 'Stripe payment setup' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Setup not completed' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'You’re all set!' })).toBe(status === 'ready' ? screen.getByRole('heading', { name: 'You’re all set!' }) : null)
  })

  it('shows an interruption only after a fresh not_started result and rechecks before resuming', async () => {
    const user = userEvent.setup()
    renderPage()
    await beginOnboarding(user)
    await user.click(screen.getByRole('button', { name: 'Exit embedded setup' }))
    const resume = await screen.findByRole('button', { name: 'Continue setup' })
    expect(screen.getByRole('heading', { name: 'Setup not completed' })).toBeInTheDocument()
    expect(resume).toHaveFocus()
    getConnectStatus.mockResolvedValue(statusValue('pending'))
    await user.click(resume)
    expect(await screen.findByRole('heading', { name: 'Stripe is reviewing your details' })).toBeInTheDocument()
    expect(createConnectAccountSession).toHaveBeenCalledOnce()
  })

  it('retries a failed interruption status check before creating another Account Session', async () => {
    const user = userEvent.setup()
    renderPage()
    await beginOnboarding(user)
    await user.click(screen.getByRole('button', { name: 'Exit embedded setup' }))
    getConnectStatus.mockRejectedValue(new Error('network'))
    await user.click(await screen.findByRole('button', { name: 'Continue setup' }))
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    getConnectStatus.mockResolvedValue(statusValue('pending'))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Stripe is reviewing your details' })).toBeInTheDocument()
    expect(createConnectAccountSession).toHaveBeenCalledOnce()
  })

  it('reopens interrupted setup only if the refreshed status is still not_started', async () => {
    const user = userEvent.setup()
    renderPage()
    await beginOnboarding(user)
    await user.click(screen.getByRole('button', { name: 'Exit embedded setup' }))
    await user.click(await screen.findByRole('button', { name: 'Continue setup' }))
    expect(await screen.findByRole('region', { name: 'Stripe payment setup' })).toBeInTheDocument()
    expect(getConnectStatus).toHaveBeenCalledTimes(3)
    expect(createConnectAccountSession).toHaveBeenCalledTimes(2)
  })

  it('renders a retryable status failure without displaying stale ready claims', async () => {
    const user = userEvent.setup()
    getConnectStatus.mockRejectedValue(new Error('private Stripe account details'))
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.queryByText(/private Stripe/)).not.toBeInTheDocument()
    getConnectStatus.mockResolvedValue(statusValue('not_started'))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Secure payouts with Stripe' })).toBeInTheDocument()
    expect(createConnectAccountSession).not.toHaveBeenCalled()
  })

  it('safely retries a failed Account Session and prevents duplicate submissions while pending', async () => {
    const user = userEvent.setup()
    createConnectAccountSession.mockRejectedValueOnce(new Error('private Stripe error'))
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Set up payouts' }))
    await user.click(screen.getByRole('button', { name: 'Continue with Stripe' }))
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.queryByText('private Stripe error')).not.toBeInTheDocument()
    let resolveSession!: (value: unknown) => void
    createConnectAccountSession.mockImplementation(() => new Promise(resolve => { resolveSession = resolve }))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByRole('button', { name: 'Opening secure setup…' })).toBeDisabled()
    await act(async () => resolveSession({ clientSecret: 'secret', status: statusValue('action_required') }))
    expect(await screen.findByRole('region', { name: 'Stripe payment setup' })).toBeInTheDocument()
    expect(createConnectAccountSession).toHaveBeenCalledTimes(2)
  })

  it('unmounts a failed embedded component, focuses retry, and opens a fresh Account Session', async () => {
    const user = userEvent.setup()
    renderPage()
    await beginOnboarding(user)
    await user.click(screen.getByRole('button', { name: 'Report embedded load error' }))
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Stripe payment setup' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('region', { name: 'Stripe payment setup' })).toBeInTheDocument()
    expect(createConnectAccountSession).toHaveBeenCalledTimes(2)
  })

  it('starts a fresh post-exit status request even when an older background request is pending', async () => {
    const user = userEvent.setup()
    const view = renderPage()
    await beginOnboarding(user)
    let resolveBackground!: (value: ConnectStatus) => void
    getConnectStatus.mockImplementationOnce(() => new Promise(resolve => { resolveBackground = resolve }))
    let background!: Promise<unknown>
    act(() => { background = view.client.refetchQueries({ queryKey: paymentKeys.connect('organizer-1') }) })
    await waitFor(() => expect(getConnectStatus).toHaveBeenCalledTimes(2))
    getConnectStatus.mockResolvedValue(statusValue('ready'))
    await user.click(screen.getByRole('button', { name: 'Exit embedded setup' }))
    await waitFor(() => expect(getConnectStatus).toHaveBeenCalledTimes(3))
    expect(await screen.findByRole('heading', { name: 'You’re all set!' })).toBeInTheDocument()
    await act(async () => { resolveBackground(statusValue('pending')); await background })
    expect(screen.getByRole('heading', { name: 'You’re all set!' })).toBeInTheDocument()
  })

  it('never shows success on exit when the status refresh fails', async () => {
    const user = userEvent.setup()
    renderPage()
    await beginOnboarding(user)
    getConnectStatus.mockRejectedValue(new Error('network'))
    await user.click(screen.getByRole('button', { name: 'Exit embedded setup' }))
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'You’re all set!' })).not.toBeInTheDocument()
  })

  it('drops an in-flight Account Session when organizer identity changes', async () => {
    const user = userEvent.setup()
    let resolveSession!: (value: unknown) => void
    createConnectAccountSession.mockImplementation(() => new Promise(resolve => { resolveSession = resolve }))
    const view = renderPage()
    await user.click(await screen.findByRole('button', { name: 'Set up payouts' }))
    await user.click(screen.getByRole('button', { name: 'Continue with Stripe' }))
    useSession.mockReturnValue({ status: 'authenticated', session: {}, user: { id: 'organizer-2' } })
    getConnectStatus.mockResolvedValue(statusValue('ready'))
    view.rerender(view.page())
    await act(async () => resolveSession({ clientSecret: 'previous-organizer-secret', status: statusValue('action_required') }))
    expect(await screen.findByRole('heading', { name: 'You’re all set!' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Stripe payment setup' })).not.toBeInTheDocument()
  })

  it('opens management for a ready account and preserves the existing Express action', async () => {
    const user = userEvent.setup()
    getConnectStatus.mockResolvedValue(statusValue('ready'))
    createConnectAccountSession.mockResolvedValue({ clientSecret: 'secret', status: statusValue('ready') })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Manage payment details' }))
    expect(await screen.findByText('Stripe component: management')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Exit embedded setup' }))
    getExpressLoginUrl.mockRejectedValue(new Error('raw account details'))
    await user.click(await screen.findByRole('button', { name: 'Open Stripe Express' }))
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.queryByText('raw account details')).not.toBeInTheDocument()
  })

  it.each(['sign-out', 'unmount'] as const)('does not redirect a deferred Express URL after %s', async (reason) => {
    const user = userEvent.setup()
    getConnectStatus.mockResolvedValue(statusValue('ready'))
    let resolveUrl!: (value: string) => void
    getExpressLoginUrl.mockReturnValue(new Promise(resolve => { resolveUrl = resolve }))
    const view = renderPage()
    await user.click(await screen.findByRole('button', { name: 'Open Stripe Express' }))
    if (reason === 'unmount') view.unmount()
    else {
      useSession.mockReturnValue({ status: 'anonymous', session: null, user: null })
      view.rerender(view.page())
    }
    const assign = vi.fn()
    vi.stubGlobal('window', { location: { assign } })
    try {
      await act(async () => resolveUrl('https://connect.stripe.com/express/login'))
      expect(assign).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })
})

