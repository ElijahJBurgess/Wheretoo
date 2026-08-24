import { act, render, screen } from '@testing-library/react'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSession, onAuthStateChange, unsubscribe } = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock('../../lib/supabase/client', () => ({
  supabase: { auth: { getSession, onAuthStateChange } },
}))

import { SessionProvider, useSession } from './SessionProvider'

const session = {
  access_token: 'token',
  refresh_token: 'refresh',
  expires_in: 3600,
  token_type: 'bearer',
  user: { id: 'user-1', email: 'organizer@example.com' },
} as Session

function SessionProbe() {
  const state = useSession()
  return <p>{state.status === 'authenticated' ? `${state.status}:${state.user.id}` : state.status}</p>
}

describe('SessionProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } })
  })

  it('moves from loading to authenticated after resolving the initial session', async () => {
    let resolveSession!: (value: { data: { session: Session }; error: null }) => void
    getSession.mockReturnValue(new Promise((resolve) => (resolveSession = resolve)))

    render(<SessionProvider><SessionProbe /></SessionProvider>)
    expect(screen.getByText('loading')).toBeInTheDocument()

    await act(async () => resolveSession({ data: { session }, error: null }))
    expect(screen.getByText('authenticated:user-1')).toBeInTheDocument()
  })

  it('moves from loading to anonymous when no initial session exists', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null })

    render(<SessionProvider><SessionProbe /></SessionProvider>)
    expect(screen.getByText('loading')).toBeInTheDocument()
    expect(await screen.findByText('anonymous')).toBeInTheDocument()
  })

  it('updates from auth events and unsubscribes on unmount', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    let authListener: ((event: AuthChangeEvent, nextSession: Session | null) => void) | undefined
    onAuthStateChange.mockImplementation((listener) => {
      authListener = listener
      return { data: { subscription: { unsubscribe } } }
    })

    const view = render(<SessionProvider><SessionProbe /></SessionProvider>)
    expect(await screen.findByText('anonymous')).toBeInTheDocument()

    act(() => authListener?.('SIGNED_IN', session))
    expect(screen.getByText('authenticated:user-1')).toBeInTheDocument()

    view.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('does not let a late initial lookup overwrite a newer auth event', async () => {
    let resolveSession!: (value: { data: { session: null }; error: null }) => void
    getSession.mockReturnValue(new Promise((resolve) => (resolveSession = resolve)))
    let authListener: ((event: AuthChangeEvent, nextSession: Session | null) => void) | undefined
    onAuthStateChange.mockImplementation((listener) => {
      authListener = listener
      return { data: { subscription: { unsubscribe } } }
    })

    render(<SessionProvider><SessionProbe /></SessionProvider>)
    act(() => authListener?.('SIGNED_IN', session))
    expect(screen.getByText('authenticated:user-1')).toBeInTheDocument()

    await act(async () => resolveSession({ data: { session: null }, error: null }))
    expect(screen.getByText('authenticated:user-1')).toBeInTheDocument()
  })
})
