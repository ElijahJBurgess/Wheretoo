import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

const baseStatus = {
  requirements_currently_due_count: 0,
  requirements_past_due_count: 0,
  last_status_code: null,
  last_synced_at: '2026-08-25T12:00:00.000Z',
}

describe('OrganizerPaymentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSession.mockReturnValue({ status: 'authenticated', session: {}, user: { id: 'organizer-1' } })
    useConnectStatus.mockReturnValue({ data: undefined, isPending: false, isError: false, refetch })
    useConnectAccountSession.mockReturnValue({ isPending: false, mutateAsync: vi.fn() })
  })

  it('renders deterministic loading and safe error states', () => {
    useConnectStatus.mockReturnValue({ data: undefined, isPending: true, isError: false, refetch })
    const view = render(<OrganizerPaymentsPage />)
    expect(screen.getByText('Loading payment setup')).toBeInTheDocument()

    useConnectStatus.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch })
    view.rerender(<OrganizerPaymentsPage />)
    expect(screen.getByRole('alert')).toHaveTextContent('Payment setup could not load')
    expect(screen.queryByText(/raw Stripe/i)).not.toBeInTheDocument()
  })

  it.each([
    ['not_started', 'Set up payments'],
    ['pending', 'Continue payment setup'],
    ['action_required', 'Review payment setup'],
    ['restricted', 'Update payment details'],
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

    const action = screen.getByRole('button', { name: 'Set up payments' })
    await user.click(action)

    expect(mutateAsync).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Exit embedded setup' })).toBeInTheDocument()
    expect(screen.queryByText('do-not-render-this')).not.toBeInTheDocument()
    expect(screen.queryByText(/payout|balance|analytics|refund/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Exit embedded setup' }))
    expect(refetch).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Set up payments' })).toHaveFocus()
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

    await user.click(screen.getByRole('button', { name: 'Set up payments' }))
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
    expect(await screen.findByRole('alert')).toHaveTextContent('Stripe Express could not be opened. Try again.')
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

    await user.click(screen.getByRole('button', { name: 'Set up payments' }))
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
    vi.stubGlobal('window', { location: { assign } })
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

  it('unmounts a failed embedded component, returns focus, and exposes a real retry action', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({
      clientSecret: 'do-not-render-this',
      status: { ...baseStatus, status: 'pending' },
    })
    useConnectStatus.mockReturnValue({ data: { ...baseStatus, status: 'not_started' }, isPending: false, isError: false, refetch })
    useConnectAccountSession.mockReturnValue({ isPending: false, mutateAsync })
    render(<OrganizerPaymentsPage />)

    await user.click(screen.getByRole('button', { name: 'Set up payments' }))
    await user.click(screen.getByRole('button', { name: 'Report embedded load error' }))

    expect(screen.queryByRole('button', { name: 'Report embedded load error' })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Secure payment setup could not load. Try again.')
    expect(screen.getByRole('button', { name: 'Set up payments' })).toHaveFocus()
    expect(refetch).toHaveBeenCalledOnce()
  })
})
