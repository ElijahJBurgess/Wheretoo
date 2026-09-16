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
import { captureSignOutLifetime } from './identityLifetime'

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
    onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } }, ready: Promise.resolve({ error: null }) })
  })


  it('increments the identity version even when A to B to A events are batched', async () => {
    getSession.mockResolvedValue({ data: { session }, error: null })
    let listener!: (event: AuthChangeEvent, nextSession: Session | null) => void
    onAuthStateChange.mockImplementation((nextListener) => {
      listener = (event, nextSession) => { getSession.mockResolvedValue({ data: { session: nextSession }, error: null }); nextListener(event, nextSession) }
      return { data: { subscription: { unsubscribe } }, ready: Promise.resolve({ error: null }) }
    })
    function VersionProbe() { const state = useSession(); return <p>version:{state.identityVersion}</p> }
    render(<SessionProvider><VersionProbe /></SessionProvider>)
    expect(await screen.findByText('version:1')).toBeInTheDocument()
    await act(async () => {
      listener('SIGNED_IN', { ...session, user: { ...session.user, id: 'user-2' } })
      listener('SIGNED_IN', session)
    })
    expect(screen.getByText('version:3')).toBeInTheDocument()
    await act(async () => listener('TOKEN_REFRESHED', session))
    expect(screen.getByText('version:3')).toBeInTheDocument()
  })

  it('moves from loading to authenticated after resolving the initial session', async () => {
    let resolveSession!: (value: { data: { session: Session }; error: null }) => void
    getSession.mockReturnValue(new Promise((resolve) => (resolveSession = resolve)))

    render(<SessionProvider><SessionProbe /></SessionProvider>)
    expect(screen.getByText('loading')).toBeInTheDocument()

    await act(async () => {})
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
      authListener = (event, nextSession) => { getSession.mockResolvedValue({ data: { session: nextSession }, error: null }); listener(event, nextSession) }
      return { data: { subscription: { unsubscribe } }, ready: Promise.resolve({ error: null }) }
    })

    const view = render(<SessionProvider><SessionProbe /></SessionProvider>)
    expect(await screen.findByText('anonymous')).toBeInTheDocument()

    await act(async () => authListener?.('SIGNED_IN', session))
    expect(screen.getByText('authenticated:user-1')).toBeInTheDocument()

    view.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('does not let a late initial lookup overwrite a newer auth event', async () => {
    let resolveSession!: (value: { data: { session: null }; error: null }) => void
    getSession.mockReturnValue(new Promise((resolve) => (resolveSession = resolve)))
    let authListener: ((event: AuthChangeEvent, nextSession: Session | null) => void) | undefined
    onAuthStateChange.mockImplementation((listener) => {
      authListener = (event, nextSession) => { getSession.mockResolvedValue({ data: { session: nextSession }, error: null }); listener(event, nextSession) }
      return { data: { subscription: { unsubscribe } }, ready: Promise.resolve({ error: null }) }
    })

    render(<SessionProvider><SessionProbe /></SessionProvider>)
    await act(async () => {})
    await act(async () => authListener?.('SIGNED_IN', session))
    expect(screen.getByText('authenticated:user-1')).toBeInTheDocument()

    await act(async () => resolveSession({ data: { session: null }, error: null }))
    expect(screen.getByText('authenticated:user-1')).toBeInTheDocument()
  })

  it('shows unavailable when the active initial session lookup rejects', async () => {
    getSession.mockRejectedValue(new Error('Session storage unavailable'))

    render(<SessionProvider><SessionProbe /></SessionProvider>)

    expect(screen.getByText('loading')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Organizer authentication is unavailable')
  })

  it('does not let a late initial rejection overwrite a newer auth event', async () => {
    let rejectSession!: (reason: Error) => void
    getSession.mockReturnValue(new Promise((_resolve, reject) => (rejectSession = reject)))
    let authListener: ((event: AuthChangeEvent, nextSession: Session | null) => void) | undefined
    onAuthStateChange.mockImplementation((listener) => {
      authListener = (event, nextSession) => { getSession.mockResolvedValue({ data: { session: nextSession }, error: null }); listener(event, nextSession) }
      return { data: { subscription: { unsubscribe } }, ready: Promise.resolve({ error: null }) }
    })

    render(<SessionProvider><SessionProbe /></SessionProvider>)
    await act(async () => {})
    await act(async () => authListener?.('SIGNED_IN', session))
    expect(screen.getByText('authenticated:user-1')).toBeInTheDocument()

    await act(async () => rejectSession(new Error('Late session failure')))
    expect(screen.getByText('authenticated:user-1')).toBeInTheDocument()
  })

  it('handles an initial rejection after unmount without updating state', async () => {
    let rejectSession!: (reason: Error) => void
    getSession.mockReturnValue(new Promise((_resolve, reject) => (rejectSession = reject)))

    const view = render(<SessionProvider><SessionProbe /></SessionProvider>)
    await act(async () => {})
    view.unmount()

    await act(async () => rejectSession(new Error('Unmounted session failure')))
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('evicts every owner-private cache family when A signs out while retaining public data', async () => {
    getSession.mockResolvedValue({ data: { session }, error: null })
    let authListener: ((event: AuthChangeEvent, nextSession: Session | null) => void) | undefined
    onAuthStateChange.mockImplementation((listener) => {
      authListener = (event, nextSession) => { getSession.mockResolvedValue({ data: { session: nextSession }, error: null }); listener(event, nextSession) }
      return { data: { subscription: { unsubscribe } }, ready: Promise.resolve({ error: null }) }
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

    await act(async () => authListener?.('SIGNED_OUT', null))
    expect(screen.getByText('anonymous')).toBeInTheDocument()
    expect(queryClient.getQueryData(['events', 'detail', 'user-1', 'event-1'])).toBeUndefined()
    expect(queryClient.getQueryData(['moderation', 'requirements', 'user-1', 'event-1'])).toBeUndefined()
    expect(queryClient.getQueryData(['organizer', 'user-1'])).toBeUndefined()
    expect(queryClient.getQueryData(['tickets', 'owned', 'user-1', 'event-1'])).toBeUndefined()
    expect(queryClient.getQueryData(['payments', 'connect', 'user-1'])).toBeUndefined()
    expect(queryClient.getQueryData(['public-event', 'event-1'])).toBe('public event')
    expect(queryClient.getQueryData(['tickets', 'public', 'event-1'])).toBe('public ticketing')
    expect(queryClient.getQueryData(['moderation', 'policies'])).toBe('public policies')

    await act(async () => authListener?.('SIGNED_IN', session))
    expect(screen.getByText('authenticated:user-1')).toBeInTheDocument()
    expect(queryClient.getQueryData(['events', 'detail', 'user-1', 'event-1'])).toBeUndefined()
    expect(queryClient.getQueryData(['moderation', 'requirements', 'user-1', 'event-1'])).toBeUndefined()
  })

  it('evicts A owner-private rows before an A-to-B identity switch while public caches remain', async () => {
    getSession.mockResolvedValue({ data: { session }, error: null })
    let authListener: ((event: AuthChangeEvent, nextSession: Session | null) => void) | undefined
    onAuthStateChange.mockImplementation((listener) => {
      authListener = (event, nextSession) => { getSession.mockResolvedValue({ data: { session: nextSession }, error: null }); listener(event, nextSession) }
      return { data: { subscription: { unsubscribe } }, ready: Promise.resolve({ error: null }) }
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
    const combinedKeys = ['event-change-context', 'event-notice-status', 'event-cancellation-summary', 'account', 'organizer-settings'].map(scope => [scope, 'user-1'])
    for (const key of combinedKeys) queryClient.setQueryData(key, 'Owner A private state')
    queryClient.setQueryData(['tickets', 'owned', 'user-1', 'event-1'], ['A tier'])
    queryClient.setQueryData(['payments', 'connect', 'user-1'], { status: 'ready' })
    queryClient.setQueryData(['public-event', 'event-1'], { title: 'Public event' })

    const sessionB = { ...session, user: { ...session.user, id: 'user-2' } } as Session
    await act(async () => authListener?.('SIGNED_IN', sessionB))

    expect(screen.getByText('authenticated:user-2')).toBeInTheDocument()
    for (const key of combinedKeys) expect(queryClient.getQueryData(key)).toBeUndefined()
    expect(queryClient.getQueryData(['organizer', 'user-1'])).toBeUndefined()
    expect(queryClient.getQueryData(['events', 'owned', 'user-1'])).toBeUndefined()
    expect(queryClient.getQueryData(['tickets', 'owned', 'user-1', 'event-1'])).toBeUndefined()
    expect(queryClient.getQueryData(['payments', 'connect', 'user-1'])).toBeUndefined()
    expect(queryClient.getQueryData(['public-event', 'event-1'])).toEqual({ title: 'Public event' })
  })
})

it('reconciles a late callback against the current session without clearing replacement caches', async () => {
  const sessionB = { ...session, user: { ...session.user, id: 'user-2' } } as Session
  getSession.mockResolvedValue({ data: { session: sessionB }, error: null })
  let listener!: (event: AuthChangeEvent, nextSession: Session | null) => void
  onAuthStateChange.mockImplementation(next => { listener = next; return { data: { subscription: { unsubscribe } }, ready: Promise.resolve({ error: null }) } })
  const queryClient = new QueryClient()
  render(<SessionProvider queryClient={queryClient}><SessionProbe /></SessionProvider>)
  expect(await screen.findByText('authenticated:user-2')).toBeInTheDocument()
  queryClient.setQueryData(['account', 'user-2'], 'B account')
  await act(async () => listener('SIGNED_IN', session))
  expect(screen.getByText('authenticated:user-2')).toBeInTheDocument()
  expect(queryClient.getQueryData(['account', 'user-2'])).toBe('B account')
})


it('keeps loading until SDK readiness settles even when a session read could complete', async () => {
  vi.clearAllMocks()
  let finish!: (value:{error:Error|null})=>void
  onAuthStateChange.mockReturnValue({data:{subscription:{unsubscribe}},ready:new Promise(resolve=>{finish=resolve})})
  getSession.mockResolvedValue({data:{session},error:null})
  render(<SessionProvider><SessionProbe /></SessionProvider>)
  await act(async()=>{})
  expect(screen.getByText('loading')).toBeInTheDocument()
  expect(getSession).not.toHaveBeenCalled()
  await act(async()=>finish({error:null}))
  expect(await screen.findByText('authenticated:user-1')).toBeInTheDocument()
})
it('shows fixed Auth-unavailable UI and unsubscribes on SDK readiness error', async () => {
  vi.clearAllMocks()
  onAuthStateChange.mockReturnValue({data:{subscription:{unsubscribe}},ready:Promise.resolve({error:new Error('private SDK payload')})})
  getSession.mockResolvedValue({data:{session},error:null})
  render(<SessionProvider><SessionProbe /></SessionProvider>)
  expect(await screen.findByRole('alert')).toHaveTextContent('Organizer authentication is unavailable')
  expect(screen.queryByText(/private SDK payload/)).not.toBeInTheDocument()
  expect(getSession).not.toHaveBeenCalled()
  expect(unsubscribe).toHaveBeenCalled()
})


it('does not start a main-client read when SDK readiness settles after unmount', async () => {
  vi.clearAllMocks()
  let finish!: (value:{error:Error|null})=>void
  onAuthStateChange.mockReturnValue({data:{subscription:{unsubscribe}},ready:new Promise(resolve=>{finish=resolve})})
  const view=render(<SessionProvider><SessionProbe /></SessionProvider>)
  view.unmount()
  await act(async()=>finish({error:null}))
  expect(getSession).not.toHaveBeenCalled()
  expect(unsubscribe).toHaveBeenCalledOnce()
})


it('fences signout completion on same-owner token replacement without changing identityVersion', async () => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({data:{session},error:null})
  let listener!:(event:AuthChangeEvent,next:Session|null)=>void
  onAuthStateChange.mockImplementation(callback=>{listener=(event,next)=>{getSession.mockResolvedValue({data:{session:next},error:null});callback(event,next)};return {data:{subscription:{unsubscribe}},ready:Promise.resolve({error:null})}})
  const client=new QueryClient()
  function VersionProbe(){const state=useSession();return <p>{state.status}:{state.identityVersion}</p>}
  render(<SessionProvider queryClient={client}><VersionProbe /></SessionProvider>)
  expect(await screen.findByText('authenticated:1')).toBeInTheDocument()
  const beforeRefresh=captureSignOutLifetime(client)
  await act(async()=>listener('TOKEN_REFRESHED',{...session,access_token:'new-access',refresh_token:'new-refresh'}))
  expect(screen.getByText('authenticated:1')).toBeInTheDocument()
  expect(beforeRefresh()).toBe(false)
  const beforeReplacement=captureSignOutLifetime(client)
  await act(async()=>listener('SIGNED_IN',{...session,access_token:'replacement-access',refresh_token:'replacement-refresh'}))
  expect(screen.getByText('authenticated:1')).toBeInTheDocument()
  expect(beforeReplacement()).toBe(false)
})
