import type { Session, User } from '@supabase/supabase-js'
import type { QueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react'
import { supabase } from '../../lib/supabase/client'
import { evictPrivateIdentityQueries } from './privateQueryCache'
import { captureIdentityLifetime, invalidateIdentityLifetime, observeAuthenticatedIdentity, setAuthenticatedIdentity } from './identityLifetime'
import { registerSessionReconciler } from './sessionReconciliation'

export type SessionState = { identityVersion?: number } & (
  | { status: 'loading'; session: null; user: null }
  | { status: 'anonymous'; session: null; user: null }
  | { status: 'unavailable'; session: null; user: null }
  | { status: 'authenticated'; session: Session; user: User }
)

const loadingState: SessionState = { status: 'loading', session: null, user: null }
const anonymousState: SessionState = { status: 'anonymous', session: null, user: null }
const SessionContext = createContext<SessionState | undefined>(undefined)

function stateFromSession(session: Session | null): SessionState {
  return session === null
    ? anonymousState
    : { status: 'authenticated', session, user: session.user }
}

type SessionProviderProps = PropsWithChildren<{ queryClient?: QueryClient }>

export function SessionProvider({ children, queryClient }: SessionProviderProps) {
  const [state, setState] = useState<SessionState>(loadingState)

  useEffect(() => {
    let active = true
    let readVersion = 0
    let activeUserId: string | null = null
    let observedUserId: string | null = null
    let observedAccessToken: string | undefined
    let observedRefreshToken: string | undefined
    let identityVersion = 0
    let ready = false
    let failed = false
    let latestRead: Promise<Session | null | undefined> = Promise.resolve(undefined)
    const observeIdentity = (session: Session | null) => {
      const userId = session?.user.id ?? null
      // Token rotation is a new logout lifetime even when the organizer ID is unchanged.
      if (session && (session.access_token !== observedAccessToken || session.refresh_token !== observedRefreshToken)) {
        if (queryClient) observeAuthenticatedIdentity(queryClient)
      }
      observedAccessToken = session?.access_token
      observedRefreshToken = session?.refresh_token
      if (userId !== observedUserId) {
        observedUserId = userId
        identityVersion += 1
        // A → B → A can occur before React renders or the authoritative read finishes.
        if (queryClient) {
          invalidateIdentityLifetime(queryClient)
        }
      }
    }
    const applySession = (session: Session | null) => {
      if (!active) return
      const nextUserId = session?.user.id ?? null
      observeIdentity(session)
      if (queryClient) setAuthenticatedIdentity(queryClient, nextUserId)
      if (nextUserId !== activeUserId) {
        if (queryClient) evictPrivateIdentityQueries(queryClient)
        activeUserId = nextUserId
      }
      setState({ ...stateFromSession(session), identityVersion })
    }
    const unavailable = () => {
      if (!active) return
      failed = true
      readVersion += 1
      if (queryClient) evictPrivateIdentityQueries(queryClient)
      setState({ status: 'unavailable', session: null, user: null, identityVersion })
    }
    const reconcileSession = (): Promise<Session | null | undefined> => {
      if (!active || !ready || failed) return Promise.resolve(undefined)
      const version = ++readVersion
      // Never await Auth inside an SDK event callback: that callback may own its lock.
      const read = Promise.resolve().then(() => supabase.auth.getSession()).then(({ data, error }) => {
        if (!active || failed) return undefined
        if (version !== readVersion) return latestRead
        if (error) { unavailable(); return undefined }
        applySession(data.session)
        return data.session
      }).catch(() => {
        if (active && version === readVersion) unavailable()
        return undefined
      })
      latestRead = read
      return read
    }
    const subscription = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active || failed) return
      observeIdentity(session)
      if (ready) void reconcileSession()
    })
    const readiness = subscription.ready.then(({ error }) => {
      if (!active) return
      if (error) { subscription.data.subscription.unsubscribe(); unavailable(); return }
      ready = true
      return reconcileSession()
    })
    const unregister = queryClient ? registerSessionReconciler(queryClient, async () => {
      await readiness
      const session = await reconcileSession()
      if (!active || failed || session !== null) return null
      return captureIdentityLifetime(queryClient, null)
    }) : undefined

    return () => {
      active = false
      unregister?.()
      subscription.data.subscription.unsubscribe()
    }
  }, [queryClient])

  return <SessionContext.Provider value={state}>{state.status === 'unavailable'
    ? <section role="alert"><h1>Organizer authentication is unavailable</h1><p>We could not verify your session. Reload this page to try again.</p><button onClick={() => window.location.reload()}>Reload page</button></section>
    : children}</SessionContext.Provider>
}

// Context hooks intentionally live beside their provider so the state contract stays local.
// eslint-disable-next-line react-refresh/only-export-components
export function useSession(): SessionState {
  const state = useContext(SessionContext)

  if (state === undefined) {
    throw new Error('useSession must be used within SessionProvider')
  }

  return state
}
