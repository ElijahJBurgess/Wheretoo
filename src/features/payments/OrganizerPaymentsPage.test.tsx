import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { render as testingRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getExpressLoginUrl, refetch, useConnectAccountSession, useConnectStatus, useSession } = vi.hoisted(() => ({
  getExpressLoginUrl: vi.fn(),
  refetch: vi.fn(),
  useConnectAccountSession: vi.fn(),
  useConnectStatus: vi.fn(),
  useSession: vi.fn(),
}))

vi.mock('../auth/SessionProvider', () => ({ useSession }))
vi.mock('./payment.queries', () => ({ useConnectAccountSession, useConnectStatus }))
vi.mock('./payment.api', () => ({ getExpressLoginUrl }))
vi.mock('./ConnectEmbeddedPanel', () => ({
  ConnectEmbeddedPanel: ({ onExit, onLoadError }: { onExit: () => void; onLoadError: () => void }) => (
    <>
      <button onClick={onExit} type="button">Exit embedded setup</button>
      <button onClick={onLoadError} type="button">Report embedded load error</button>
    </>
  ),
}))

import { OrganizerPaymentsPage } from './OrganizerPaymentsPage'

function render(element: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return testingRender(element, { wrapper: ({ children }) => <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider> })
}

const baseStatus = {
  requirements_currently_due_count: 0,
  requirements_past_due_count: 0,
  last_status_code: null,
  last_synced_at: '2026-08-25T12:00:00.000Z',
}

describe('OrganizerPaymentsPage', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    useSession.mockReturnValue({ status: 'authenticated', session: {}, user: { id: 'organizer-1' } })
    useConnectStatus.mockReturnValue({ data: undefined, isPending: false, isError: false, refetch })
    useConnectAccountSession.mockReturnValue({ isPending: false, mutateAsync: vi.fn() })
    refetch.mockResolvedValue({ data: { ...baseStatus, status: 'not_started' }, isError: false })
  })

  it('renders deterministic loading and safe error states', () => {
    useConnectStatus.mockReturnValue({ data: undefined, isPending: true, isError: false, refetch })
    const view = render(<OrganizerPaymentsPage />)
    expect(screen.getByText('Loading payment setup')).toBeInTheDocument()

    useConnectStatus.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch })
    view.rerender(<OrganizerPaymentsPage />)
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
    expect(screen.queryByText(/raw Stripe/i)).not.toBeInTheDocument()
  })

  it.each([
    ['not_started', 'Set up payouts'],
    ['pending', 'Refresh status'],
    ['action_required', 'Review with Stripe'],
    ['restricted', 'Review with Stripe'],
    ['ready', 'Manage payment details'],
  ] as const)('renders the %s state with one primary next action', (status, action) => {
    useConnectStatus.mockReturnValue({ data: { ...baseStatus, status }, isPending: false, isError: false, refetch })
    render(<OrganizerPaymentsPage />)

    expect(screen.getByRole('button', { name: action })).toBeInTheDocument()
    expect(screen.queryByText(/account ID|requirements_due|acct_/i)).not.toBeInTheDocument()
  })

  it('creates a fresh Account Session, reveals only the approved embedded panel, and restores focus on exit', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({
      clientSecret: 'do-not-render-this',
      status: { ...baseStatus, status: 'pending' },
    })
    useConnectStatus.mockReturnValue({ data: { ...baseStatus, status: 'not_started' }, isPending: false, isError: false, refetch })
    useConnectAccountSession.mockReturnValue({ isPending: false, mutateAsync })
    render(<OrganizerPaymentsPage />)

    await user.click(screen.getByRole('button', { name: 'Set up payouts' }))
    await user.click(screen.getByRole('button', { name: 'Continue with Stripe' }))

    expect(mutateAsync).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Exit embedded setup' })).toBeInTheDocument()
    expect(screen.queryByText('do-not-render-this')).not.toBeInTheDocument()
    expect(screen.queryByText(/balance|analytics|refund/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Exit embedded setup' }))
    expect(refetch).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Continue setup' })).toHaveFocus()
  })

  it('does not render an Account Session created for a previous organizer identity', async () => {
    const user = userEvent.setup()
    useConnectAccountSession.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn().mockResolvedValue({
        clientSecret: 'previous-organizer-session',
        status: { ...baseStatus, status: 'pending' },
      }),
    })
    useConnectStatus.mockReturnValue({ data: { ...baseStatus, status: 'not_started' }, isPending: false, isError: false, refetch })
    const view = render(<OrganizerPaymentsPage />)

    await user.click(screen.getByRole('button', { name: 'Set up payouts' }))
    await user.click(screen.getByRole('button', { name: 'Continue with Stripe' }))
    expect(screen.getByRole('button', { name: 'Exit embedded setup' })).toBeInTheDocument()

    useSession.mockReturnValue({ status: 'authenticated', session: {}, user: { id: 'organizer-2' } })
    useConnectStatus.mockReturnValue({ data: { ...baseStatus, status: 'ready' }, isPending: false, isError: false, refetch })
    view.rerender(<OrganizerPaymentsPage />)

    expect(screen.queryByRole('button', { name: 'Exit embedded setup' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Manage payment details' })).toBeInTheDocument()
  })

  it('calls the owner-scoped Express function and keeps a failure message generic', async () => {
    const user = userEvent.setup()
    getExpressLoginUrl.mockRejectedValue(new Error('raw account details'))
    useConnectStatus.mockReturnValue({ data: { ...baseStatus, status: 'ready' }, isPending: false, isError: false, refetch })
    render(<OrganizerPaymentsPage />)

    await user.click(screen.getByRole('button', { name: 'Open Stripe Express' }))

    expect(getExpressLoginUrl).toHaveBeenCalledOnce()
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong')
    expect(screen.queryByText(/raw account details/i)).not.toBeInTheDocument()
  })

  it('does not surface a deferred Account Session for organizer A after the active identity becomes B', async () => {
    const user = userEvent.setup()
    let resolveSession!: (value: { clientSecret: string; status: typeof baseStatus & { status: 'pending' } }) => void
    const deferredSession = new Promise<{ clientSecret: string; status: typeof baseStatus & { status: 'pending' } }>((resolve) => {
      resolveSession = resolve
    })
    const mutateAsync = vi.fn().mockReturnValue(deferredSession)
    useConnectAccountSession.mockReturnValue({ isPending: false, mutateAsync })
    useConnectStatus.mockReturnValue({ data: { ...baseStatus, status: 'not_started' }, isPending: false, isError: false, refetch })
    const view = render(<OrganizerPaymentsPage />)

    await user.click(screen.getByRole('button', { name: 'Set up payouts' }))
    await user.click(screen.getByRole('button', { name: 'Continue with Stripe' }))
    expect(mutateAsync).toHaveBeenCalledWith('organizer-1')

    useSession.mockReturnValue({ status: 'authenticated', session: {}, user: { id: 'organizer-2' } })
    useConnectStatus.mockReturnValue({ data: { ...baseStatus, status: 'ready' }, isPending: false, isError: false, refetch })
    view.rerender(<OrganizerPaymentsPage />)
    resolveSession({ clientSecret: 'organizer-a-session', status: { ...baseStatus, status: 'pending' } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Manage payment details' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Exit embedded setup' })).not.toBeInTheDocument()
    expect(screen.queryByText('organizer-a-session')).not.toBeInTheDocument()
  })

  it('does not redirect with a deferred Express URL after its initiating organizer signs out', async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    vi.stubGlobal('window', {
      addEventListener: vi.fn(), removeEventListener: vi.fn(), location: { assign } })
    let resolveUrl!: (value: string) => void
    getExpressLoginUrl.mockReturnValue(new Promise<string>((resolve) => { resolveUrl = resolve }))
    useConnectStatus.mockReturnValue({ data: { ...baseStatus, status: 'ready' }, isPending: false, isError: false, refetch })
    const view = render(<OrganizerPaymentsPage />)

    await user.click(screen.getByRole('button', { name: 'Open Stripe Express' }))
    useSession.mockReturnValue({ status: 'anonymous', session: null, user: null })
    view.rerender(<OrganizerPaymentsPage />)
    resolveUrl('https://connect.stripe.com/express/login')

    await Promise.resolve()
    expect(assign).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('does not redirect after unmount when a deferred Express URL resolves', async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    vi.stubGlobal('window', {
      addEventListener: vi.fn(), removeEventListener: vi.fn(), location: { assign } })
    let resolveUrl!: (value: string) => void
    getExpressLoginUrl.mockReturnValue(new Promise<string>((resolve) => { resolveUrl = resolve }))
    useConnectStatus.mockReturnValue({ data: { ...baseStatus, status: 'ready' }, isPending: false, isError: false, refetch })
    const view = render(<OrganizerPaymentsPage />)

    try {
      await user.click(screen.getByRole('button', { name: 'Open Stripe Express' }))
      view.unmount()
      resolveUrl('https://connect.stripe.com/express/login')

      await Promise.resolve()
      expect(assign).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('redirects to Stripe Express while the initiating organizer remains mounted', async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    vi.stubGlobal('window', {
      addEventListener: vi.fn(), removeEventListener: vi.fn(), location: { assign } })
    getExpressLoginUrl.mockResolvedValue('https://connect.stripe.com/express/login')
    useConnectStatus.mockReturnValue({ data: { ...baseStatus, status: 'ready' }, isPending: false, isError: false, refetch })
    render(<OrganizerPaymentsPage />)

    try {
      await user.click(screen.getByRole('button', { name: 'Open Stripe Express' }))
      await Promise.resolve()
      expect(assign).toHaveBeenCalledWith('https://connect.stripe.com/express/login')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('unmounts a failed embedded component, returns focus, and exposes a real retry action', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({
      clientSecret: 'do-not-render-this',
      status: { ...baseStatus, status: 'pending' },
    })
    useConnectStatus.mockReturnValue({ data: { ...baseStatus, status: 'not_started' }, isPending: false, isError: false, refetch })
    useConnectAccountSession.mockReturnValue({ isPending: false, mutateAsync })
    render(<OrganizerPaymentsPage />)

    await user.click(screen.getByRole('button', { name: 'Set up payouts' }))
    await user.click(screen.getByRole('button', { name: 'Continue with Stripe' }))
    await user.click(screen.getByRole('button', { name: 'Report embedded load error' }))

    expect(screen.queryByRole('button', { name: 'Report embedded load error' })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus()
    expect(refetch).toHaveBeenCalledOnce()
  })
})
