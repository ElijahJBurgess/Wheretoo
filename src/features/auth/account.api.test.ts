import { beforeEach, describe, expect, it, vi } from 'vitest'
const { getUser, getSession, updateUser, reauthenticate } = vi.hoisted(() => ({ getUser: vi.fn(), getSession: vi.fn(), updateUser: vi.fn(), reauthenticate: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ supabase: { auth: { getUser, getSession } } }))
vi.mock('./isolatedAccountClient', () => ({ createIsolatedAccountClient: vi.fn(async () => ({ auth: { getUser, updateUser, reauthenticate, dispose: vi.fn(async () => {}) } })) }))
import { getAccountIdentity, updateAccountName, changeAccountEmail, changeAccountPassword, requestPasswordReauthentication } from './account.api'
const user = { id: 'owner-a', email: 'current@example.com', email_confirmed_at: '2026-09-01T00:00:00Z', user_metadata: { full_name: 'Account name', other_private_field: 'omit' }, new_email: 'pending@example.com', email_change_sent_at: '2026-09-12T00:00:00Z' }
describe('fresh Auth identity and authenticated security writes', () => {
  beforeEach(() => { vi.clearAllMocks(); getSession.mockResolvedValue({ data: { session: { user } }, error: null }); getUser.mockResolvedValue({ data: { user }, error: null }); updateUser.mockResolvedValue({ data: { user }, error: null }) })
  it('maps a provider missing-session error to the expired-session state', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: { name: 'AuthSessionMissingError', message: 'private provider payload' } })
    await expect(getAccountIdentity('owner-a')).rejects.toMatchObject({ code: 'session_expired' })
  })

  it('projects only fresh provider identity and separately reports pending email', async () => {
    expect(await getAccountIdentity('owner-a')).toEqual({ id: 'owner-a', fullName: 'Account name', email: 'current@example.com', emailConfirmedAt: '2026-09-01T00:00:00Z', pendingEmail: 'pending@example.com', emailChangeSentAt: '2026-09-12T00:00:00Z' })
    expect(getUser).toHaveBeenCalledOnce()
  })
  it('rejects a fresh read belonging to another owner', async () => { await expect(getAccountIdentity('owner-b')).rejects.toMatchObject({ code: 'session_expired' }) })

  it('does not send an update when the captured lifetime expires during fresh provider validation', async () => {
    let active = true
    getUser.mockImplementationOnce(async () => { active = false; return { data: { user }, error: null } })
    await expect(updateAccountName('owner-a', 'Name', () => active)).rejects.toMatchObject({ code: 'session_expired' })
    expect(updateUser).not.toHaveBeenCalled()
  })
  it('does not accept an update response after the initiating lifetime expires', async () => {
    let active = true
    updateUser.mockImplementationOnce(async () => { active = false; return { data: { user }, error: null } })
    await expect(changeAccountEmail('owner-a', 'next@example.com', () => active)).rejects.toMatchObject({ code: 'session_expired' })
  })

  it('writes Auth full_name only, preserving separate public profile', async () => {
    await updateAccountName('owner-a', ' New account name ')
    expect(updateUser).toHaveBeenCalledWith({ data: { full_name: 'New account name' } })
  })
  it('uses provider email-change response without claiming the pending address is current', async () => {
    const result = await changeAccountEmail('owner-a', 'next@example.com')
    expect(updateUser).toHaveBeenCalledWith({ email: 'next@example.com' }, { emailRedirectTo: `${window.location.origin}/organizer/settings/account` })
    expect(result.email).toBe('current@example.com')
    expect(result.pendingEmail).toBe('pending@example.com')
  })
  it('does not mutate a replacement owner', async () => {
    await expect(updateAccountName('owner-b', 'Name')).rejects.toMatchObject({ code: 'session_expired' })
    expect(updateUser).not.toHaveBeenCalled()
  })
  it.each([['over_request_rate_limit', 'rate_limited'], ['session_not_found', 'session_expired'], ['reauthentication_needed', 'reauthentication_required'], ['weak_password', 'password_refused'], ['unknown', 'provider_failure']])('sanitizes provider failure %s', async (providerCode, code) => {
    updateUser.mockResolvedValue({ data: { user: null }, error: { code: providerCode, message: 'private provider payload' } })
    await expect(changeAccountPassword('owner-a', crypto.randomUUID())).rejects.toMatchObject({ code })
    try { await changeAccountPassword('owner-a', crypto.randomUUID()) } catch (error) { expect(String(error)).not.toContain('private provider payload') }
  })
  it('passes only a transient password and optional reauthentication nonce to updateUser', async () => {
    const password = crypto.randomUUID()
    const nonce = String(crypto.getRandomValues(new Uint32Array(1))[0])
    await expect(changeAccountPassword('owner-a', password, nonce)).resolves.toBeUndefined()
    expect(updateUser).toHaveBeenCalledWith({ password, nonce })
    reauthenticate.mockResolvedValue({ data: { user: null, session: null }, error: null })
    await requestPasswordReauthentication('owner-a')
    expect(reauthenticate).toHaveBeenCalledOnce()
  })
})
