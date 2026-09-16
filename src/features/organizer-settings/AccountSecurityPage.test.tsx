import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const { getAccountIdentity, updateAccountName, changeAccountEmail, changeAccountPassword, requestPasswordReauthentication, session } = vi.hoisted(() => ({
  getAccountIdentity: vi.fn(), updateAccountName: vi.fn(), changeAccountEmail: vi.fn(), changeAccountPassword: vi.fn(), requestPasswordReauthentication: vi.fn(),
  session: { current: { status: 'authenticated', user: { id: 'a' }, identityVersion: 1 } },
}))
vi.mock('../auth/SessionProvider', () => ({ useSession: () => session.current }))
vi.mock('../auth/account.api', async importOriginal => ({ ...await importOriginal<typeof import('../auth/account.api')>(), getAccountIdentity, updateAccountName, changeAccountEmail, changeAccountPassword, requestPasswordReauthentication }))
import { AccountSecurityPage } from './AccountSecurityPage'
import { AccountSecurityError } from '../auth/account.api'
import { setAuthenticatedIdentity } from '../auth/identityLifetime'
const identity = { id: 'a', fullName: 'Fresh account name', email: 'current@example.com', emailConfirmedAt: '2026-09-01', pendingEmail: null, emailChangeSentAt: null }
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  setAuthenticatedIdentity(client, 'a')
  const router = createMemoryRouter([{ path: '*', element: <AccountSecurityPage /> }], { initialEntries: ['/organizer/settings/account'] })
  const view = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return { client, ...view }
}
describe('Account & Security', () => {
  beforeEach(() => { vi.clearAllMocks(); session.current = { status: 'authenticated', user: { id: 'a' }, identityVersion: 1 }; getAccountIdentity.mockResolvedValue(identity) })
  it('loads fresh identity and keeps a failed nonsecret draft until cancel', async () => {
    updateAccountName.mockRejectedValue(new AccountSecurityError('rate_limited'))
    setup()
    expect(await screen.findByText('Fresh account name')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit account name' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Account name' }), { target: { value: 'Changed account name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save account name' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i)
    expect(screen.getByRole('textbox', { name: 'Account name' })).toHaveValue('Changed account name')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'Account name' })).not.toBeInTheDocument()
  })
  it('shows current and provider-pending email separately and refreshes confirmed state', async () => {
    getAccountIdentity.mockResolvedValue({ ...identity, pendingEmail: 'pending@example.com', emailChangeSentAt: '2026-09-12' })
    setup()
    expect(await screen.findByText('pending@example.com')).toBeInTheDocument()
    expect(screen.getByText('current@example.com')).toBeInTheDocument()
    expect(screen.getByText(/confirmation pending/i)).toBeInTheDocument()
    getAccountIdentity.mockResolvedValue({ ...identity, email: 'pending@example.com' })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh account status' }))
    await waitFor(() => expect(screen.queryByText(/confirmation pending/i)).not.toBeInTheDocument())
    expect(screen.queryByText('current@example.com')).not.toBeInTheDocument()
  })
  it('clears password inputs on success and never adds a password mutation', async () => {
    changeAccountPassword.mockResolvedValue(undefined)
    const { client } = setup()
    await screen.findByText('Fresh account name')
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    const password = crypto.randomUUID()
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: password } })
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }))
    expect(await screen.findByText('Password updated.')).toBeInTheDocument()
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
    expect(client.getMutationCache().getAll()).toHaveLength(0)
    expect(JSON.stringify(client.getQueryCache().getAll().map(q => q.state.data))).not.toContain(password)
  })
  it('supports provider-required reauthentication and nonce without adding reset-by-email', async () => {
    changeAccountPassword.mockRejectedValueOnce(new AccountSecurityError('reauthentication_required')).mockResolvedValueOnce(undefined)
    requestPasswordReauthentication.mockResolvedValue(undefined)
    setup()
    await screen.findByText('Fresh account name')
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    const password = crypto.randomUUID()
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: password } })
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Send verification code' }))
    expect(await screen.findByText(/verification code was requested/i)).toBeInTheDocument()
    const nonce = String(crypto.getRandomValues(new Uint32Array(1))[0])
    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: nonce } })
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }))
    expect(await screen.findByText('Password updated.')).toBeInTheDocument()
    expect(changeAccountPassword).toHaveBeenLastCalledWith('a', password, nonce, expect.any(Function))
  })
  it('discards secrets and a late save when the account page unmounts across identities', async () => {
    let finish!: () => void
    changeAccountPassword.mockReturnValue(new Promise<void>(resolve => { finish = resolve }))
    const { client, rerender } = setup()
    await screen.findByText('Fresh account name')
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    const password = crypto.randomUUID()
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: password } })
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }))
    setAuthenticatedIdentity(client, 'b'); setAuthenticatedIdentity(client, 'a')
    session.current = { ...session.current, identityVersion: 3 }
    const router = createMemoryRouter([{ path: '*', element: <AccountSecurityPage /> }])
    rerender(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
    await act(async () => finish())
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
    expect(screen.queryByText('Password updated.')).not.toBeInTheDocument()
  })
})
