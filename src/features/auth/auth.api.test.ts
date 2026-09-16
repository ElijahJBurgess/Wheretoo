import { beforeEach, describe, expect, it, vi } from 'vitest'

const { signInWithPassword, signOutAuth, signUp, initialize } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOutAuth: vi.fn(),
  signUp: vi.fn(),
  initialize: vi.fn(),
}))

vi.mock('../../lib/env', () => ({ publicEnv: { supabaseUrl: 'https://auth.example.invalid' } }))

vi.mock('../../lib/supabase/client', () => ({
  supabase: { auth: { signInWithPassword, signOut: signOutAuth, signUp, initialize } },
}))

vi.mock('./authTransitions', async importOriginal => ({ ...await importOriginal<typeof import('./authTransitions')>(), signOutExpectedSession: signOutAuth }))

import { signInOrganizer, signOut, signUpOrganizer } from './auth.api'

describe('organizer auth API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    initialize.mockResolvedValue({ error: null })
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (_name: string, _options: unknown, fn: (lock: object) => Promise<unknown>) => fn({}) } })
  })

  it('signs up with organizer metadata and the setup redirect', async () => {
    signUp.mockResolvedValue({ data: { session: null }, error: null })

    await expect(
      signUpOrganizer({
        fullName: 'Avery Stone',
        email: 'organizer@example.com',
        password: 'safe-password',
      }),
    ).resolves.toEqual({ needsEmailConfirmation: true })

    expect(signUp).toHaveBeenCalledWith({
      email: 'organizer@example.com',
      password: 'safe-password',
      options: {
        data: { full_name: 'Avery Stone' },
        emailRedirectTo: `${window.location.origin}/organizer/setup`,
      },
    })
  })

  it('does not require email confirmation when signup returns a session', async () => {
    signUp.mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null })

    await expect(
      signUpOrganizer({ fullName: 'Avery Stone', email: 'organizer@example.com', password: 'safe-password' }),
    ).resolves.toEqual({ needsEmailConfirmation: false })
  })

  it('propagates signup errors', async () => {
    const error = new Error('Email already registered')
    signUp.mockResolvedValue({ data: { session: null }, error })

    await expect(
      signUpOrganizer({ fullName: 'Avery Stone', email: 'organizer@example.com', password: 'safe-password' }),
    ).rejects.toBe(error)
  })

  it('signs in and propagates errors', async () => {
    signInWithPassword.mockResolvedValueOnce({ error: null })
    await expect(
      signInOrganizer({ email: 'organizer@example.com', password: 'safe-password' }),
    ).resolves.toBeUndefined()
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'organizer@example.com',
      password: 'safe-password',
    })

    const error = new Error('Invalid login credentials')
    signInWithPassword.mockResolvedValueOnce({ error })
    await expect(
      signInOrganizer({ email: 'organizer@example.com', password: 'wrong' }),
    ).rejects.toBe(error)
  })

  it('passes the captured session to conditional logout and propagates errors', async () => {
    const expected = { user: { id: 'user-1' }, access_token: 'synthetic-a', refresh_token: 'synthetic-refresh-a' }
    const result = { localSignedOut: true, remoteRevoked: true, sessionChanged: false }
    signOutAuth.mockResolvedValueOnce(result)
    await expect(signOut(expected)).resolves.toEqual(result)
    expect(signOutAuth).toHaveBeenCalledWith(expect.any(Object), expected, expect.any(Function))
    const error = new Error('Could not sign out')
    signOutAuth.mockRejectedValueOnce(error)
    await expect(signOut(expected)).rejects.toBe(error)
  })
})
