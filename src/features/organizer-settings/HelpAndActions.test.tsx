import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { getAccountIdentity, signOut } = vi.hoisted(() => ({ getAccountIdentity: vi.fn(), signOut: vi.fn() }))
vi.mock('../auth/SessionProvider', () => ({ useSession: () => ({ status: 'authenticated', user: { id: 'a' }, identityVersion: 1 }) }))
vi.mock('../auth/SignOutProvider', () => ({ useSignOut: () => ({ pending: false, error: null, signOut }) }))
vi.mock('../auth/account.api', () => ({ getAccountIdentity }))
vi.mock('../organizers/organizer.queries', () => ({ useOrganizer: () => ({ data: { display_name: 'Public Name', internal: 'never include' }, isPending: false, isError: false }) }))
import { HelpLegalPage } from './HelpLegalPage'
import { AccountActionsPage } from './AccountActionsPage'
function setup(actions = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{ path: '*', element: actions ? <AccountActionsPage /> : <HelpLegalPage /> }])
  return render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
}
describe('Help, legal and manual closure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of ['VITE_TICKET_SUPPORT_EMAIL', 'VITE_ORGANIZER_SUPPORT_EMAIL', 'VITE_ACCOUNT_CLOSURE_EMAIL', 'VITE_TERMS_URL', 'VITE_PRIVACY_URL']) vi.stubEnv(key, '')
    getAccountIdentity.mockResolvedValue({ email: 'fresh@example.invalid', pendingEmail: 'pending@example.invalid', fullName: 'Private account name' })
  })
  afterEach(() => vi.unstubAllEnvs())
  it('renders unavailable states without invented destinations', () => {
    setup()
    expect(screen.getByText('Support contact is currently unavailable.')).toBeInTheDocument()
    expect(screen.getByText('Terms are currently unavailable.')).toBeInTheDocument()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })
  it('offers explicit configured mail handoffs and real configured legal links', () => {
    vi.stubEnv('VITE_TICKET_SUPPORT_EMAIL', 'support@wheretoo.app'); vi.stubEnv('VITE_TERMS_URL', 'https://wheretoo.app/terms'); vi.stubEnv('VITE_PRIVACY_URL', 'https://wheretoo.app/privacy')
    setup()
    expect(screen.getAllByRole('link', { name: 'Open email app ↗' })).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Read Terms ↗' })).toHaveAttribute('href', 'https://wheretoo.app/terms')
    expect(screen.getByRole('link', { name: 'Read Privacy ↗' })).toHaveAttribute('rel', 'noopener noreferrer')
  })
  it('describes the preserved global organizer sign-out scope', () => {
    setup(true)
    expect(screen.getByText('Sign out here and request sign-out of your other organizer sessions.')).toBeInTheDocument()
  })
  it('omits closure action without a recipient and does not read private email unnecessarily', () => {
    setup(true)
    expect(screen.getByText('Account closure requests are currently unavailable.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request account closure' })).not.toBeInTheDocument()
    expect(getAccountIdentity).not.toHaveBeenCalled()
  })
  it('confirms, cancels, and prepares only safe fresh context without claiming submission', async () => {
    vi.stubEnv('VITE_ACCOUNT_CLOSURE_EMAIL', 'review@wheretoo.app')
    setup(true)
    fireEvent.click(screen.getByRole('button', { name: 'Request account closure' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('does not close your account')
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'A & B\nReview please' } })
    const link = await screen.findByRole('link', { name: 'Open email app' })
    const url = new URL(link.getAttribute('href')!)
    expect(url.searchParams.get('body')).toBe('Organizer: Public Name\nCurrent login email: fresh@example.invalid\nReason: A & B\nReview please')
    expect(url.href).not.toMatch(/pending|never.include|token|password/)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Request account closure' }))
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open email app' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('link', { name: 'Open email app' }))
    expect(screen.getByRole('status')).toHaveTextContent('No request has been submitted by Wheretoo.')
    expect(signOut).not.toHaveBeenCalled()
  })
  it('does not open mail when fresh account identity cannot be established', async () => {
    vi.stubEnv('VITE_ACCOUNT_CLOSURE_EMAIL', 'review@wheretoo.app'); getAccountIdentity.mockRejectedValue(new Error('expired'))
    setup(true); fireEvent.click(screen.getByRole('button', { name: 'Request account closure' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not load')
    expect(screen.queryByRole('link', { name: 'Open email app' })).not.toBeInTheDocument()
  })
})

it('suppresses late Settings sign-out navigation after an identity change', async () => {
  signOut.mockResolvedValue({ localSignedOut: true, remoteRevoked: true, isCurrent: () => false })
  const router = createMemoryRouter([{ path: '/organizer/settings/actions', element: <AccountActionsPage /> }, { path: '/auth/sign-in', element: <p>Stale navigation</p> }], { initialEntries: ['/organizer/settings/actions'] })
  render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign out' })))
  expect(router.state.location.pathname).toBe('/organizer/settings/actions')
  expect(screen.queryByText('Stale navigation')).not.toBeInTheDocument()
})
