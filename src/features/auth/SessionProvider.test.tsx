import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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

  it('becomes anonymous when the active initial session lookup rejects', async () => {
    getSession.mockRejectedValue(new Error('Session storage unavailable'))

    render(<SessionProvider><SessionProbe /></SessionProvider>)

    expect(screen.getByText('loading')).toBeInTheDocument()
    expect(await screen.findByText('anonymous')).toBeInTheDocument()
  })

  it('does not let a late initial rejection overwrite a newer auth event', async () => {
    let rejectSession!: (reason: Error) => void
    getSession.mockReturnValue(new Promise((_resolve, reject) => (rejectSession = reject)))
    let authListener: ((event: AuthChangeEvent, nextSession: Session | null) => void) | undefined
    onAuthStateChange.mockImplementation((listener) => {
      authListener = listener
      return { data: { subscription: { unsubscribe } } }
    })

    render(<SessionProvider><SessionProbe /></SessionProvider>)
    act(() => authListener?.('SIGNED_IN', session))
    expect(screen.getByText('authenticated:user-1')).toBeInTheDocument()

    await act(async () => rejectSession(new Error('Late session failure')))
    expect(screen.getByText('authenticated:user-1')).toBeInTheDocument()
  })

  it('handles an initial rejection after unmount without updating state', async () => {
    let rejectSession!: (reason: Error) => void
    getSession.mockReturnValue(new Promise((_resolve, reject) => (rejectSession = reject)))

    const view = render(<SessionProvider><SessionProbe /></SessionProvider>)
    view.unmount()

    await act(async () => rejectSession(new Error('Unmounted session failure')))
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('evicts every owner-private cache family when A signs out while retaining public data', async () => {
    getSession.mockResolvedValue({ data: { session }, error: null })
    let authListener: ((event: AuthChangeEvent, nextSession: Session | null) => void) | undefined
    onAuthStateChange.mockImplementation((listener) => {
      authListener = listener
      return { data: { subscription: { unsubscribe } } }
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <SessionProvider queryClient={queryClient}><SessionProbe /></SessionProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('authenticated:user-1')).toBeInTheDocument()

    queryClient.setQueryData(['events', 'detail', 'user-1', 'event-1'], 'private event')
    queryClient.setQueryData(['moderation', 'requirements', 'user-1', 'event-1'], 'private requirements')
    queryClient.setQueryData(['organizer', 'user-1'], 'private organizer profile')
    queryClient.setQueryData(['tickets', 'owned', 'user-1', 'event-1'], 'private ticket tiers')
    queryClient.setQueryData(['payments', 'connect', 'user-1'], 'private payment readiness')
    queryClient.setQueryData(['public-event', 'event-1'], 'public event')
    queryClient.setQueryData(['tickets', 'public', 'event-1'], 'public ticketing')
    queryClient.setQueryData(['moderation', 'policies'], 'public policies')

    act(() => authListener?.('SIGNED_OUT', null))
    expect(screen.getByText('anonymous')).toBeInTheDocument()
    expect(queryClient.getQueryData(['events', 'detail', 'user-1', 'event-1'])).toBeUndefined()
    expect(queryClient.getQueryData(['moderation', 'requirements', 'user-1', 'event-1'])).toBeUndefined()
    expect(queryClient.getQueryData(['organizer', 'user-1'])).toBeUndefined()
    expect(queryClient.getQueryData(['tickets', 'owned', 'user-1', 'event-1'])).toBeUndefined()
    expect(queryClient.getQueryData(['payments', 'connect', 'user-1'])).toBeUndefined()
    expect(queryClient.getQueryData(['public-event', 'event-1'])).toBe('public event')
    expect(queryClient.getQueryData(['tickets', 'public', 'event-1'])).toBe('public ticketing')
    expect(queryClient.getQueryData(['moderation', 'policies'])).toBe('public policies')

    act(() => authListener?.('SIGNED_IN', session))
    expect(screen.getByText('authenticated:user-1')).toBeInTheDocument()
    expect(queryClient.getQueryData(['events', 'detail', 'user-1', 'event-1'])).toBeUndefined()
    expect(queryClient.getQueryData(['moderation', 'requirements', 'user-1', 'event-1'])).toBeUndefined()
  })

  it('evicts A owner-private rows before an A-to-B identity switch while public caches remain', async () => {
    getSession.mockResolvedValue({ data: { session }, error: null })
    let authListener: ((event: AuthChangeEvent, nextSession: Session | null) => void) | undefined
    onAuthStateChange.mockImplementation((listener) => {
      authListener = listener
      return { data: { subscription: { unsubscribe } } }
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <SessionProvider queryClient={queryClient}><SessionProbe /></SessionProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('authenticated:user-1')).toBeInTheDocument()

    queryClient.setQueryData(['organizer', 'user-1'], { display_name: 'Organizer A' })
    queryClient.setQueryData(['events', 'owned', 'user-1'], ['A event'])
    queryClient.setQueryData(['tickets', 'owned', 'user-1', 'event-1'], ['A tier'])
    queryClient.setQueryData(['payments', 'connect', 'user-1'], { status: 'ready' })
    queryClient.setQueryData(['public-event', 'event-1'], { title: 'Public event' })

    const sessionB = { ...session, user: { ...session.user, id: 'user-2' } } as Session
    act(() => authListener?.('SIGNED_IN', sessionB))

    expect(screen.getByText('authenticated:user-2')).toBeInTheDocument()
    expect(queryClient.getQueryData(['organizer', 'user-1'])).toBeUndefined()
    expect(queryClient.getQueryData(['events', 'owned', 'user-1'])).toBeUndefined()
    expect(queryClient.getQueryData(['tickets', 'owned', 'user-1', 'event-1'])).toBeUndefined()
    expect(queryClient.getQueryData(['payments', 'connect', 'user-1'])).toBeUndefined()
    expect(queryClient.getQueryData(['public-event', 'event-1'])).toEqual({ title: 'Public event' })
  })
})
